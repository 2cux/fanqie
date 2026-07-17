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

const { formatDuration, formatDays } = context.FocusCoreFormatters;

test("formatDuration formats durations below one hour with min", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(5), "5 min");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(59), "59 min");
});

test("formatDuration formats hours and zero-padded remaining minutes", () => {
  assert.equal(formatDuration(60), "1 h 00 min");
  assert.equal(formatDuration(125), "2 h 05 min");
  assert.equal(formatDuration(155), "2 h 35 min");
});

test("formatDuration safely handles partial and invalid minutes", () => {
  assert.equal(formatDuration(5.9), "5 min");
  assert.equal(formatDuration(-1), "0 min");
  assert.equal(formatDuration(Number.NaN), "0 min");
});

test("formatDays uses the correct English singular and plural units", () => {
  assert.equal(formatDays(0), "0 days");
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(12), "12 days");
  assert.equal(formatDays(-1), "0 days");
});
