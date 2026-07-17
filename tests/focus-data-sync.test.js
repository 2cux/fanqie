const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function createRuntime(values = new Map()) {
  const events = [];
  let writeCount = 0;
  const context = vm.createContext({
    console,
    Date,
    Math,
    JSON,
    Set,
    Object,
    Number,
    String,
    Array,
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        writeCount += 1;
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    dispatchEvent(event) {
      events.push(event);
    },
  });
  context.window = context;

  for (const file of ["storage.js", "timer.js", "statistics.js", "energy.js"]) {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, "js", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }

  return {
    context,
    events,
    values,
    getWriteCount: () => writeCount,
  };
}

function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("每满一分钟在内存中同步统计和 Energy，并只统一持久化一次", () => {
  const runtime = createRuntime();
  const { context } = runtime;
  const storage = context.FocusCoreStorage;
  const statistics = context.FocusCoreStatistics;
  const energy = context.FocusCoreEnergy;
  const timer = new context.FocusCoreTimer.FocusTimer();
  const startedAt = Date.now();

  // 第一次写入是 v4 初始化迁移，第二次是开始计时时保存 startedAt。
  assert.equal(runtime.getWriteCount(), 1);
  assert.equal(timer.start(startedAt), true);
  assert.equal(storage.persist(), true);
  assert.equal(runtime.getWriteCount(), 2);

  // 每秒只读取基于时间戳计算的显示值，不产生任何持久化写入。
  for (let second = 1; second < 60; second += 1) {
    timer.getElapsedSeconds(startedAt + second * 1_000);
  }
  assert.equal(runtime.getWriteCount(), 2);

  const now = startedAt + 60_000;
  const completedMinutes = timer.getUncreditedMinutes(now);
  assert.equal(completedMinutes, 1);
  assert.equal(statistics.recordFocusMinutes(completedMinutes), true);
  assert.equal(energy.addEnergy(completedMinutes), 1);
  assert.equal(timer.markMinutesCredited(completedMinutes, now), 1);

  const liveData = storage.loadData();
  const liveStats = statistics.getStatistics();
  assert.equal(liveStats.todayFocusMinutes, 1);
  assert.equal(liveStats.totalFocusMinutes, 1);
  assert.equal(liveData.permanentData.energy, 1);
  assert.equal(runtime.getWriteCount(), 2);

  assert.equal(storage.persist(), true);
  assert.equal(runtime.getWriteCount(), 3);
  assert.deepEqual(
    runtime.events.map((event) => event.type),
    ["focuscore:statisticschange", "focuscore:energychange"],
  );
});

test("暂停时可结算尚未提交的完整分钟并保存统一快照", () => {
  const runtime = createRuntime();
  const { context } = runtime;
  const storage = context.FocusCoreStorage;
  const timer = new context.FocusCoreTimer.FocusTimer();
  const startedAt = Date.now();

  timer.start(startedAt);
  storage.persist();
  const writesBeforePause = runtime.getWriteCount();
  const pausedAt = startedAt + 65_000;

  assert.equal(timer.pause(pausedAt), true);
  const completedMinutes = timer.getUncreditedMinutes(pausedAt);
  context.FocusCoreStatistics.recordFocusMinutes(completedMinutes);
  context.FocusCoreEnergy.addEnergy(completedMinutes);
  timer.markMinutesCredited(completedMinutes, pausedAt);
  storage.persist();

  assert.equal(runtime.getWriteCount(), writesBeforePause + 1);
  assert.equal(storage.loadTimer().state, "paused");
  assert.equal(storage.loadTimer().creditedMinutes, 1);
  assert.equal(storage.loadData().permanentData.totalFocusMinutes, 1);
  assert.equal(storage.loadData().permanentData.energy, 1);
});

test("页面意外退出后可由已保存的开始时间恢复未结算分钟", () => {
  const firstRuntime = createRuntime();
  const firstTimer = new firstRuntime.context.FocusCoreTimer.FocusTimer();
  const startedAt = Date.now() - 60_000;
  firstTimer.start(startedAt);
  firstRuntime.context.FocusCoreStorage.persist();

  // 模拟没有机会执行关闭回调，重新创建整个页面运行环境。
  const recoveredRuntime = createRuntime(firstRuntime.values);
  const { context } = recoveredRuntime;
  const recoveredTimer = new context.FocusCoreTimer.FocusTimer();
  const now = startedAt + 60_000;

  assert.equal(recoveredTimer.getUncreditedMinutes(now), 1);
  context.FocusCoreStatistics.recordFocusMinutes(1);
  context.FocusCoreEnergy.addEnergy(1);
  recoveredTimer.markMinutesCredited(1, now);
  context.FocusCoreStorage.persist();

  assert.equal(context.FocusCoreStatistics.getStatistics().totalFocusMinutes, 1);
  assert.equal(context.FocusCoreEnergy.getEnergy(), 1);
  assert.equal(context.FocusCoreStorage.loadTimer().creditedMinutes, 1);
});

