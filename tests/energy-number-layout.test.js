const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
const css = fs.readFileSync(
  path.resolve(__dirname, "../css/style.css"),
  "utf8",
);

test("首页不再展示 Energy 核心", () => {
  assert.doesNotMatch(html, /ENERGY|能量核心|data-energy-core|data-energy-value/);
  assert.doesNotMatch(css, /\.energy-core|\.energy-number/);
});

test("本周剩余时间使用居中的 tabular-numeric 数字层级", () => {
  assert.match(html, /data-weekly-remaining-slot/);
  assert.match(html, /data-weekly-remaining-value/);
  const rule = css.match(
    /\.weekly-focus-remaining__value\s*\{(?<body>[\s\S]*?)\}/,
  )?.groups.body;

  assert.ok(rule, "expected a weekly remaining value rule");
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /justify-content:\s*center/);
  assert.match(rule, /line-height:\s*1/);
  assert.match(rule, /font-variant-numeric:\s*lining-nums tabular-nums/);
});
