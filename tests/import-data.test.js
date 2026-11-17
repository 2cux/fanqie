const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function runtime() {
  const values = new Map();
  let failKey;
  const elements = new Map();
  const context = vm.createContext({
    console: { warn() {} },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem(key, value) {
        if (key === failKey) throw new Error("Quota exceeded");
        values.set(key, value);
      },
    },
    document: { querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        handlers: {}, value: "", textContent: "", disabled: false,
        addEventListener(name, handler) { this.handlers[name] = handler; },
        click() { this.clicked = true; },
      });
      return elements.get(selector);
    } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent(event) { context.lastEvent = event.type; },
  });
  context.window = context;
  for (const name of ["storage", "settings"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${name}.js`), "utf8"), context);
  }
  context.FocusCoreStorage.saveData({ permanentData: { totalFocusMinutes: 50 }, dailyRecords: {} });
  return { context, values, elements, fail(key) { failKey = key; }, storage: context.FocusCoreStorage };
}

function sample() {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { totalFocusMinutes: 240, dailyRecords: { [day]: { focusMinutes: 240, note: "选课" } }, sessions: [] };
}

test("import replaces records, updates derived statistics and keeps a full backup", () => {
  const { storage, values } = runtime();
  const previous = values.get("focus-core.state.v4");
  storage.importData(sample());
  assert.equal(values.get("focus-core.before-import"), previous);
  assert.equal(storage.loadData().permanentData.totalFocusMinutes, 240);
  assert.equal(storage.loadData().userState.currentStreak, 1);
  assert.equal(Object.values(storage.loadData().dailyRecords)[0].note, "选课");
  storage.importData(sample());
  assert.equal(storage.loadData().permanentData.totalFocusMinutes, 240);
});

test("invalid records, sessions and active timers leave data unchanged", () => {
  const { storage, values } = runtime();
  const previous = values.get("focus-core.state.v4");
  for (const input of [null, {}, { ...sample(), totalFocusMinutes: -1 },
    { ...sample(), dailyRecords: { "2026-02-30": { focusMinutes: 240 } } },
    { ...sample(), sessions: [{}] }]) {
    assert.throws(() => storage.importData(input));
    assert.equal(values.get("focus-core.state.v4"), previous);
    assert.equal(storage.loadData().permanentData.totalFocusMinutes, 50);
  }
  storage.updateTimer({ ...storage.loadTimer(), state: "running", startedAt: Date.now() });
  assert.throws(() => storage.importData(sample()), /请先结束/);
});

test("backup and state write failures preserve both memory and saved records", () => {
  for (const key of ["focus-core.before-import", "focus-core.state.v4"]) {
    const { storage, values, fail } = runtime();
    const previous = values.get("focus-core.state.v4");
    fail(key);
    assert.throws(() => storage.importData(sample()));
    assert.equal(values.get("focus-core.state.v4"), previous);
    assert.equal(storage.loadData().permanentData.totalFocusMinutes, 50);
    storage.persist();
    assert.equal(values.get("focus-core.state.v4"), previous);
  }
});

test("file selection imports BOM JSON, notifies the page, and allows retry after invalid JSON", async () => {
  const { context, storage, elements } = runtime();
  context.FocusCoreSettings.initSettingsPanel();
  const input = elements.get("[data-import-file]");
  const button = elements.get("[data-import-data]");
  const feedback = elements.get("[data-settings-feedback]");
  button.handlers.click();
  assert.equal(input.clicked, true);
  input.files = [{ text: async () => "invalid" }];
  await input.handlers.change();
  assert.match(feedback.textContent, /导入失败/);
  assert.equal(storage.loadData().permanentData.totalFocusMinutes, 50);
  assert.equal(button.disabled, false);
  input.files = [{ text: async () => "\uFEFF" + JSON.stringify(sample()) }];
  await input.handlers.change();
  assert.equal(context.lastEvent, "focuscore:dataimported");
  assert.match(feedback.textContent, /导入成功/);
  assert.equal(storage.loadData().permanentData.totalFocusMinutes, 240);
  assert.equal(input.value, "");
});
