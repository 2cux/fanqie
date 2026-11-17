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
  let sessionIndexSource = null;
  let activeSession;
  let latestSession;

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

  function getRecordFocusMinutes(record) {
    const value =
      record === true
        ? 1
        : isPlainObject(record)
          ? record.focusMinutes
          : record;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getRecordText(record, field) {
    return isPlainObject(record) && typeof record[field] === "string"
      ? record[field].trim()
      : "";
  }

  function createDefaultData() {
    return {
      permanentData: { totalFocusMinutes: 0 },
      sessions: [],
      dailyRecords: {},
      userState: {
        currentStreak: 0,
        lastFocusDate: null,
        lastFocusTimestamp: null,
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

    const normalizedEntries = Object.entries(records)
      .map(([dateKey, value]) => {
        // 旧版本分别使用布尔值和数字；读取时继续兼容，
        // 但统一按当前对象结构读取。只包含 focusMinutes 的旧记录
        // 会保持精简形态，避免一次迁移改写所有历史数据。
        const focusMinutes = getRecordFocusMinutes(value);
        const note = getRecordText(value, "note");
        const deadline = getRecordText(value, "deadline");
        const hasMetadata = isPlainObject(value) &&
          (Object.prototype.hasOwnProperty.call(value, "note") ||
            Object.prototype.hasOwnProperty.call(value, "deadline"));

        return [
          dateKey,
          hasMetadata
            ? { focusMinutes, note, deadline }
            : { focusMinutes },
        ];
      })
      .filter(([dateKey, record]) => {
        const timestamp = parseDateKey(dateKey);
        return (
          (record.focusMinutes > 0 || record.note || record.deadline) &&
          timestamp !== null &&
          timestamp >= oldestTimestamp
        );
      });

    const historicalEntries = normalizedEntries
      .filter(([dateKey]) => parseDateKey(dateKey) <= todayTimestamp)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .slice(-DAILY_RECORD_LIMIT);
    const futureEntries = normalizedEntries
      .filter(([dateKey]) => parseDateKey(dateKey) > todayTimestamp)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB));

    return Object.fromEntries(
      [...historicalEntries, ...futureEntries].sort(([dateA], [dateB]) =>
        dateA.localeCompare(dateB),
      ),
    );
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
      sessions: Array.isArray(source.sessions) ? source.sessions.filter((item) =>
        isPlainObject(item) && typeof item.id === "string" &&
        Number.isFinite(item.start) && Number.isFinite(item.end) &&
        item.end >= item.start &&
        Number.isFinite(item.credited) && item.credited >= 0
      ).map((item) => ({ ...item })) : [],
      permanentData: {
        totalFocusMinutes: toNonNegativeNumber(
          permanentData.totalFocusMinutes,
        ),
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

  // Timer ticks need one record, not a JSON copy of the entire history.
  // All data mutations replace the sessions array, invalidating this index.
  function loadSession(activeOnly = false) {
    const sessions = ensureMemoryState().data.sessions;
    if (sessions !== sessionIndexSource) {
      activeSession = undefined;
      latestSession = undefined;
      for (const session of sessions) {
        if (session.active && !activeSession) activeSession = session;
        if (!latestSession || session.end > latestSession.end) latestSession = session;
      }
      sessionIndexSource = sessions;
    }
    const session = activeOnly ? activeSession : activeSession || latestSession;
    return session ? clone(session) : undefined;
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
      sessions: Array.isArray(partialData.sessions) ? partialData.sessions : state.data.sessions,
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

  function updateDailyRecord(dateKey, fields = {}) {
    if (parseDateKey(dateKey) === null || !isPlainObject(fields)) return false;

    const state = ensureMemoryState();
    const currentRecord = state.data.dailyRecords[dateKey];
    const nextRecord = {
      focusMinutes: getRecordFocusMinutes(currentRecord),
      note:
        typeof fields.note === "string"
          ? fields.note.trim()
          : getRecordText(currentRecord, "note"),
      deadline:
        typeof fields.deadline === "string"
          ? fields.deadline.trim()
          : getRecordText(currentRecord, "deadline"),
    };
    const dailyRecords = { ...state.data.dailyRecords };

    if (
      nextRecord.focusMinutes <= 0 &&
      !nextRecord.note &&
      !nextRecord.deadline
    ) {
      delete dailyRecords[dateKey];
    } else {
      dailyRecords[dateKey] = nextRecord;
    }

    state.data = normalizeData({ ...state.data, dailyRecords });
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

  function importData(value) {
    const validNumber = (number) => Number.isFinite(number) && number >= 0;
    if (!isPlainObject(value) || !validNumber(value.totalFocusMinutes) ||
        !isPlainObject(value.dailyRecords)) {
      throw new Error("请选择专注栖所导出的 JSON 数据文件。");
    }
    for (const [dateKey, record] of Object.entries(value.dailyRecords)) {
      if (parseDateKey(dateKey) === null || !isPlainObject(record) ||
          !validNumber(record.focusMinutes) ||
          ["note", "deadline"].some((field) =>
            record[field] !== undefined && typeof record[field] !== "string")) {
        throw new Error("日历记录格式无效，原有数据未更改。");
      }
    }
    const sessions = value.sessions ?? [];
    const ids = new Set();
    if (!Array.isArray(sessions) || sessions.some((item) => {
      if (!isPlainObject(item) || typeof item.id !== "string" || !item.id ||
          ids.has(item.id) || !validNumber(item.start) || !validNumber(item.end) ||
          item.end < item.start || !Number.isSafeInteger(item.credited) ||
          item.credited < 0 ||
          (item.offsetSeconds !== undefined && !Number.isFinite(item.offsetSeconds)) ||
          (item.creditedThrough !== undefined && (!validNumber(item.creditedThrough) || item.creditedThrough < item.start || item.creditedThrough > item.end)) ||
          item.credited > Math.floor(Math.max(0, (item.end - item.start) / 1000 + (item.offsetSeconds ?? 0)) / 60)) {
        return true;
      }
      ids.add(item.id);
      return false;
    })) {
      throw new Error("专注片段格式无效，原有数据未更改。");
    }
    const current = ensureMemoryState();
    if (current.timer.state === "running" || current.data.sessions.some((item) => item.active)) {
      throw new Error("请先结束当前专注，再导入数据。");
    }
    const next = {
      version: STATE_VERSION,
      data: normalizeData({
        permanentData: { totalFocusMinutes: value.totalFocusMinutes },
        dailyRecords: value.dailyRecords,
        // Exported active sessions retain only already credited time.
        sessions: sessions.map((item) => item.active
          ? { ...item, active: false,
            creditedThrough: item.creditedThrough ?? item.start + item.credited * 60000,
            offsetSeconds: item.credited * 60 - (item.end - item.start) / 1000 }
          : { ...item, active: false }),
      }),
      timer: createDefaultTimer(),
    };
    if (!writeStorage("focus-core.before-import", current)) {
      throw new Error("无法备份原有数据，请检查浏览器存储空间。");
    }
    if (!writeStorage(APP_STATE_KEY, next)) {
      throw new Error("无法保存导入数据，原有记录未更改。");
    }
    memoryState = next;
    dirty = false;
    return true;
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
    loadSession,
    loadTimer,
    updateData,
    updateDailyRecord,
    updateTimer,
    persist,
    saveData,
    importData,
    clearData,
    readStorage,
    writeStorage,
  });
})(window);
