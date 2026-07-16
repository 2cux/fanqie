(function initEnergyModule(global) {
  "use strict";

  const { loadData, saveData } = global.FocusCoreStorage;
  const MAX_CATCH_UP_DAYS = 365;

  function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDateInput(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    if (typeof value !== "string") return null;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    const isRealDate =
      date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3]);

    return isRealDate ? date : null;
  }

  function shiftDate(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function getFocusMinutes(records, date) {
    const minutes = records[formatDateKey(date)];
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  function getEnergy() {
    return Math.floor(loadData().permanentData.energy);
  }

  function emitEnergyChange(energy) {
    if (typeof global.CustomEvent !== "function") return;

    global.dispatchEvent(
      new CustomEvent("focuscore:energychange", {
        detail: { energy },
      }),
    );
  }

  /**
   * 增加完整分钟对应的 Energy，默认增加 1。
   * 小数部分不会转换为 Energy，应由调用方在累计满一分钟时调用。
   */
  function addEnergy(completedMinutes = 1) {
    if (!Number.isFinite(completedMinutes) || completedMinutes <= 0) {
      return getEnergy();
    }

    const increment = Math.floor(completedMinutes);
    const data = loadData();
    const currentEnergy = Math.floor(data.permanentData.energy);
    if (increment < 1) return currentEnergy;

    const nextEnergy = currentEnergy + increment;
    data.permanentData.energy = nextEnergy;
    if (!saveData(data)) return currentEnergy;

    emitEnergyChange(nextEnergy);
    return nextEnergy;
  }

  /**
   * 检查尚未处理的自然日：前一天有专注、当天无专注时减半一次。
   * 返回检查完成后的 Energy。
   */
  function checkDecay(referenceDate = new Date()) {
    const today = parseDateInput(referenceDate);
    if (today === null) return getEnergy();

    const data = loadData();
    const originalEnergy = Math.floor(data.permanentData.energy);
    const lastCheckDate = parseDateInput(
      data.userState.lastEnergyCheckDate,
    );

    // 第一次启用能量模块时只检查当前日，避免追溯未知的历史状态。
    let cursor = lastCheckDate === null ? today : shiftDate(lastCheckDate, 1);
    const earliestCatchUpDate = shiftDate(today, -(MAX_CATCH_UP_DAYS - 1));
    if (cursor < earliestCatchUpDate) cursor = earliestCatchUpDate;

    // 系统时间回拨时不重复处理已经检查过的日期。
    if (cursor > today) return originalEnergy;

    let nextEnergy = originalEnergy;
    while (cursor <= today) {
      const yesterday = shiftDate(cursor, -1);
      const focusedYesterday =
        getFocusMinutes(data.dailyRecords, yesterday) > 0;
      const focusedToday = getFocusMinutes(data.dailyRecords, cursor) > 0;

      if (focusedYesterday && !focusedToday) {
        nextEnergy = Math.floor(nextEnergy / 2);
      }

      cursor = shiftDate(cursor, 1);
    }

    data.permanentData.energy = nextEnergy;
    data.userState.lastEnergyCheckDate = formatDateKey(today);
    if (!saveData(data)) return originalEnergy;

    if (nextEnergy !== originalEnergy) emitEnergyChange(nextEnergy);
    return nextEnergy;
  }

  global.FocusCoreEnergy = Object.freeze({
    addEnergy,
    checkDecay,
    getEnergy,
  });
})(window);
