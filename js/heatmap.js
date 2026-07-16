(function initHeatmapModule(global) {
  "use strict";

  const DAYS_TO_DISPLAY = 365;
  const DAYS_PER_WEEK = 7;
  const MONTH_LABELS = [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ];

  function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function shiftDate(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function normalizeReferenceDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      return new Date();
    }

    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function hasFocused(recordValue) {
    if (recordValue === true) return true;
    if (Number.isFinite(recordValue)) return recordValue > 0;
    return (
      recordValue !== null &&
      typeof recordValue === "object" &&
      Number.isFinite(recordValue.focusMinutes) &&
      recordValue.focusMinutes > 0
    );
  }

  class FocusHeatmap {
    constructor(container, options = {}) {
      if (!(container instanceof Element)) {
        throw new TypeError("FocusHeatmap 需要一个有效的容器元素");
      }

      this.container = container;
      this.dataProvider =
        options.dataProvider ??
        (() => global.FocusCoreStorage.loadData().dailyRecords);
      this.referenceDateProvider =
        options.referenceDateProvider ?? (() => new Date());
    }

    render(records = this.dataProvider()) {
      const safeRecords =
        records !== null && typeof records === "object" ? records : {};
      const referenceDate = normalizeReferenceDate(
        this.referenceDateProvider(),
      );
      const firstDate = shiftDate(referenceDate, -(DAYS_TO_DISPLAY - 1));
      const leadingSpacers = firstDate.getDay();
      const weekCount = Math.ceil(
        (leadingSpacers + DAYS_TO_DISPLAY) / DAYS_PER_WEEK,
      );

      const root = document.createElement("div");
      const scroller = document.createElement("div");
      const content = document.createElement("div");
      const months = document.createElement("div");
      const body = document.createElement("div");
      const weekdays = document.createElement("div");
      const grid = document.createElement("div");
      const footer = document.createElement("div");
      const tooltip = document.createElement("div");

      root.className = "heatmap__root";
      scroller.className = "heatmap__scroller";
      content.className = "heatmap__content";
      months.className = "heatmap__months";
      body.className = "heatmap__body";
      weekdays.className = "heatmap__weekdays";
      grid.className = "heatmap__grid";
      footer.className = "heatmap__footer";
      tooltip.className = "heatmap__tooltip";
      tooltip.hidden = true;
      tooltip.setAttribute("role", "tooltip");
      grid.setAttribute("role", "grid");
      grid.setAttribute("aria-label", "最近365天专注记录");
      months.style.setProperty("--heatmap-weeks", weekCount);

      weekdays.innerHTML =
        "<span></span><span>一</span><span></span><span>三</span>" +
        "<span></span><span>五</span><span></span>";

      for (let index = 0; index < leadingSpacers; index += 1) {
        const spacer = document.createElement("span");
        spacer.className = "heatmap__cell heatmap__cell--spacer";
        spacer.setAttribute("aria-hidden", "true");
        grid.append(spacer);
      }

      let previousMonth = -1;
      for (let index = 0; index < DAYS_TO_DISPLAY; index += 1) {
        const date = shiftDate(firstDate, index);
        const dateKey = formatDateKey(date);
        const focused = hasFocused(safeRecords[dateKey]);
        const cell = document.createElement("span");

        cell.className = `heatmap__cell${
          focused ? " heatmap__cell--focused" : ""
        }`;
        cell.dataset.date = dateKey;
        cell.dataset.status = focused ? "专注过" : "未专注";
        cell.setAttribute("role", "gridcell");
        cell.setAttribute(
          "aria-label",
          `${dateKey}，${focused ? "专注过" : "未专注"}`,
        );
        grid.append(cell);

        if (date.getMonth() !== previousMonth) {
          const monthLabel = document.createElement("span");
          const weekColumn = Math.floor((leadingSpacers + index) / 7) + 1;
          monthLabel.className = "heatmap__month";
          monthLabel.textContent = MONTH_LABELS[date.getMonth()];
          monthLabel.style.gridColumn = String(weekColumn);
          months.append(monthLabel);
          previousMonth = date.getMonth();
        }
      }

      footer.innerHTML =
        '<span>无专注</span><span class="heatmap__legend-cell"></span>' +
        '<span class="heatmap__legend-cell heatmap__legend-cell--focused"></span>' +
        "<span>有专注</span>";

      let activeCell = null;
      let containerRect = null;
      let tooltipHalfWidth = 0;

      const positionTooltip = (clientX, clientY) => {
        if (containerRect === null) return;

        const x = Math.min(
          containerRect.width - tooltipHalfWidth - 8,
          Math.max(tooltipHalfWidth + 8, clientX - containerRect.left),
        );
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${Math.max(58, clientY - containerRect.top)}px`;
      };

      const showTooltip = (cell, clientX, clientY) => {
        if (activeCell !== cell) {
          activeCell = cell;
          tooltip.innerHTML = `日期：${cell.dataset.date}<br>状态：${cell.dataset.status}`;
          tooltip.hidden = false;
          containerRect = this.container.getBoundingClientRect();
          tooltipHalfWidth = tooltip.offsetWidth / 2;
        }

        positionTooltip(clientX, clientY);
      };

      grid.addEventListener("pointerover", (event) => {
        const cell = event.target.closest("[data-date]");
        if (cell) showTooltip(cell, event.clientX, event.clientY);
      });
      grid.addEventListener("pointermove", (event) => {
        const cell = event.target.closest("[data-date]");
        if (cell) showTooltip(cell, event.clientX, event.clientY);
      });
      grid.addEventListener("pointerout", (event) => {
        if (!event.relatedTarget?.closest?.("[data-date]")) {
          tooltip.hidden = true;
          activeCell = null;
          containerRect = null;
        }
      });

      body.append(weekdays, grid);
      content.append(months, body);
      scroller.append(content);
      root.append(scroller, footer, tooltip);
      this.container.replaceChildren(root);
      return this;
    }

    destroy() {
      this.container.replaceChildren();
    }
  }

  global.FocusCoreHeatmap = Object.freeze({ FocusHeatmap });
})(window);
