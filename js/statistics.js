(function initStatisticsModule(global) {
  "use strict";

  const { loadData, saveData } = global.FocusCoreStorage;
  const DAYS_IN_WEEK = 7;

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

  function getDailyMinutes(records, date) {
    const minutes = records[formatDateKey(date)];
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  function calculateCurrentStreak(records, referenceDate) {
    let cursor = referenceDate;

    // 今天尚未专注不立即判定中断；昨天也没有记录时才归零。
    if (getDailyMinutes(records, cursor) <= 0) {
      cursor = shiftDate(cursor, -1);
      if (getDailyMinutes(records, cursor) <= 0) return 0;
    }

    let streak = 0;
    while (getDailyMinutes(records, cursor) > 0) {
      streak += 1;
      cursor = shiftDate(cursor, -1);
    }

    return streak;
  }

  function findLastFocusDate(records) {
    const focusedDates = Object.entries(records)
      .filter(([, minutes]) => Number.isFinite(minutes) && minutes > 0)
      .map(([dateKey]) => dateKey)
      .sort();

    return focusedDates.at(-1) ?? null;
  }

  function buildStatistics(data, referenceDate) {
    const todayFocusMinutes = getDailyMinutes(
      data.dailyRecords,
      referenceDate,
    );
    let weekFocusMinutes = 0;

    for (let dayOffset = 0; dayOffset < DAYS_IN_WEEK; dayOffset += 1) {
      weekFocusMinutes += getDailyMinutes(
        data.dailyRecords,
        shiftDate(referenceDate, -dayOffset),
      );
    }

    return {
      todayFocusMinutes,
      weekFocusMinutes,
      totalFocusMinutes: data.permanentData.totalFocusMinutes,
      currentStreak: calculateCurrentStreak(
        data.dailyRecords,
        referenceDate,
      ),
    };
  }

  /**
   * 获取指定日期视角下的统计数据，默认以今天为基准。
   */
  function getStatistics(referenceDate = new Date()) {
    const normalizedDate = parseDateInput(referenceDate);
    if (normalizedDate === null) {
      throw new TypeError("referenceDate 必须是有效的 Date 或 YYYY-MM-DD 日期");
    }

    return buildStatistics(loadData(), normalizedDate);
  }

  /**
   * 记录一段有效专注时间。
   * 由业务层传入分钟数，因此本模块不依赖 FocusTimer。
   */
  function recordFocusMinutes(minutes, focusDate = new Date()) {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;

    const normalizedDate = parseDateInput(focusDate);
    if (normalizedDate === null) return false;

    const data = loadData();
    const dateKey = formatDateKey(normalizedDate);
    const currentDailyMinutes = Number.isFinite(data.dailyRecords[dateKey])
      ? data.dailyRecords[dateKey]
      : 0;
    const roundedMinutes = Math.round(minutes * 1_000_000) / 1_000_000;

    data.dailyRecords[dateKey] = currentDailyMinutes + roundedMinutes;
    data.permanentData.totalFocusMinutes += roundedMinutes;
    data.userState.currentStreak = calculateCurrentStreak(
      data.dailyRecords,
      new Date(),
    );
    data.userState.lastFocusDate = findLastFocusDate(data.dailyRecords);

    return saveData(data);
  }

  global.FocusCoreStatistics = Object.freeze({
    getStatistics,
    recordFocusMinutes,
  });
})(window);
