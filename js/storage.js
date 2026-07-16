(function initStorageModule(global) {
  "use strict";

  const APP_DATA_KEY = "focus-core.data.v1";
  const DATA_VERSION = 1;
  const DAILY_RECORD_LIMIT = 365;
  const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

  /**
   * 本地存储模块。
   * 应用数据体量较小，统一以一个版本化 JSON 对象保存在 localStorage。
   */
  function readStorage(key, fallbackValue) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallbackValue : JSON.parse(value);
    } catch (error) {
      console.warn(`无法读取本地数据：${key}`, error);
      return fallbackValue;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`无法保存本地数据：${key}`, error);
      return false;
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn(`无法清除本地数据：${key}`, error);
      return false;
    }
  }

  function createDefaultData() {
    return {
      version: DATA_VERSION,
      permanentData: {
        totalFocusMinutes: 0,
        energy: 0,
      },
      dailyRecords: {},
      userState: {
        currentStreak: 0,
        lastFocusDate: null,
      },
    };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function toNonNegativeNumber(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function parseDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return null;

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsedDate = new Date(timestamp);

    const isRealDate =
      parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 &&
      parsedDate.getUTCDate() === day;

    return isRealDate ? timestamp : null;
  }

  function getTodayTimestamp() {
    const today = new Date();
    return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  }

  function normalizeDailyRecords(records) {
    if (!isPlainObject(records)) return {};

    const todayTimestamp = getTodayTimestamp();
    const oldestTimestamp =
      todayTimestamp - (DAILY_RECORD_LIMIT - 1) * DAY_IN_MILLISECONDS;

    return Object.fromEntries(
      Object.entries(records)
        .filter(([dateKey, focused]) => {
          const timestamp = parseDateKey(dateKey);
          return (
            focused === true &&
            timestamp !== null &&
            timestamp >= oldestTimestamp &&
            timestamp <= todayTimestamp
          );
        })
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .slice(-DAILY_RECORD_LIMIT),
    );
  }

  function normalizeAppData(data) {
    const defaults = createDefaultData();
    const source = isPlainObject(data) ? data : defaults;
    const permanentData = isPlainObject(source.permanentData)
      ? source.permanentData
      : defaults.permanentData;
    const userState = isPlainObject(source.userState)
      ? source.userState
      : defaults.userState;
    const lastFocusDate =
      typeof userState.lastFocusDate === "string" &&
      parseDateKey(userState.lastFocusDate) !== null
        ? userState.lastFocusDate
        : null;

    return {
      version: DATA_VERSION,
      permanentData: {
        totalFocusMinutes: toNonNegativeNumber(
          permanentData.totalFocusMinutes,
        ),
        energy: toNonNegativeNumber(permanentData.energy),
      },
      dailyRecords: normalizeDailyRecords(source.dailyRecords),
      userState: {
        currentStreak: Math.floor(
          toNonNegativeNumber(userState.currentStreak),
        ),
        lastFocusDate,
      },
    };
  }

  /** 完整覆盖并保存应用数据。返回是否写入成功。 */
  function saveData(data) {
    return writeStorage(APP_DATA_KEY, normalizeAppData(data));
  }

  /** 读取并校验应用数据；无数据或数据损坏时返回默认结构。 */
  function loadData() {
    const storedData = readStorage(APP_DATA_KEY, createDefaultData());
    return normalizeAppData(storedData);
  }

  /**
   * 按分类合并部分数据并保存。
   * dailyRecords 中传入 false 可删除对应日期记录。
   */
  function updateData(partialData) {
    if (!isPlainObject(partialData)) return false;

    const currentData = loadData();
    const nextData = {
      ...currentData,
      permanentData: {
        ...currentData.permanentData,
        ...(isPlainObject(partialData.permanentData)
          ? partialData.permanentData
          : {}),
      },
      dailyRecords: {
        ...currentData.dailyRecords,
        ...(isPlainObject(partialData.dailyRecords)
          ? partialData.dailyRecords
          : {}),
      },
      userState: {
        ...currentData.userState,
        ...(isPlainObject(partialData.userState)
          ? partialData.userState
          : {}),
      },
    };

    return saveData(nextData);
  }

  /** 清除三类应用数据并恢复默认值，不影响独立的计时器运行状态。 */
  function clearData() {
    return removeStorage(APP_DATA_KEY);
  }

  global.FocusCoreStorage = Object.freeze({
    saveData,
    loadData,
    updateData,
    clearData,
    // 供计时器状态等独立模块使用的底层键值读写。
    readStorage,
    writeStorage,
  });
})(window);
