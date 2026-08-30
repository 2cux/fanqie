(function initCalendarModule(global) {
  "use strict";

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
  const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
  const CALENDAR_SLOT_COUNT = 42;
  const FOCUS_LEVELS = [
    { level: 0, description: "0分钟：未专注" },
    { level: 1, description: "1–29分钟" },
    { level: 2, description: "30–59分钟" },
    { level: 3, description: "60–119分钟" },
    { level: 4, description: "120–239分钟" },
    { level: 5, description: "240–359分钟" },
    { level: 6, description: "360–479分钟" },
    { level: 7, description: "480–599分钟" },
    { level: 8, description: "600分钟及以上" },
  ];
  const { formatDuration } = global.FocusCoreFormatters;

  function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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

  function getRecordText(record, field) {
    return record !== null && typeof record === "object" &&
      typeof record[field] === "string"
      ? record[field].trim()
      : "";
  }

  function normalizeRecord(record) {
    return {
      focusMinutes: getFocusMinutes(record),
      note: getRecordText(record, "note"),
    };
  }

  function getFocusLevel(minutes) {
    if (minutes <= 0) return 0;
    if (minutes < 30) return 1;
    if (minutes < 60) return 2;
    if (minutes < 120) return 3;
    if (minutes < 240) return 4;
    if (minutes < 360) return 5;
    if (minutes < 480) return 6;
    if (minutes < 600) return 7;
    return 8;
  }

  function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function getAriaLabel(dateKey, record) {
    const parts = [`${dateKey}，专注 ${formatDuration(record.focusMinutes)}`];
    if (record.note) parts.push(`备注：${record.note}`);
    return parts.join("，");
  }

  class FocusCalendar {
    constructor(container, options = {}) {
      if (!(container instanceof Element)) {
        throw new TypeError("FocusCalendar 需要一个有效的容器元素");
      }

      this.container = container;
      this.dataProvider =
        options.dataProvider ??
        (() => global.FocusCoreStorage.loadData().dailyRecords);
      this.referenceDateProvider =
        options.referenceDateProvider ?? (() => new Date());
      this.viewDate = null;
      this.layoutKey = null;
      this.cells = new Map();
      this.tooltip = null;
      this.dialog = null;
      this.editingDateKey = null;
      this.boundHandlers = [];
      this.cellTooltipCleanup = [];

      this.bindContainerEvents();
      this.bindEditorEvents();
    }

    bindContainerEvents() {
      if (typeof this.container.addEventListener !== "function") return;

      const onClick = (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;

        const actionButton = target.closest("[data-calendar-action]");
        if (actionButton && this.container.contains(actionButton)) {
          const action = actionButton.dataset.calendarAction;
          this.moveMonth(action === "previous" ? -1 : 1);
          return;
        }

        const cell = this.getCellFromTarget(target);
        if (cell) this.openEditor(cell.dataset.date);
      };

      const onFocusIn = (event) => {
        const cell = this.getCellFromTarget(event.target);
        if (!cell) return;
        const rect = cell.getBoundingClientRect();
        this.showTooltip(cell, rect.left + rect.width / 2, rect.top);
      };

      const onFocusOut = (event) => {
        if (!this.getCellFromTarget(event.relatedTarget)) {
          this.hideTooltip();
        }
      };

      [
        ["click", onClick],
        ["focusin", onFocusIn],
        ["focusout", onFocusOut],
      ].forEach(([type, handler]) => {
        this.container.addEventListener(type, handler);
        this.boundHandlers.push(() =>
          this.container.removeEventListener(type, handler),
        );
      });
    }

    bindCellTooltipEvents(cell) {
      const onMouseEnter = (event) => {
        const rect = cell.getBoundingClientRect();
        this.showTooltip(
          cell,
          event.clientX || rect.left + rect.width / 2,
          event.clientY || rect.top,
        );
      };
      const onMouseLeave = () => this.hideTooltip();

      cell.addEventListener("mouseenter", onMouseEnter);
      cell.addEventListener("mouseleave", onMouseLeave);
      this.cellTooltipCleanup.push(() => {
        cell.removeEventListener("mouseenter", onMouseEnter);
        cell.removeEventListener("mouseleave", onMouseLeave);
      });
    }

    clearCellTooltipEvents() {
      this.cellTooltipCleanup.splice(0).reverse().forEach((cleanup) => {
        cleanup();
      });
    }

    bindEditorEvents() {
      if (typeof document === "undefined") return;

      this.dialog = document.querySelector("[data-calendar-dialog]");
      if (!this.dialog) return;

      const form = this.dialog.querySelector("[data-calendar-form]");
      const cancelButtons = this.dialog.querySelectorAll("[data-calendar-cancel]");
      if (!form || cancelButtons.length === 0) return;

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.saveEditor();
      });
      cancelButtons.forEach((button) => {
        button.addEventListener("click", () => this.closeEditor());
      });
      this.dialog.addEventListener("click", (event) => {
        if (event.target === this.dialog) this.closeEditor();
      });
    }

    getCellFromTarget(target) {
      if (!target || typeof target.closest !== "function") return null;
      const cell = target.closest("[data-date]");
      return cell && this.container.contains(cell) ? cell : null;
    }

    render(records = this.dataProvider()) {
      const safeRecords =
        records !== null && typeof records === "object" ? records : {};
      if (this.viewDate === null) {
        this.viewDate = normalizeReferenceDate(this.referenceDateProvider());
      }

      const firstDate = new Date(
        this.viewDate.getFullYear(),
        this.viewDate.getMonth(),
        1,
      );
      const daysInMonth = new Date(
        firstDate.getFullYear(),
        firstDate.getMonth() + 1,
        0,
      ).getDate();
      // The calendar is Monday-first while Date#getDay() is Sunday-first.
      const leadingSpacers = (firstDate.getDay() + 6) % 7;
      const monthKey = getMonthKey(firstDate);
      const layoutKey = `${monthKey}:${daysInMonth}:${leadingSpacers}`;

      if (
        this.layoutKey === layoutKey &&
        this.cells.size === daysInMonth
      ) {
        for (let day = 1; day <= daysInMonth; day += 1) {
          const dateKey = formatDateKey(
            new Date(firstDate.getFullYear(), firstDate.getMonth(), day),
          );
          this.updateCell(this.cells.get(dateKey), dateKey, safeRecords[dateKey]);
        }
        return this;
      }

      this.clearCellTooltipEvents();
      this.cells.clear();

      const root = document.createElement("div");
      const header = document.createElement("header");
      const title = document.createElement("div");
      const eyebrow = document.createElement("p");
      const monthHeading = document.createElement("h3");
      const previousButton = document.createElement("button");
      const nextButton = document.createElement("button");
      const weekdays = document.createElement("div");
      const grid = document.createElement("div");
      const footer = document.createElement("div");
      const tooltip = document.createElement("div");

      root.className = "calendar__root";
      header.className = "calendar__header";
      title.className = "calendar__title";
      eyebrow.className = "eyebrow";
      eyebrow.textContent = "FOCUS CALENDAR";
      monthHeading.className = "calendar__month";
      monthHeading.textContent = `${firstDate.getFullYear()}年${MONTH_LABELS[firstDate.getMonth()]}`;
      previousButton.className = "calendar__nav";
      previousButton.type = "button";
      previousButton.dataset.calendarAction = "previous";
      previousButton.setAttribute("aria-label", "上一个月");
      previousButton.textContent = "‹";
      nextButton.className = "calendar__nav";
      nextButton.type = "button";
      nextButton.dataset.calendarAction = "next";
      nextButton.setAttribute("aria-label", "下一个月");
      nextButton.textContent = "›";
      weekdays.className = "calendar__weekdays";
      grid.className = "calendar__grid";
      grid.setAttribute("role", "grid");
      grid.setAttribute(
        "aria-label",
        `${firstDate.getFullYear()}年${MONTH_LABELS[firstDate.getMonth()]}专注日历`,
      );
      footer.className = "calendar__legend";
      tooltip.className = "calendar__tooltip";
      tooltip.hidden = true;
      tooltip.setAttribute("role", "tooltip");

      title.append(eyebrow, monthHeading);
      header.append(title, previousButton, nextButton);
      WEEKDAY_LABELS.forEach((label) => {
        const weekday = document.createElement("span");
        weekday.textContent = label;
        weekdays.append(weekday);
      });

      for (let slot = 0; slot < CALENDAR_SLOT_COUNT; slot += 1) {
        const day = slot - leadingSpacers + 1;
        if (day < 1 || day > daysInMonth) {
          const spacer = document.createElement("span");
          spacer.className = "calendar__empty";
          spacer.setAttribute("aria-hidden", "true");
          grid.append(spacer);
          continue;
        }

        const date = new Date(
          firstDate.getFullYear(),
          firstDate.getMonth(),
          day,
        );
        const dateKey = formatDateKey(date);
        const cell = document.createElement("button");
        const dayNumber = document.createElement("span");
        const noteLabel = document.createElement("span");

        cell.type = "button";
        cell.className = "calendar__cell heatmap__cell";
        cell.dataset.date = dateKey;
        cell.setAttribute("role", "gridcell");
        dayNumber.className = "calendar__day-number";
        dayNumber.textContent = String(day);
        noteLabel.className = "calendar__note calendar__note--empty";
        cell.append(dayNumber, noteLabel);
        this.updateCell(cell, dateKey, safeRecords[dateKey]);
        this.bindCellTooltipEvents(cell);
        this.cells.set(dateKey, cell);
        grid.append(cell);
      }

      this.buildLegend(footer);
      root.append(header, weekdays, grid, footer, tooltip);
      this.container.replaceChildren(root);
      this.tooltip = tooltip;
      this.layoutKey = layoutKey;
      return this;
    }

    buildLegend(footer) {
      const less = document.createElement("span");
      less.className = "calendar__legend-label";
      less.textContent = "少";
      footer.append(less);

      FOCUS_LEVELS.slice(1).forEach(({ level, description }) => {
        const item = document.createElement("span");
        const swatch = document.createElement("span");
        item.className = "calendar__legend-item";
        item.setAttribute("role", "img");
        item.setAttribute("aria-label", description);
        swatch.className = `heatmap__cell heatmap__cell--level-${level}`;
        swatch.setAttribute("aria-hidden", "true");
        item.append(swatch);
        footer.append(item);
      });

      const more = document.createElement("span");
      more.className = "calendar__legend-label";
      more.textContent = "多";
      footer.append(more);
    }

    updateCell(cell, dateKey, rawRecord) {
      if (!cell) return;

      const record = normalizeRecord(rawRecord);
      const level = getFocusLevel(record.focusMinutes);
      const isCalendarCell = cell.className.includes("calendar__cell");
      let nextClassName = isCalendarCell
        ? `calendar__cell heatmap__cell heatmap__cell--level-${level}`
        : `heatmap__cell heatmap__cell--level-${level}`;
      if (isCalendarCell && dateKey === formatDateKey(new Date())) {
        nextClassName += " calendar__cell--today";
      }

      if (cell.className !== nextClassName) cell.className = nextClassName;
      cell.dataset.duration = formatDuration(record.focusMinutes);
      cell.dataset.note = record.note;
      cell.setAttribute("aria-label", getAriaLabel(dateKey, record));

      const noteLabel = cell.querySelector?.(".calendar__note");
      if (noteLabel) {
        noteLabel.textContent = record.note;
        noteLabel.classList.toggle("calendar__note--empty", !record.note);
      }
    }

    updateDate(date = new Date(), records = this.dataProvider()) {
      const normalizedDate = normalizeReferenceDate(date);
      const dateKey = formatDateKey(normalizedDate);
      const cell = this.cells.get(dateKey);
      if (!cell) return this.render(records);

      const safeRecords =
        records !== null && typeof records === "object" ? records : {};
      this.updateCell(cell, dateKey, safeRecords[dateKey]);
      return this;
    }

    moveMonth(monthDelta) {
      const currentMonth = this.viewDate ?? normalizeReferenceDate(new Date());
      this.viewDate = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() + monthDelta,
        1,
      );
      this.hideTooltip();
      this.render();
    }

    showTooltip(cell, clientX, clientY) {
      if (!this.tooltip) return;

      this.tooltip.replaceChildren();
      const dateRow = document.createElement("div");
      const minutesRow = document.createElement("div");
      dateRow.textContent = cell.dataset.date;
      minutesRow.textContent = `专注 ${cell.dataset.duration}`;
      this.tooltip.append(dateRow, minutesRow);
      if (cell.dataset.note) {
        const noteRow = document.createElement("div");
        noteRow.textContent = `备注：${cell.dataset.note}`;
        this.tooltip.append(noteRow);
      }

      this.tooltip.hidden = false;
      const containerRect = this.container.getBoundingClientRect();
      const tooltipHalfWidth = this.tooltip.offsetWidth / 2;
      const x = Math.min(
        containerRect.width - tooltipHalfWidth - 8,
        Math.max(tooltipHalfWidth + 8, clientX - containerRect.left),
      );
      this.tooltip.style.left = `${x}px`;
      this.tooltip.style.top = `${Math.max(58, clientY - containerRect.top)}px`;
    }

    hideTooltip() {
      if (!this.tooltip) return;
      this.tooltip.hidden = true;
      this.tooltip.replaceChildren();
    }

    openEditor(dateKey) {
      if (!this.dialog || !dateKey) return;

      const safeRecords = this.dataProvider();
      const record = normalizeRecord(safeRecords?.[dateKey]);
      const dateLabel = this.dialog.querySelector("[data-calendar-selected-date]");
      const focusLabel = this.dialog.querySelector("[data-calendar-focus]");
      const noteInput = this.dialog.querySelector("[data-calendar-note]");
      const feedback = this.dialog.querySelector("[data-calendar-feedback]");

      this.editingDateKey = dateKey;
      if (dateLabel) dateLabel.textContent = dateKey;
      if (focusLabel) focusLabel.textContent = `今日专注 ${formatDuration(record.focusMinutes)}`;
      if (noteInput) noteInput.value = record.note;
      if (feedback) feedback.textContent = "";
      this.hideTooltip();
      this.dialog.showModal();
      noteInput?.focus();
    }

    closeEditor() {
      if (this.dialog?.open) this.dialog.close();
      this.editingDateKey = null;
    }

    saveEditor() {
      if (!this.dialog || !this.editingDateKey) return;

      const noteInput = this.dialog.querySelector("[data-calendar-note]");
      const feedback = this.dialog.querySelector("[data-calendar-feedback]");
      const updated = global.FocusCoreStorage?.updateDailyRecord(
        this.editingDateKey,
        {
          note: noteInput?.value ?? "",
        },
      );
      const saved = updated && global.FocusCoreStorage?.persist();

      if (!saved) {
        if (feedback) feedback.textContent = "保存失败，请检查浏览器存储权限。";
        return;
      }

      const dateKey = this.editingDateKey;
      this.render();
      this.closeEditor();
      if (typeof global.CustomEvent === "function") {
        global.dispatchEvent(
          new CustomEvent("focuscore:calendarchange", {
            detail: { dateKey },
          }),
        );
      }
    }

    destroy() {
      this.clearCellTooltipEvents();
      this.boundHandlers.splice(0).reverse().forEach((removeListener) => {
        removeListener();
      });
      this.closeEditor();
      this.container.replaceChildren();
      this.cells.clear();
      this.tooltip = null;
      this.layoutKey = null;
    }
  }

  const api = Object.freeze({
    FocusCalendar,
    // Keep the old export as a compatibility bridge for existing integrations.
    FocusHeatmap: FocusCalendar,
    getFocusLevel,
    getFocusMinutes,
  });

  global.FocusCoreCalendar = api;
  global.FocusCoreHeatmap = api;
})(window);
