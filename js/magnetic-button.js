(function (global) {
  "use strict";
  // A small, damped pull keeps the primary action steady and easy to reach.
  global.createFocusMagnet = function (button) {
    const label = button.querySelector("span");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const spring = (x, k, c) => ({ x, t: x, v: 0, k, c });
    const bx = spring(0, 170, 22), by = spring(0, 170, 22);
    const lx = spring(0, 220, 15), ly = spring(0, 220, 15);
    const scale = spring(1, 400, 30), springs = [bx, by, lx, ly, scale];
    let frame = 0, last = 0, pull = 0, pressed = false;
    const listeners = [];
    function on(target, event, handler) {
      target.addEventListener(event, handler);
      listeners.push(() => target.removeEventListener(event, handler));
    }
    function render() {
      button.style.transform = `translate(${bx.x}px, ${by.x}px) scale(${scale.x})`;
      label.style.transform = `translate(${lx.x}px, ${ly.x}px)`;
    }
    function tick(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30) / 4;
      last = now;
      for (let i = 0; i < 4; i++) for (const s of springs) {
        s.v += (-s.k * (s.x - s.t) - s.c * s.v) * dt;
        s.x += s.v * dt;
      }
      const moving = springs.some(s => Math.abs(s.x - s.t) > .001 || Math.abs(s.v) > .001);
      if (!moving) for (const s of springs) { s.x = s.t; s.v = 0; }
      render();
      frame = moving ? requestAnimationFrame(tick) : 0;
    }
    function wake() {
      if (!frame && !document.hidden && !reduced.matches) {
        last = performance.now(); frame = requestAnimationFrame(tick);
      }
    }
    function reset(immediate = false) {
      pull = 0; pressed = false;
      bx.t = by.t = lx.t = ly.t = 0; scale.t = 1;
      if (immediate) {
        cancelAnimationFrame(frame); frame = 0;
        for (const s of springs) { s.x = s.t; s.v = 0; }
        render();
      } else wake();
    }
    on(document, "pointermove", e => {
      if (e.pointerType !== "mouse" || reduced.matches || button.disabled) return;
      const r = button.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2 - bx.x);
      const dy = e.clientY - (r.top + r.height / 2 - by.x);
      const d = Math.hypot(dx, dy);
      pull = Math.max(0, 1 - d / 120);
      bx.t = dx * .12 * pull; by.t = dy * .12 * pull;
      lx.t = dx * .04 * pull; ly.t = dy * .04 * pull;
      scale.t = pressed ? .97 : 1 + .02 * pull;
      wake();
    });
    on(button, "pointerdown", e => {
      if (e.button !== 0 || reduced.matches) return;
      pressed = true; scale.t = .97; wake();
    });
    on(global, "pointerup", () => {
      if (!pressed) return;
      pressed = false; scale.t = 1 + .02 * pull; scale.v = .3; wake();
    });
    on(global, "pointercancel", () => reset());
    on(document.documentElement, "pointerleave", () => reset());
    on(global, "blur", () => reset(true));
    on(document, "visibilitychange", () => reset(true));
    on(reduced, "change", () => reset(true));
    return { destroy() { listeners.forEach(remove => remove()); reset(true); } };
  };
})(window);
