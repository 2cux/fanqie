const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const share = fs.readFileSync(path.join(root, "js/share.js"), "utf8");

test("hidden pages freeze and remove decorative animation layers", () => {
  assert.match(
    css,
    /body\[data-page-visible="false"\] \*,[\s\S]*?animation-play-state:\s*paused\s*!important/,
  );
  assert.match(
    css,
    /body\[data-page-visible="false"\] \.ambient-background,[\s\S]*?display:\s*none\s*!important/,
  );
});

test("hidden pages defer heatmap construction until visible", () => {
  assert.match(app, /function ensureHeatmap\(\)/);
  assert.match(app, /document\.hidden/);
  assert.match(app, /ensureHeatmap\(\);/);
});

test("poster capture library loads only when requested", () => {
  assert.doesNotMatch(html, /html2canvas@1\.4\.1\/dist\/html2canvas\.min\.js/);
  assert.match(share, /function loadHtml2Canvas\(\)/);
  assert.match(share, /4000/);
});
