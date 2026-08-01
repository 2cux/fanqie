const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
const css = fs.readFileSync(
  path.resolve(__dirname, "../css/style.css"),
  "utf8",
);

test("Energy uses a dedicated number component", () => {
  assert.match(
    html,
    /<strong class="energy-number" data-energy-value>0<\/strong>/,
  );
  assert.doesNotMatch(css, /\.energy-core__inner\s+strong\s*\{/);
});

test("Energy number keeps a fixed centered tabular-numeric slot", () => {
  const rule = css.match(/\.energy-number\s*\{(?<body>[\s\S]*?)\}/)?.groups.body;

  assert.ok(rule, "expected a dedicated .energy-number rule");
  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /width:\s*5ch/);
  assert.match(rule, /height:\s*1em/);
  assert.match(rule, /place-items:\s*center/);
  assert.match(rule, /line-height:\s*1/);
  assert.match(rule, /font-variant-numeric:\s*lining-nums tabular-nums/);
});
