const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({ Number, Math, Object, String });
context.window = context;
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../js/formatters.js"), "utf8"),
  context,
);

const { formatDuration } = context.FocusCoreFormatters;

test("formatDuration formats durations below one hour with min", () => {
  assert.equal(formatDuration(0), "0min");
  assert.equal(formatDuration(5), "5min");
  assert.equal(formatDuration(45), "45min");
  assert.equal(formatDuration(59), "59min");
});

test("formatDuration formats hours and zero-padded remaining minutes", () => {
  assert.equal(formatDuration(60), "1h 00min");
  assert.equal(formatDuration(125), "2h 05min");
  assert.equal(formatDuration(155), "2h 35min");
});

test("formatDuration safely handles partial and invalid minutes", () => {
  assert.equal(formatDuration(5.9), "5min");
  assert.equal(formatDuration(-1), "0min");
  assert.equal(formatDuration(Number.NaN), "0min");
});
