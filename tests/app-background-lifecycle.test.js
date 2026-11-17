const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Execute the real coordinator and data modules with a virtual clock/DOM.
// No real waiting or browser storage is involved.
function runtime(initial, hidden = false) {
  let now = initial, nextId = 0, writes = 0;
  const pending = new Map(), values = new Map();
  const eventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    };
  };
  const display = { textContent: '', dateTime: '' };
  const label = { textContent: '' };
  const button = { ...eventTarget(), dataset: {}, querySelector: () => label };
  const elements = {
    '[data-timer-display]': display,
    '[data-timer-status]': { textContent: '' },
    '[data-timer-action]': button,
  };
  const document = { ...eventTarget(), hidden, body: { dataset: {} },
    querySelector: selector => elements[selector] || null };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ ...eventTarget(), console, document, Date: Clock,
    setTimeout(fn, delay) { const id = ++nextId; pending.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) { writes++; values.set(key, value); },
      removeItem: key => values.delete(key),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  });
  context.window = context;
  for (const name of ['storage', 'timer', 'statistics', 'sessions', 'formatters', 'app']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8'), context);
  }
  return {
    pending, context, display,
    start: () => button.dispatchEvent({ type: 'click' }),
    visible(visible) { document.hidden = !visible; document.dispatchEvent({ type: 'visibilitychange' }); },
    advance(ms) {
      const end = now + ms;
      let calls = 0;
      while (true) {
        const next = [...pending].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++calls < 10000, 'unexpected polling loop');
        now = next[1].at;
        pending.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
    data: () => context.FocusCoreStorage.loadData(),
    stats: () => context.FocusCoreStatistics.getStatistics(),
    writes: () => writes,
  };
}

test('后台初次打开不安排每日维护；反复切换只保留一个前台维护任务', () => {
  const r = runtime(new Date(2026, 10, 17, 10).getTime(), true);
  assert.equal(r.pending.size, 0);
  for (let i = 0; i < 5; i++) {
    r.visible(true);
    r.visible(true);
    assert.equal(r.pending.size, 1);
    r.visible(false);
    assert.equal(r.pending.size, 0);
  }
  r.visible(true);
  r.context.dispatchEvent({ type: 'pagehide' });
  assert.equal(r.pending.size, 0);
});

test('后台跨午夜：回前台正确分配分钟并继续计时', () => {
  const r = runtime(new Date(2026, 10, 22, 23, 50).getTime()); // Sunday -> Monday
  r.start();
  r.visible(false);
  const writes = r.writes();
  assert.equal(r.pending.size, 0);
  r.advance(15 * 60000);
  assert.equal(r.writes(), writes);
  r.visible(true);
  assert.equal(r.display.textContent, '00:15:00');
  assert.equal(r.data().dailyRecords['2026-11-22'].focusMinutes, 10);
  assert.equal(r.data().dailyRecords['2026-11-23'].focusMinutes, 5);
  assert.equal(r.stats().weekFocusMinutes, 5);
  assert.equal(r.stats().totalFocusMinutes, 15);
  assert.equal(r.context.FocusCoreStorage.loadTimer().state, 'running');
  r.advance(60020); // The display tick runs 16 ms after the second boundary.
  assert.equal(r.stats().todayFocusMinutes, 6);
  assert.equal(r.stats().totalFocusMinutes, 16);
});

test('后台挂三天不执行定时器；返回结算全部经过时间且不重复入账', () => {
  const r = runtime(new Date(2026, 10, 22, 23, 50).getTime());
  r.start();
  r.advance(61000); // Include a pending persistence checkpoint before hiding.
  r.visible(false);
  const writes = r.writes();
  assert.equal(r.pending.size, 0);
  r.advance(3 * 24 * 60 * 60000);
  assert.equal(r.pending.size, 0);
  assert.equal(r.writes(), writes);
  r.visible(true);
  assert.equal(r.display.textContent, '72:01:01');
  assert.equal(r.data().dailyRecords['2026-11-22'].focusMinutes, 10);
  assert.equal(r.data().dailyRecords['2026-11-23'].focusMinutes, 1440);
  assert.equal(r.stats().totalFocusMinutes, 4321);
  assert.equal(r.stats().todayFocusMinutes, 1431);
  assert.equal(r.stats().weekFocusMinutes, 4311);
  assert.equal(r.context.FocusCoreStorage.loadTimer().state, 'running');
  assert.equal(r.pending.size, 2);
  r.visible(false);
  r.visible(true);
  assert.equal(r.stats().totalFocusMinutes, 4321);
  assert.equal(r.pending.size, 2);
});

test('同日后台恢复仍计入离开期间的分钟', () => {
  const r = runtime(new Date(2026, 10, 17, 10).getTime());
  r.start();
  r.visible(false);
  r.advance(5 * 60000);
  r.visible(true);
  assert.equal(r.stats().totalFocusMinutes, 5);
  assert.equal(r.display.textContent, '00:05:00');
  r.visible(false);
  r.visible(true);
  assert.equal(r.stats().totalFocusMinutes, 5);
});

test('中央计时在多次暂停后连续显示，休息时间不计入', () => {
  const r = runtime(new Date(2026, 10, 17, 10).getTime());
  r.start();
  r.advance(95000);
  r.start(); // Pause.
  assert.equal(r.display.textContent, '00:01:35');
  r.advance(10 * 60000);
  r.start(); // Resume in a new independently credited segment.
  assert.equal(r.display.textContent, '00:01:35');
  r.advance(45000);
  r.start();
  assert.equal(r.display.textContent, '00:02:20');
  r.advance(60000);
  r.start();
  assert.equal(r.display.textContent, '00:02:20');
  r.advance(60020);
  assert.equal(r.display.textContent, '00:03:20');
  assert.equal(r.stats().totalFocusMinutes, 2);
  assert.equal(r.data().sessions.length, 3);
});

test('前台每日维护照常跨日并仅安排下一次；后台旧回调不会重启任务', () => {
  const r = runtime(new Date(2026, 10, 17, 23, 59, 30).getTime());
  r.advance(31000);
  assert.equal(r.context.FocusCoreStorage.loadTimer().timerDate, '2026-11-18');
  assert.equal(r.pending.size, 1);
  const stale = [...r.pending.values()][0].fn;
  r.visible(false);
  const writes = r.writes();
  stale();
  assert.equal(r.pending.size, 0);
  assert.equal(r.writes(), writes);
});