test("same-day reload restores the saved timer snapshot", () => {
  const values = new Map([
    [
      "focus-core.state.v4",
      JSON.stringify({
        version: 4,
        data: {
          permanentData: { totalFocusMinutes: 12, energy: 7 },
          dailyRecords: {},
          userState: {},
        },
        timer: {
          state: "paused",
          elapsedSeconds: 125,
          startedAt: null,
          creditedMinutes: 2,
          timerDate: localDateKey(),
        },
      }),
    ],
  ]);
  const runtime = createRuntime(values);
  const timer = new runtime.context.FocusCoreTimer.FocusTimer();

  assert.equal(timer.state, "paused");
  assert.equal(timer.getElapsedSeconds(), 125);
  assert.equal(runtime.context.FocusCoreStorage.loadTimer().timerDate, localDateKey());
});

test("next-day reload resets only the current timer snapshot", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const historicalDate = localDateKey(yesterday);
  const values = new Map([
    [
      "focus-core.state.v4",
      JSON.stringify({
        version: 4,
        data: {
          permanentData: { totalFocusMinutes: 42, energy: 9 },
          dailyRecords: { [historicalDate]: { focusMinutes: 42 } },
          userState: { lastFocusDate: historicalDate },
        },
        timer: {
          state: "running",
          elapsedSeconds: 180,
          startedAt: yesterday.getTime(),
          creditedMinutes: 3,
          timerDate: historicalDate,
        },
      }),
    ],
  ]);
  const runtime = createRuntime(values);
  const timer = new runtime.context.FocusCoreTimer.FocusTimer();
  const storedTimer = runtime.context.FocusCoreStorage.loadTimer();
  const data = runtime.context.FocusCoreStorage.loadData();

  assert.equal(timer.state, "paused");
  assert.equal(timer.getElapsedSeconds(), 0);
  assert.equal(storedTimer.timerDate, localDateKey());
  assert.equal(storedTimer.startedAt, null);
  assert.equal(storedTimer.creditedMinutes, 0);
  assert.equal(data.permanentData.totalFocusMinutes, 42);
  assert.equal(data.permanentData.energy, 9);
  assert.equal(data.dailyRecords[historicalDate].focusMinutes, 42);
});

test("旧布尔与数字日记录会迁移为 focusMinutes 对象并保留 365 天", () => {
  const dateKey = (daysAgo) => {
    const now = new Date();
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysAgo,
    );
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  };
  const values = new Map([
    [
      "focus-core.data.v3",
      JSON.stringify({
        permanentData: { totalFocusMinutes: 10, energy: 4 },
        dailyRecords: {
          [dateKey(0)]: true,
          [dateKey(1)]: 8,
          [dateKey(2)]: { focusMinutes: 20 },
          [dateKey(400)]: true,
        },
        userState: { currentStreak: 99, lastFocusDate: null },
      }),
    ],
  ]);
  const runtime = createRuntime(values);
  const { context } = runtime;
  let data = context.FocusCoreStorage.loadData();

  assert.deepEqual(JSON.parse(JSON.stringify(data.dailyRecords)), {
    [dateKey(2)]: { focusMinutes: 20 },
    [dateKey(1)]: { focusMinutes: 8 },
    [dateKey(0)]: { focusMinutes: 1 },
  });
  assert.equal(data.userState.currentStreak, 3);
  assert.equal(data.userState.lastFocusDate, dateKey(0));

  assert.equal(context.FocusCoreStatistics.recordFocusMinutes(2), true);
  assert.equal(context.FocusCoreStorage.persist(), true);
  data = context.FocusCoreStorage.loadData();
  assert.equal(data.dailyRecords[dateKey(0)].focusMinutes, 3);
  assert.equal(data.permanentData.totalFocusMinutes, 12);

  const persisted = JSON.parse(values.get("focus-core.state.v4"));
  assert.equal(persisted.data.dailyRecords[dateKey(0)].focusMinutes, 3);
  assert.equal(persisted.data.dailyRecords[dateKey(1)].focusMinutes, 8);

  const v4Values = new Map([
    [
      "focus-core.state.v4",
      JSON.stringify({
        version: 4,
        data: {
          permanentData: { totalFocusMinutes: 1, energy: 1 },
          dailyRecords: { [dateKey(0)]: true },
          userState: { currentStreak: 1, lastFocusDate: dateKey(0) },
        },
        timer: {
          state: "idle",
          elapsedSeconds: 0,
          startedAt: null,
          creditedMinutes: 0,
          timerDate: dateKey(0),
        },
      }),
    ],
  ]);
  const v4Runtime = createRuntime(v4Values);
  assert.equal(
    v4Runtime.context.FocusCoreStorage.loadData().dailyRecords[dateKey(0)]
      .focusMinutes,
    1,
  );
  assert.equal(
    JSON.parse(v4Values.get("focus-core.state.v4")).data.dailyRecords[
      dateKey(0)
    ].focusMinutes,
    1,
  );
});
