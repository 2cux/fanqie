(function initStorageModule(global) {
  "use strict";

  const APP_STATE_KEY = "focus-core.state.v4";
  const LEGACY_DATA_KEYS = [
    "focus-core.data.v3",
    "focus-core.data.v2",
    "focus-core.data.v1",
  ];
  const LEGACY_TIMER_KEY = "focus-core.timer.v1";
  const STATE_VERSION = 4;
  const DAILY_RECORD_LIMIT = 365;
  const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
  const TIMER_STATES = new Set(["idle", "running", "paused"]);

  let memoryState = null;
  let dirty = false;

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

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toNonNegativeNumber(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function createDefaultData() {
    return {
      permanentData: { totalFocusMinutes: 0, energy: 0 },
      dailyRecords: {},
      userState: {
        currentStreak: 0,
        lastFocusDate: null,
        lastFocusTimestamp: null,
        lastEnergyDecayTimestamp: null,
      },
    };
  }

  function createDefaultTimer() {
    return {
      state: "idle",
      elapsedSeconds: 0,
      startedAt: null,
      creditedMinutes: 0,
      timerDate: getLocalDateKey(),
    };
  }

  function getLocalDateKey(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function parseDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsedDate = new Date(timestamp);
    return parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 &&
      parsedDate.getUTCDate() === day
      ? timestamp
      : null;
  }

  function normalizeDailyRecords(records) {
    if (!isPlainObject(records)) return {};

    const now = new Date();
    const todayTimestamp = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const oldestTimestamp =
      todayTimestamp - (DAILY_RECORD_LIMIT - 1) * DAY_IN_MILLISECONDS;

    return Object.fromEntries(
      Object.entries(records)
        .map(([dateKey, value]) => {
          // 旧版本分别使用布尔值和数字；读取时继续兼容，
          // 但统一转换为当前的对象结构。
          const focusMinutes =
            value === true
              ? 1
              : isPlainObject(value)
                ? value.focusMinutes
                : value;

          return [dateKey, { focusMinutes }];
        })
        .filter(([dateKey, record]) => {
          const timestamp = parseDateKey(dateKey);
          return (
            Number.isFinite(record.focusMinutes) &&
            record.focusMinutes > 0 &&
            timestamp !== null &&
            timestamp >= oldestTimestamp &&
            timestamp <= todayTimestamp
          );
        })
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .slice(-DAILY_RECORD_LIMIT),
    );
  }

  function getRecordFocusMinutes(record) {
    return isPlainObject(record) &&
      Number.isFinite(record.focusMinutes) &&
      record.focusMinutes > 0
      ? record.focusMinutes
      : 0;
  }

  function deriveFocusState(dailyRecords) {
    const focusedDates = Object.keys(dailyRecords).filter(
      (dateKey) => getRecordFocusMinutes(dailyRecords[dateKey]) > 0,
    );
    const lastFocusDate = focusedDates.at(-1) ?? null;
    const now = new Date();
    let cursor = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const dateKeyAt = (timestamp) =>
      new Date(timestamp).toISOString().slice(0, 10);

    if (getRecordFocusMinutes(dailyRecords[dateKeyAt(cursor)]) <= 0) {
      cursor -= DAY_IN_MILLISECONDS;
    }

    let currentStreak = 0;
    while (getRecordFocusMinutes(dailyRecords[dateKeyAt(cursor)]) > 0) {
      currentStreak += 1;
      cursor -= DAY_IN_MILLISECONDS;
    }

    return { currentStreak, lastFocusDate };
  }

  function normalizeData(value) {
    const defaults = createDefaultData();
    const source = isPlainObject(value) ? value : defaults;
    const permanentData = isPlainObject(source.permanentData)
      ? source.permanentData
      : defaults.permanentData;
    const userState = isPlainObject(source.userState)
      ? source.userState
      : defaults.userState;
    const dailyRecords = normalizeDailyRecords(source.dailyRecords);
    const derivedFocusState = deriveFocusState(dailyRecords);
    const lastFocusTimestamp =
      typeof userState.lastFocusDate === "string"
        ? parseDateKey(userState.lastFocusDate)
        : null;
    const now = new Date();
    const oldestRetainedTimestamp =
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      (DAILY_RECORD_LIMIT - 1) * DAY_IN_MILLISECONDS;
    const historicalLastFocusDate =
      lastFocusTimestamp !== null &&
      lastFocusTimestamp < oldestRetainedTimestamp
        ? userState.lastFocusDate
        : null;

    return {
      permanentData: {
        totalFocusMinutes: toNonNegativeNumber(
          permanentData.totalFocusMinutes,
        ),
        energy: Math.floor(toNonNegativeNumber(permanentData.energy)),
      },
      dailyRecords,
      userState: {
        currentStreak: derivedFocusState.currentStreak,
        lastFocusDate:
          derivedFocusState.lastFocusDate ?? historicalLastFocusDate,
        lastFocusTimestamp:
          Number.isFinite(userState.lastFocusTimestamp) &&
          userState.lastFocusTimestamp >= 0
            ? userState.lastFocusTimestamp
            : null,
        lastEnergyDecayTimestamp:
          Number.isFinite(userState.lastEnergyDecayTimestamp) &&
          userState.lastEnergyDecayTimestamp >= 0
            ? userState.lastEnergyDecayTimestamp
            : null,
      },
    };
  }

  function normalizeTimer(value) {
    const source = isPlainObject(value) ? value : createDefaultTimer();
    const today = getLocalDateKey();

    // A timer snapshot belongs to one local calendar day. Accumulated data is
    // stored separately and must remain untouched when the timer rolls over.
    if (source.timerDate !== today) {
      return {
        state: "paused",
        elapsedSeconds: 0,
        startedAt: null,
        creditedMinutes: 0,
        timerDate: today,
      };
    }

    const state = TIMER_STATES.has(source.state) ? source.state : "idle";
    const elapsedSeconds = toNonNegativeNumber(source.elapsedSeconds);
    const startedAt =
      Number.isFinite(source.startedAt) && source.startedAt > 0
        ? source.startedAt
        : null;
    const normalizedState =
      state === "running" && startedAt === null ? "paused" : state;

    return {
      state: normalizedState,
      elapsedSeconds: normalizedState === "idle" ? 0 : elapsedSeconds,
      startedAt: normalizedState === "running" ? startedAt : null,
      creditedMinutes:
        normalizedState === "idle"
          ? 0
          : Math.floor(toNonNegativeNumber(source.creditedMinutes)),
      timerDate: today,
    };
  }

  function ensureMemoryState() {
    if (memoryState !== null) return memoryState;

    const storedState = readStorage(APP_STATE_KEY, null);
    if (isPlainObject(storedState)) {
      memoryState = {
        version: STATE_VERSION,
        data: normalizeData(storedState.data),
        timer: normalizeTimer(storedState.timer),
      };
      if (JSON.stringify(storedState) !== JSON.stringify(memoryState)) {
        dirty = true;
        persist();
      }
      return memoryState;
    }

    let legacyData = null;
    for (const key of LEGACY_DATA_KEYS) {
      legacyData = readStorage(key, null);
      if (legacyData !== null) break;
    }

    memoryState = {
      version: STATE_VERSION,
      data: normalizeData(legacyData),
      timer: normalizeTimer(readStorage(LEGACY_TIMER_KEY, null)),
    };
    dirty = true;
    persist();
    return memoryState;
  }

  // 读取始终来自内存快照，不会触发 LocalStorage 写入。
  function loadData() {
    return clone(ensureMemoryState().data);
  }

  function loadTimer() {
    return clone(ensureMemoryState().timer);
  }

  // 业务模块只更新内存并标记 dirty，由协调层决定保存时机。
  function updateData(partialData) {
    if (!isPlainObject(partialData)) return false;

    const state = ensureMemoryState();
    state.data = normalizeData({
      ...state.data,
      permanentData: {
        ...state.data.permanentData,
        ...(isPlainObject(partialData.permanentData)
          ? partialData.permanentData
          : {}),
      },
      dailyRecords: {
        ...state.data.dailyRecords,
        ...(isPlainObject(partialData.dailyRecords)
          ? partialData.dailyRecords
          : {}),
      },
      userState: {
        ...state.data.userState,
        ...(isPlainObject(partialData.userState) ? partialData.userState : {}),
      },
    });
    dirty = true;
    return true;
  }

  function updateTimer(timerSnapshot) {
    ensureMemoryState().timer = normalizeTimer(timerSnapshot);
    dirty = true;
    return true;
  }

  // 统计数据与计时器进度放在同一个版本化快照中，一次写入即可提交。
  function persist() {
    const state = ensureMemoryState();
    if (!dirty) return true;
    if (!writeStorage(APP_STATE_KEY, state)) return false;
    dirty = false;
    return true;
  }

  function saveData(data) {
    ensureMemoryState().data = normalizeData(data);
    dirty = true;
    return persist();
  }

  function clearData() {
    const state = ensureMemoryState();
    state.data = createDefaultData();
    dirty = true;
    const saved = persist();
    const legacyCleared = LEGACY_DATA_KEYS.map(removeStorage).every(Boolean);
    return saved && legacyCleared;
  }

  global.FocusCoreStorage = Object.freeze({
    loadData,
    loadTimer,
    updateData,
    updateTimer,
    persist,
    saveData,
    clearData,
    readStorage,
    writeStorage,
  });
})(window);
