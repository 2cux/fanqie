(function initEnergyModule(global) {
  "use strict";

  const { loadData, updateData } = global.FocusCoreStorage;
  const MAX_CATCH_UP_DAYS = 365;

  function formatDateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function parseDateInput(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    if (Number.isFinite(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? null
        : new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
    const record = records[formatDateKey(date)];
    const minutes =
      record === true
        ? 1
        : record !== null && typeof record === "object"
          ? record.focusMinutes
          : record;
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
   * Add Energy for completed focus minutes and record the precise time of the
   * latest valid focus. Fractions do not produce Energy.
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
    if (
      !updateData({
        permanentData: { energy: nextEnergy },
        userState: {
          lastFocusTimestamp: Date.now(),
          // A valid focus starts a new inactivity cycle, even if it happens in
          // the same millisecond as the previous decay check.
          lastEnergyDecayTimestamp: null,
        },
      })
    ) {
      return currentEnergy;
    }

    emitEnergyChange(nextEnergy);
    return nextEnergy;
  }

  /**
   * At the start of each local day, settle the previous local day. Energy is
   * halved only when that completed day contains no valid focus. Each day is
   * settled once, including days missed while the page was closed.
   */
  function checkDecay(referenceDate = new Date()) {
    const today = parseDateInput(referenceDate);
    if (today === null) return getEnergy();

    const data = loadData();
    const originalEnergy = Math.floor(data.permanentData.energy);
    const targetDate = shiftDate(today, -1);
    const storedLastCheckDate = parseDateInput(
      data.userState.lastEnergyCheckDate,
    );
    const legacyLastDecayDate = parseDateInput(
      data.userState.lastEnergyDecayTimestamp,
    );
    const lastCheckDate = storedLastCheckDate ?? legacyLastDecayDate;

    let cursor =
      lastCheckDate === null ? targetDate : shiftDate(lastCheckDate, 1);
    const earliestCatchUpDate = shiftDate(
      targetDate,
      -(MAX_CATCH_UP_DAYS - 1),
    );
    if (cursor < earliestCatchUpDate) cursor = earliestCatchUpDate;

    // The clock may have moved backwards, or this date may already be settled.
    if (cursor > targetDate) return originalEnergy;

    let nextEnergy = originalEnergy;
    while (cursor <= targetDate) {
      if (getFocusMinutes(data.dailyRecords, cursor) <= 0) {
        nextEnergy = Math.floor(nextEnergy / 2);
      }
      cursor = shiftDate(cursor, 1);
    }

    if (
      !updateData({
        permanentData: { energy: nextEnergy },
        userState: {
          lastEnergyCheckDate: formatDateKey(targetDate),
          ...(nextEnergy !== originalEnergy
            ? { lastEnergyDecayTimestamp: today.getTime() }
            : {}),
        },
      })
    ) {
      return originalEnergy;
    }

    if (nextEnergy !== originalEnergy) emitEnergyChange(nextEnergy);
    return nextEnergy;
  }

  global.FocusCoreEnergy = Object.freeze({
    addEnergy,
    checkDecay,
    getEnergy,
  });
})(window);
