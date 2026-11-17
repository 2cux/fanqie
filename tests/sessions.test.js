const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

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

test("后台或休眠数小时后只记到单段上限，重复结算不重复入账", () => {
  const r = runtime();
  r.sessions.begin(r.now(), 25);
  r.advance(3 * 60 * 60000);
  r.sessions.sync();
  r.sessions.sync();
  assert.equal(r.data().permanentData.totalFocusMinutes, 25);
  assert.equal(r.timer.state, "paused");
  assert.equal(r.sessions.elapsed(), 1500);
  assert.equal(r.sessions.active(), undefined);
});

test("补记开始后刷新恢复，补记分钟和后续分钟只计一次", () => {
  const r = runtime();
  r.sessions.begin(r.now() - 10 * 60000, 25);
  assert.equal(r.data().permanentData.totalFocusMinutes, 10);
  r.save();
  const restored = runtime(r.values, r.now() + 30 * 60000);
  restored.sessions.sync();
  assert.equal(restored.data().permanentData.totalFocusMinutes, 25);
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

test("跨午夜片段正确分配两天，次日刷新仍按原截止时间结束", () => {
  const r = runtime(new Map(), new Date(2026, 10, 17, 23, 50).getTime());
  r.sessions.begin(r.now(), 25);
  r.advance(5 * 60000);
  r.sessions.sync();
  r.save();
  const restored = runtime(r.values, new Date(2026, 10, 18, 1).getTime());
  restored.sessions.sync();
  assert.equal(restored.data().dailyRecords["2026-11-17"].focusMinutes, 10);
  assert.equal(restored.data().dailyRecords["2026-11-18"].focusMinutes, 15);
  assert.equal(restored.data().permanentData.totalFocusMinutes, 25);
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
  r.sessions.begin(r.now(), 25);
  const id = r.sessions.active().id;
  assert.throws(() => r.sessions.edit(id, r.now() - 60000, r.now()), /先结束/);
  r.advance(95000);
  r.sessions.sync(r.now(), true);
  assert.equal(r.data().permanentData.totalFocusMinutes, 1);
  r.sessions.begin(r.now(), 45);
  r.advance(45 * 60000);
  r.sessions.sync();
  assert.equal(r.data().permanentData.totalFocusMinutes, 46);
  assert.equal(r.data().sessions.length, 2);
});
