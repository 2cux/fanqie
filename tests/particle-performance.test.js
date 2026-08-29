const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../css/style.css"), "utf8");

function keyframes(name) {
  const animation = css.match(
    new RegExp(`@keyframes ${name}\\s*\\{(?:[^{}]|\\{[^{}]*\\})*\\}`),
  )?.[0];

  assert.ok(animation, `expected ${name} keyframes`);
  return animation;
}

test("focus atmosphere keeps a compact decorative DOM footprint", () => {
  const atmosphereStart = html.indexOf('class="focus-atmosphere"');
  const timerStart = html.indexOf('<div class="timer">', atmosphereStart);
  const atmosphere =
    atmosphereStart >= 0 && timerStart > atmosphereStart
      ? html.slice(atmosphereStart, timerStart)
      : "";

  assert.ok(atmosphere);
  assert.equal((atmosphere.match(/<i><\/i>/g) ?? []).length, 7);
  assert.doesNotMatch(atmosphere, /particle/);
});

test("atmosphere animations only update compositor-friendly properties", () => {
  for (const name of ["aura-drift-one", "mist-flow-one"]) {
    const animation = keyframes(name);

    assert.match(animation, /transform:/);
    assert.doesNotMatch(animation, /\b(?:left|top|width|height)\s*:/);
  }
});

test("atmosphere isolates its decorative layers", () => {
  const rule = css.match(
    /\.focus-atmosphere\s*\{(?<body>[\s\S]*?)\}/,
  )?.groups.body;

  assert.ok(rule);
  assert.match(rule, /isolation:\s*isolate/);
  assert.match(rule, /aspect-ratio:\s*1/);
});
