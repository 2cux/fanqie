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

test("share renders only today's focus and total focus", () => {
  const today = new FakeElement(), week = new FakeElement(), total = new FakeElement();
  const share = loadShareModule({
    "[data-poster-today]": today, "[data-poster-week]": week, "[data-poster-total]": total,
  });
  share.renderPoster({ todayFocusMinutes: 181, weekFocusMinutes: 421, totalFocusMinutes: 22009, currentStreak: 83 });
  assert.equal(today.getAttribute("aria-label"), "3 h 01 min");
  assert.equal(week.getAttribute("aria-label"), null);
  assert.equal(total.getAttribute("aria-label"), "366 h 49 min");
  share.renderPoster({});
  assert.equal(today.getAttribute("aria-label"), "0 min");
});

test("streak and remaining goals are excluded from both export paths", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const poster = html.slice(html.indexOf('data-share-poster'), html.indexOf("</article>", html.indexOf('data-share-poster')));
  const js = fs.readFileSync(path.resolve(__dirname, "../js/share.js"), "utf8");
  assert.doesNotMatch(poster, /data-poster-streak|data-poster-weekly-remaining|data-poster-timer/);
  assert.doesNotMatch(js, /currentStreak|weekFocusMinutes|THIS WEEK|weeklyRemaining|WEEKLY_FOCUS_TARGET/);
  assert.match(poster, /data-poster-today/);
  assert.doesNotMatch(poster, /data-poster-week|THIS WEEK/);
  assert.match(poster, /data-poster-total/);
});
