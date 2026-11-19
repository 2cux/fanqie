const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

test("旧版没有确认时间的运行片段重开后结束，不补算离线时间", () => {
  const r = runtime();
  r.sessions.begin(r.now());
  const data = r.data();
  data.sessions[0].end = r.now() + 25 * 60000;
  r.context.FocusCoreStorage.updateData(data);
  r.save();
  const restored = runtime(r.values, r.now() + 90 * 60000);
  restored.sessions.sync();
  assert.equal(restored.sessions.elapsed(), 0);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 0);
  assert.equal(restored.timer.state, "paused");
});

test("直接修改运行时长同步统计，不设截止时间，刷新不重复计入", () => {
  const r = runtime();
  r.sessions.begin(r.now());
  const old = r.sessions.active();
  r.advance(10 * 60000);
  r.sessions.sync();
  r.sessions.adjustElapsed(20 * 60, old.id);
  assert.equal(r.sessions.elapsed(), 1200);
  assert.equal(r.sessions.active().end, r.now());
  assert.equal(r.sessions.active().start, old.start);
  assert.equal(r.timer.state, "running");
  assert.equal(r.data().permanentData.totalFocusMinutes, 20);
  const restored = runtime(r.values, r.now() + 60000);
  restored.sessions.sync();
  assert.equal(restored.data().permanentData.totalFocusMinutes, 20);
  restored.sessions.adjustElapsed(5 * 60, old.id);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 5);
  restored.advance(60 * 60000);
  restored.sessions.sync();
  assert.equal(restored.sessions.elapsed(), 5 * 60);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 5);
  assert.equal(restored.data().sessions[0].start, old.start);
  assert.equal(restored.data().sessions[0].end, r.now());
});

test("没有片段时直接补记；暂停时修改保留结束时间和暂停状态", () => {
  const r = runtime();
  r.sessions.adjustElapsed(600, null);
  const record = r.data().sessions[0];
  r.advance(60000);
  r.sessions.adjustElapsed(1200, record.id);
  assert.equal(r.data().sessions[0].end, record.end);
  assert.equal(r.data().sessions[0].start, record.start);
  assert.equal(r.data().permanentData.totalFocusMinutes, 20);
  assert.equal(r.timer.state, "paused");
});

test("直接调整不因相邻记录重叠而拒绝，仍保护过期编辑", () => {
  const r = runtime(new Map(), new Date(2026, 10, 18, 0, 10).getTime());
  r.sessions.adjustElapsed(20 * 60, null);
  assert.equal(r.data().dailyRecords["2026-11-17"].focusMinutes, 10);
  assert.equal(r.data().dailyRecords["2026-11-18"].focusMinutes, 10);
  const old = r.data().sessions[0];
  r.sessions.begin(r.now());
  assert.throws(() => r.sessions.adjustElapsed(600, old.id), /片段已变化/);
  const active = r.sessions.active();
  r.sessions.adjustElapsed(600, active.id);
  assert.equal(r.sessions.active().start, active.start);
  assert.equal(r.sessions.active().end, active.end);
  assert.throws(() => r.sessions.adjustElapsed(0, r.sessions.active().id), /请选择/);
  assert.equal(r.data().permanentData.totalFocusMinutes, 30);
});

test("修正后的有效时长刷新、重复保存、删除与导入保持一致", () => {
  const r = runtime();
  r.sessions.adjustElapsed(600, null);
  const record = r.data().sessions[0];
  r.sessions.adjustElapsed(3600, record.id);
  const restored = runtime(r.values, r.now() + 60000);
  assert.equal(restored.sessions.elapsed(), 3600);
  restored.sessions.adjustElapsed(3600, record.id);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 60);
  const data = restored.data();
  restored.context.FocusCoreStorage.importData({ totalFocusMinutes: data.permanentData.totalFocusMinutes,
    dailyRecords: data.dailyRecords, sessions: data.sessions });
  assert.equal(restored.sessions.elapsed(), 3600);
  assert.equal(restored.data().sessions[0].start, record.start);
  assert.equal(restored.data().sessions[0].end, record.end);
  restored.sessions.remove(record.id);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 0);
  assert.equal(restored.context.FocusCoreStatistics.getStatistics().todayFocusMinutes, 0);
});

