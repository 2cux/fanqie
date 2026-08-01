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

test("particle density remains unchanged with a small DOM footprint", () => {
  const particleLayer = html.match(
    /<div class="core-particles"[\s\S]*?<\/div>/,
  )?.[0];

  assert.ok(particleLayer);
  assert.equal((particleLayer.match(/<i><\/i>/g) ?? []).length, 8);
});

test("particle position animations only update compositor-friendly properties", () => {
  for (const name of ["particle-gather", "particle-settle"]) {
    const animation = keyframes(name);

    assert.match(animation, /transform:\s*translate3d\(/);
    assert.doesNotMatch(animation, /\b(?:left|top|width|height)\s*:/);
  }
});

test("particle layer isolates layout and paint work", () => {
  const rule = [...css.matchAll(/\.core-particles\s*\{(?<body>[\s\S]*?)\}/g)]
    .map((match) => match.groups.body)
    .find((body) => /container-type:\s*size/.test(body));

  assert.ok(rule);
  assert.match(rule, /container-type:\s*size/);
  assert.match(rule, /contain:\s*layout paint/);
});
