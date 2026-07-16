(function initHeatmapModule(global) {
  "use strict";

  const DAYS_TO_DISPLAY = 365;
  const DAYS_PER_WEEK = 7;
  const { formatDuration } = global.FocusCoreFormatters;
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
  const ENERGY_LEVELS = [
    { level: 0, label: "0", description: "0min" },
    { level: 1, label: "1–30", description: "低能量，1min–30min" },
    { level: 2, label: "31–60", description: "中等能量，31min–1h 00min" },
    { level: 3, label: "61–179", description: "高能量，1h 01min–2h 59min" },
    { level: 4, label: "≥180", description: "强能量，3h 00min 以上" },
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

  function getFocusMinutes(record) {
    const value =
      record === true
        ? 1
        : record !== null && typeof record === "object"
        ? record.focusMinutes
        : record;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getEnergyLevel(minutes) {
    if (minutes <= 0) return 0;
    if (minutes <= 30) return 1;
    if (minutes <= 60) return 2;
    if (minutes < 180) return 3;
    return 4;
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
      this.layoutKey = null;
      this.cells = new Map();
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
      const layoutKey = `${formatDateKey(firstDate)}:${leadingSpacers}:${weekCount}`;

      // The structure changes only when the displayed date range changes.
      // During a session, update cells in place instead of rebuilding the DOM
      // and binding another set of pointer listeners every minute.
      if (this.layoutKey === layoutKey && this.cells.size === DAYS_TO_DISPLAY) {
        for (let index = 0; index < DAYS_TO_DISPLAY; index += 1) {
          const dateKey = formatDateKey(shiftDate(firstDate, index));
          const cell = this.cells.get(dateKey);
          if (!cell) break;

          const minutes = getFocusMinutes(safeRecords[dateKey]);
          const level = getEnergyLevel(minutes);
          const duration = formatDuration(minutes);
          const nextClassName = `heatmap__cell heatmap__cell--level-${level}`;
          if (cell.className !== nextClassName) cell.className = nextClassName;
          if (cell.dataset.duration !== duration) {
            cell.dataset.duration = duration;
            cell.setAttribute(
              "aria-label",
              `${dateKey}，专注 ${duration}`,
            );
          }
        }
        return this;
      }

      this.cells.clear();

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
      grid.setAttribute("aria-label", "最近365天每日专注时长热力图");
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
        const minutes = getFocusMinutes(safeRecords[dateKey]);
        const level = getEnergyLevel(minutes);
        const duration = formatDuration(minutes);
        const cell = document.createElement("span");

        cell.className = `heatmap__cell heatmap__cell--level-${level}`;
        cell.dataset.date = dateKey;
        cell.dataset.duration = duration;
        cell.setAttribute("role", "gridcell");
        cell.setAttribute(
          "aria-label",
          `${dateKey}，专注 ${duration}`,
        );
        this.cells.set(dateKey, cell);
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

      const legendTitle = document.createElement("span");
      legendTitle.className = "heatmap__legend-title";
      legendTitle.textContent = "专注时长";
      footer.append(legendTitle);
      ENERGY_LEVELS.forEach(({ level, label, description }) => {
        const item = document.createElement("span");
        const swatch = document.createElement("span");
        item.className = "heatmap__legend-item";
        item.title = description;
        swatch.className = `heatmap__legend-cell heatmap__cell--level-${level}`;
        swatch.setAttribute("aria-hidden", "true");
        item.append(swatch, label);
        footer.append(item);
      });

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
          tooltip.replaceChildren();

          const dateRow = document.createElement("div");
          const minutesRow = document.createElement("div");
          dateRow.textContent = `日期：${cell.dataset.date}`;
          minutesRow.textContent = `专注：${cell.dataset.duration}`;
          tooltip.append(dateRow, minutesRow);
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
      grid.addEventListener("pointerleave", () => {
        tooltip.hidden = true;
        activeCell = null;
        containerRect = null;
      });

      body.append(weekdays, grid);
      content.append(months, body);
      scroller.append(content);
      root.append(scroller, footer, tooltip);
      this.container.replaceChildren(root);
      this.layoutKey = layoutKey;
      return this;
    }

    destroy() {
      this.container.replaceChildren();
      this.cells.clear();
      this.layoutKey = null;
    }
  }

  global.FocusCoreHeatmap = Object.freeze({ FocusHeatmap });
})(window);
