const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.hidden = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  get childElementCount() {
    return this.children.length;
  }
}

function loadShareModule(elements = {}) {
  const context = vm.createContext({ Number, Math, Object, String, console });
  context.window = context;
  context.document = {
    createElement: () => new FakeElement(),
    querySelector: (selector) => elements[selector] ?? null,
    querySelectorAll: () => [],
  };
  vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, "../js/share.js"), "utf8"),
    context,
  );
  return context.FocusCoreShare;
}

test("weekly remaining time uses the fixed 30-hour target", () => {
  const weeklyRemaining = new FakeElement();
  const weeklyRemainingValue = new FakeElement();
  const share = loadShareModule({
    "[data-poster-weekly-remaining]": weeklyRemaining,
    "[data-poster-weekly-remaining-value]": weeklyRemainingValue,
  });

  share.renderPoster({
    todayFocusMinutes: 269,
    weekFocusMinutes: 14 * 60 + 12,
    totalFocusMinutes: 1000,
    currentStreak: 3,
  });

  assert.equal(weeklyRemaining.hidden, false);
  assert.equal(weeklyRemaining.getAttribute("aria-hidden"), "false");
  assert.equal(weeklyRemainingValue.getAttribute("aria-label"), "15 h 48 min");
  assert.deepEqual(
    weeklyRemainingValue.children.map((measure) =>
      measure.children.map((part) => part.textContent),
    ),
    [["15", "h"], ["48", "min"]],
  );
});

test("weekly remaining area is hidden at and above the target", () => {
  const weeklyRemaining = new FakeElement();
  const weeklyRemainingValue = new FakeElement();
  const share = loadShareModule({
    "[data-poster-weekly-remaining]": weeklyRemaining,
    "[data-poster-weekly-remaining-value]": weeklyRemainingValue,
  });

  for (const weekFocusMinutes of [30 * 60, 30 * 60 + 1]) {
    share.renderPoster({ weekFocusMinutes });
    assert.equal(weeklyRemaining.hidden, true);
    assert.equal(weeklyRemaining.getAttribute("aria-hidden"), "true");
  }
});

test("share poster no longer contains the live timer presentation", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const poster = html.slice(html.indexOf('data-share-poster'), html.indexOf("</article>", html.indexOf('data-share-poster')));
  const shareCss = fs.readFileSync(path.resolve(__dirname, "../css/style.css"), "utf8");
  const shareJs = fs.readFileSync(path.resolve(__dirname, "../js/share.js"), "utf8");

  assert.match(poster, /data-poster-weekly-remaining/);
  assert.match(poster, /本周还需专注/);
  assert.doesNotMatch(poster, /沉浸此刻|data-poster-timer|share-poster__timer|rule--timer/);
  assert.doesNotMatch(shareCss, /share-poster__timer|share-poster__rule--timer/);
  assert.doesNotMatch(shareJs, /沉浸此刻|data-poster-timer|data-timer-display/);
});