test("午夜前增加有效时长不会把额外时间算到未来日期", () => {
  const r = runtime(new Map(), new Date(2026, 10, 17, 23, 59).getTime());
  r.sessions.begin(r.now());
  const record = r.sessions.active();
  r.sessions.adjustElapsed(3600, record.id);
  assert.equal(r.data().dailyRecords["2026-11-17"].focusMinutes, 60);
  assert.equal(r.data().dailyRecords["2026-11-18"], undefined);
  r.sessions.sync(r.now(), true);
  // An immediate stop still retains the effective time.
  assert.equal(r.data().permanentData.totalFocusMinutes, 60);
  assert.equal(r.data().sessions.length, 1);
  assert.equal(r.sessions.elapsed(), 3600);
  r.sessions.remove(record.id);
  assert.equal(r.data().permanentData.totalFocusMinutes, 0);
});

function runtime(values = new Map(), initial = new Date(2026, 10, 17, 10).getTime()) {
  let now = initial;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ console, Date: Clock,
    localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    dispatchEvent() {},
  });
  context.window = context;
  for (const name of ["storage", "timer", "statistics", "sessions"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${name}.js`), "utf8"), context);
  }
  const timer = new context.FocusCoreTimer.FocusTimer();
  const sessions = new context.FocusCoreSessions.Sessions(timer);
  return { context, timer, sessions, values, now: () => now,
    advance: (ms) => { now += ms; }, data: () => context.FocusCoreStorage.loadData(),
    save: () => context.FocusCoreStorage.persist() };
}

test("连续显示在刷新和时长修正后保留，下一天新片段重新计时", () => {
  const r = runtime();
  r.sessions.begin(r.now());
  r.advance(95000);
  r.sessions.sync(r.now(), true);
  r.advance(60000);
  r.sessions.begin(r.now());
  r.advance(25000);
  r.sessions.sync(r.now(), true);
  r.save();
  const restored = runtime(r.values, r.now());
  assert.equal(restored.sessions.displayElapsed(), 120);
  assert.equal(restored.sessions.elapsed(), 25);
  restored.sessions.adjustElapsed(60, restored.data().sessions.at(-1).id);
  assert.equal(restored.sessions.displayElapsed(), 155);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 2);
  restored.sessions.sync(restored.now(), true);
  const paused = runtime(restored.values, restored.now() + 60000);
  assert.equal(paused.sessions.displayElapsed(), 155);
  paused.sessions.begin(paused.now());
  assert.equal(paused.sessions.displayElapsed(), 155);
  paused.sessions.sync(paused.now(), true);
  paused.advance(24 * 60 * 60000);
  paused.sessions.begin(paused.now());
  assert.equal(paused.sessions.displayElapsed(), 0);
});

test("大量历史记录下每秒计时不序列化完整历史，也不写入存储", () => {
  const r = runtime();
  const history = Array.from({ length: 10000 }, (_, i) => ({
    id: `history-${i}`, start: r.now() - (i + 2) * 60000,
    end: r.now() - (i + 1) * 60000, credited: 1, active: false,
  }));
  r.context.FocusCoreStorage.updateData({ sessions: history });
  r.sessions.begin(r.now());
  r.save();
  const persisted = r.values.get("focus-core.state.v4");
  r.sessions.displayElapsed(); // Warm the daily summary before measuring ticks.
  let largestSerialization = 0;
  r.context.JSON = { parse: JSON.parse, stringify(value) {
    const result = JSON.stringify(value);
    largestSerialization = Math.max(largestSerialization, result.length);
    return result;
  } };
  for (let i = 1; i <= 59; i++) {
    r.advance(1000);
    assert.equal(r.sessions.sync(), false);
    assert.equal(r.sessions.elapsed(), i);
    r.sessions.displayElapsed();
  }
  assert.ok(largestSerialization < 500, `tick serialized ${largestSerialization} characters`);
  assert.equal(r.values.get("focus-core.state.v4"), persisted);
});

test("片段索引在修改、删除和清空后更新，读取结果不能改写存储", () => {
  const r = runtime();
  const storage = r.context.FocusCoreStorage;
  assert.equal(storage.loadSession(), undefined);
  r.sessions.begin(r.now());
  const copy = storage.loadSession(true);
  copy.end = 0;
  assert.equal(storage.loadSession(true).end, r.now());
  r.advance(60000);
  r.sessions.sync(r.now(), true);
  assert.equal(storage.loadSession(true), undefined);
  assert.equal(storage.loadSession().credited, 1);
  r.sessions.remove(copy.id);
  assert.equal(storage.loadSession(), undefined);
  r.sessions.edit(null, r.now() - 60000, r.now());
  assert.equal(storage.loadSession().credited, 1);
  storage.clearData();
  assert.equal(storage.loadSession(), undefined);
});

test("后台或休眠数小时后持续计时，重复结算不重复入账", () => {
  const r = runtime();
  r.sessions.begin(r.now());
  r.advance(3 * 60 * 60000);
  r.sessions.sync();
  r.sessions.sync();
  assert.equal(r.data().permanentData.totalFocusMinutes, 180);
  assert.equal(r.timer.state, "running");
  assert.equal(r.sessions.elapsed(), 10800);
  r.sessions.sync(r.now(), true);
  r.advance(60000);
  assert.equal(r.sessions.elapsed(), 10800);
  assert.equal(r.timer.state, "paused");
  assert.equal(r.sessions.active(), undefined);
});

test("补记开始后重开保留已保存分钟，不补算离线时间", () => {
  const r = runtime();
  r.sessions.begin(r.now() - 10 * 60000);
  assert.equal(r.data().permanentData.totalFocusMinutes, 10);
  r.save();
  const restored = runtime(r.values, r.now() + 30 * 60000);
  restored.sessions.sync();
  assert.equal(restored.data().permanentData.totalFocusMinutes, 10);
  assert.equal(restored.data().sessions.length, 1);
});

test("修正、跨日移动和删除片段同步累计、每日与连续天数，保留旧数据", () => {
  const r = runtime();
  r.context.FocusCoreStorage.updateData({ permanentData: { totalFocusMinutes: 100 },
    dailyRecords: { "2026-11-16": { focusMinutes: 100, note: "旧记录" } } });
  r.sessions.edit(null, r.now() - 30 * 60000, r.now());
  const id = r.data().sessions[0].id;
  assert.equal(r.data().permanentData.totalFocusMinutes, 130);
  r.sessions.edit(id, r.now() - 20 * 60000, r.now());
  assert.equal(r.data().permanentData.totalFocusMinutes, 120);
  r.sessions.edit(id, r.now() - 24 * 60 * 60000 - 20 * 60000, r.now() - 24 * 60 * 60000);
  assert.equal(r.data().dailyRecords["2026-11-17"], undefined);
  assert.equal(r.data().dailyRecords["2026-11-16"].focusMinutes, 120);
  assert.equal(r.context.FocusCoreStatistics.getStatistics().currentStreak, 1);
  r.sessions.remove(id);
  assert.equal(r.data().permanentData.totalFocusMinutes, 100);
  assert.equal(r.data().dailyRecords["2026-11-16"].note, "旧记录");
});

test("次日重开结束旧片段并清零显示，历史统计保留", () => {
  const r = runtime(new Map(), new Date(2026, 10, 17, 23, 50).getTime());
  r.sessions.begin(r.now());
  r.advance(5 * 60000);
  r.sessions.sync();
  r.save();
  const restored = runtime(r.values, new Date(2026, 10, 18, 1).getTime());
  restored.sessions.sync();
  assert.equal(restored.data().dailyRecords["2026-11-17"].focusMinutes, 5);
  assert.equal(restored.data().dailyRecords["2026-11-18"], undefined);
  assert.equal(restored.sessions.displayElapsed(), 0);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 5);
  assert.equal(restored.timer.state, "paused");
});

test("重叠记录、未来结束和无效时间被拒绝，相邻片段可以补录", () => {
  const r = runtime();
  r.sessions.edit(null, r.now() - 30 * 60000, r.now() - 15 * 60000);
  assert.throws(() => r.sessions.edit(null, r.now() - 20 * 60000, r.now()), /重叠/);
  assert.throws(() => r.sessions.edit(null, r.now(), r.now() + 60000), /晚于现在/);
  assert.throws(() => r.sessions.edit(null, NaN, r.now()), /有效时间/);
  r.sessions.edit(null, r.now() - 15 * 60000, r.now());
  assert.equal(r.data().permanentData.totalFocusMinutes, 30);
});

test("旧版运行状态不自动补算未知离开时间", () => {
  const r = runtime();
  r.timer.start(r.now() - 60 * 60000);
  const migrated = new r.context.FocusCoreSessions.Sessions(r.timer);
  assert.equal(r.timer.state, "paused");
  assert.equal(r.data().permanentData.totalFocusMinutes, 0);
  assert.match(migrated.message, /未确认/);
});

test("提前结束只计算完整分钟，下段独立记录且修改运行中片段被拒绝", () => {
  const r = runtime();
  r.sessions.begin(r.now());
  const id = r.sessions.active().id;
  assert.throws(() => r.sessions.edit(id, r.now() - 60000, r.now()), /先暂停/);
  r.advance(95000);
  r.sessions.sync(r.now(), true);
  assert.equal(r.data().permanentData.totalFocusMinutes, 1);
  r.sessions.begin(r.now());
  r.advance(45 * 60000);
  r.sessions.sync();
  assert.equal(r.data().permanentData.totalFocusMinutes, 46);
  assert.equal(r.data().sessions.length, 2);
});


test("旧版累计显示偏移不带入今天，今天零时长记录显示零", () => {
  const r = runtime();
  const now = r.now();
  r.context.FocusCoreStorage.updateData({ sessions: [
    { id: "yesterday", start: now - 86400000 - 29675000,
      end: now - 86400000, credited: 494, active: false },
    { id: "today-empty", start: now, end: now, credited: 0,
      active: false, displayOffsetSeconds: 29675 },
  ] });
  assert.equal(r.sessions.displayElapsed(), 0);
  r.sessions.begin(now);
  r.advance(95000);
  r.sessions.sync(r.now(), true);
  assert.equal(r.sessions.displayElapsed(), 95);
});

test("当天全部片段相加，补录、删除和修改后立即重新计算", () => {
  const r = runtime();
  r.sessions.edit("first", r.now() - 600000, r.now() - 300000);
  r.sessions.edit("second", r.now() - 120000, r.now());
  assert.equal(r.sessions.displayElapsed(), 420);
  r.sessions.remove("first");
  assert.equal(r.sessions.displayElapsed(), 120);
  r.sessions.edit("second", r.now() - 60000, r.now());
  assert.equal(r.sessions.displayElapsed(), 60);
  r.sessions.edit("yesterday", r.now() - 86400000 - 600000, r.now() - 86400000);
  assert.equal(r.sessions.displayElapsed(), 60);
});

test("跨日的手动修正按当天有效时长显示，不恢复历史累计偏移", () => {
  const r = runtime(new Map(), new Date(2026, 10, 18, 0, 10).getTime());
  r.sessions.adjustElapsed(1200, null);
  assert.equal(r.sessions.displayElapsed(), 600);
  const record = r.data().sessions[0];
  r.sessions.adjustElapsed(300, record.id);
  assert.equal(r.sessions.displayElapsed(), 0);
});

test("修改今日累计时长可低于先前片段，运行、导入和次日显示正确", () => {
  const r = runtime();
  r.sessions.edit("first", r.now() - 600000, r.now());
  r.sessions.begin(r.now());
  r.advance(75000);
  const openedAt = r.now();
  const id = r.sessions.active().id;
  assert.equal(r.sessions.displayElapsed(), 675);
  r.advance(5000);
  r.sessions.adjustToday(59, openedAt, id);
  assert.equal(r.sessions.elapsed(), 80);
  assert.equal(r.sessions.displayElapsed(), 59);
  assert.equal(r.timer.state, "running");
  assert.equal(r.data().permanentData.totalFocusMinutes, 0);
  const data = r.data();
  const copy = runtime(new Map(), r.now());
  copy.context.FocusCoreStorage.importData({ ...data, totalFocusMinutes: 0 });
  assert.equal(copy.sessions.displayElapsed(), 59);
  r.advance(1000);
  r.sessions.sync();
  assert.equal(r.sessions.displayElapsed(), 60);
  assert.equal(r.data().permanentData.totalFocusMinutes, 1);
  r.sessions.sync(r.now(), true);
  r.sessions.adjustToday(0, r.now(), id);
  assert.equal(r.sessions.displayElapsed(), 0);
  assert.equal(r.timer.state, "paused");
  r.advance(86400000);
  assert.throws(() => r.sessions.adjustToday(300, openedAt, id), /日期/);
  r.sessions.adjustToday(300, r.now(), id);
  assert.equal(r.sessions.displayElapsed(), 300);
  assert.equal(r.data().sessions.length, 2);
});
