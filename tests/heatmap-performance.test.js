const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {}

function formatDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("single-date heatmap updates touch only the requested cell", () => {
  const context = vm.createContext({
    console,
    Date,
    Element: FakeElement,
    FocusCoreFormatters: {
      formatDuration: (minutes) => `${minutes} min`,
    },
    FocusCoreStorage: { loadData: () => ({ dailyRecords: {} }) },
  });
  context.window = context;
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../js/heatmap.js"), "utf8"),
    context,
  );

  const heatmap = new context.FocusCoreHeatmap.FocusHeatmap(new FakeElement());
  const today = new Date(2026, 7, 1);
  const todayKey = formatDateKey(today);
  const otherKey = formatDateKey(new Date(2026, 6, 31));
  const updates = [];
  const createCell = (dateKey) => ({
    className: "heatmap__cell heatmap__cell--level-0",
    dataset: { duration: "0 min" },
    setAttribute(name, value) {
      updates.push([dateKey, name, value]);
    },
  });
  const todayCell = createCell(todayKey);
  const otherCell = createCell(otherKey);
  heatmap.cells.set(todayKey, todayCell);
  heatmap.cells.set(otherKey, otherCell);

  heatmap.updateDate(today, {
    [todayKey]: { focusMinutes: 31 },
    [otherKey]: { focusMinutes: 60 },
  });

  assert.equal(todayCell.className, "heatmap__cell heatmap__cell--level-2");
  assert.equal(todayCell.dataset.duration, "31 min");
  assert.equal(otherCell.className, "heatmap__cell heatmap__cell--level-0");
  assert.deepEqual(updates, [
    [todayKey, "aria-label", `${todayKey}，专注 31 min`],
  ]);
});

test("heatmap uses the requested minute boundaries", () => {
  const context = vm.createContext({
    console,
    Date,
    Element: FakeElement,
    FocusCoreFormatters: {
      formatDuration: (minutes) => `${minutes} min`,
    },
    FocusCoreStorage: { loadData: () => ({ dailyRecords: {} }) },
  });
  context.window = context;
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../js/heatmap.js"), "utf8"),
    context,
  );

  const heatmap = new context.FocusCoreHeatmap.FocusHeatmap(new FakeElement());
  const today = new Date(2026, 7, 1);
  const todayKey = formatDateKey(today);
  const cell = {
    className: "heatmap__cell heatmap__cell--level-0",
    dataset: { duration: "0 min" },
    setAttribute() {},
  };
  heatmap.cells.set(todayKey, cell);

  const expectedLevels = [
    [0, 0],
    [1, 1],
    [29, 1],
    [30, 2],
    [59, 2],
    [60, 3],
    [119, 3],
    [120, 4],
    [239, 4],
    [240, 5],
    [359, 5],
    [360, 6],
    [479, 6],
    [480, 7],
    [599, 7],
    [600, 8],
  ];

  expectedLevels.forEach(([minutes, level]) => {
    heatmap.updateDate(today, { [todayKey]: { focusMinutes: minutes } });
    assert.equal(
      cell.className,
      `heatmap__cell heatmap__cell--level-${level}`,
      `${minutes} minutes should use level ${level}`,
    );
  });
});
