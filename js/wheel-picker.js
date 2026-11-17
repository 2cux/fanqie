/* Vanilla adaptation of Kokonut UI Wheel Picker by @dorianbaffier.
 * https://kokonutui.com/docs/inputs/wheel-picker — MIT; see THIRD_PARTY_NOTICES.md.
 */
(function (global) {
  "use strict";
  const HEIGHT = 36, ANGLE = 20;
  const RADIUS = Math.round((HEIGHT / 2 / Math.tan(ANGLE / 2 * Math.PI / 180)) * 100) / 100;
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const damp = (distance) => 1.2 * (1 - Math.exp(-distance / 1.2));
  class Wheel {
    constructor(element, max, value = 0) {
      this.element = element;
      this.max = max;
      this.position = this.target = value;
      this.frame = null;
      this.drag = null;
      this.listeners = [];
      element.setAttribute("role", "spinbutton");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-valuemin", "0");
      element.setAttribute("aria-valuemax", String(max));
      this.rows = Array.from({ length: 11 }, () => {
        const row = document.createElement("span");
        row.className = "wheel-row";
        row.setAttribute("aria-hidden", "true");
        element.append(row);
        return row;
      });
      this.on("keydown", (event) => {
        const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
        if (event.key in steps || ["Home", "End"].includes(event.key)) {
          event.preventDefault();
          this.go(event.key === "Home" ? 0 : event.key === "End" ? max : this.target + steps[event.key]);
        }
      });
      this.on("wheel", (event) => {
        event.preventDefault();
        if (event.deltaY) this.go(this.target + Math.sign(event.deltaY));
      }, { passive: false });
      this.on("pointerdown", (event) => {
        if (this.drag || (event.pointerType === "mouse" && event.button !== 0)) return;
        this.stop();
        element.focus({ preventScroll: true });
        element.setPointerCapture(event.pointerId);
        this.drag = { id: event.pointerId, y: event.clientY, position: this.position, moved: false,
          samples: [{ t: event.timeStamp, v: this.position }] };
      });
      this.on("pointermove", (event) => {
        const drag = this.drag;
        if (!drag || drag.id !== event.pointerId) return;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) < 4) return;
        drag.moved = true;
        const raw = drag.position - dy / HEIGHT;
        this.position = raw < 0 ? -damp(-raw) : raw > max ? max + damp(raw - max) : raw;
        this.target = clamp(Math.round(this.position), max);
        drag.samples.push({ t: event.timeStamp, v: raw });
        while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].t > 80) drag.samples.shift();
        this.paint();
      });
      const release = (event) => {
        const drag = this.drag;
        if (!drag || drag.id !== event.pointerId) return;
        this.drag = null;
        if (event.type !== "pointerup") { this.go(Math.round(this.position)); return; }
        if (!drag.moved) {
          const rect = element.getBoundingClientRect();
          const ratio = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / RADIUS));
          this.go(Math.round(this.position) + Math.round(Math.asin(ratio) * 180 / Math.PI / ANGLE));
          return;
        }
        const first = drag.samples[0], last = drag.samples.at(-1);
        const dt = (last.t - first.t) / 1000;
        const velocity = dt > 0 && event.timeStamp - last.t <= 80 ? (last.v - first.v) / dt : 0;
        if (this.position < 0 || this.position > max || Math.abs(velocity) < 2) this.go(Math.round(this.position));
        else this.go(Math.round(this.position + velocity * .32), velocity, true);
      };
      this.on("pointerup", release);
      this.on("pointercancel", release);
      this.on("lostpointercapture", release);
      this.paint();
    }
    on(type, handler, options) {
      this.element.addEventListener(type, handler, options);
      this.listeners.push(() => this.element.removeEventListener(type, handler, options));
    }
    paint() {
      const center = Math.round(this.position);
      this.rows.forEach((row, offset) => {
        const index = center + offset - 5;
        const angle = (index - this.position) * ANGLE;
        row.hidden = index < 0 || index > this.max || Math.abs(angle) >= 90;
        row.textContent = String(index).padStart(2, "0");
        row.style.transform = `translateZ(${-RADIUS}px) rotateX(${-angle}deg) translateZ(${RADIUS}px)`;
        row.style.opacity = String(Math.max(0, Math.cos(angle * Math.PI / 180)) ** 2);
      });
      this.element.setAttribute("aria-valuenow", String(this.value()));
    }
    stop() { if (this.frame !== null) global.cancelAnimationFrame(this.frame); this.frame = null; }
    set(value) { this.stop(); this.drag = null; this.position = this.target = clamp(value, this.max); this.paint(); }
    value() { return clamp(Math.round(this.target), this.max); }
    go(value, velocity = 0, flick = false) {
      this.stop();
      this.target = clamp(value, this.max);
      if (global.matchMedia("(prefers-reduced-motion: reduce)").matches) { this.set(this.target); return; }
      const origin = this.position - this.target, target = this.target, start = performance.now();
      const step = (now) => {
        const t = (now - start) / 1000;
        let displacement;
        if (flick) {
          // Exact mass=1, stiffness=140, damping=24 spring, carrying flick velocity.
          const a = (velocity + 14 * origin) / 4;
          displacement = a * Math.exp(-10 * t) + (origin - a) * Math.exp(-14 * t);
        } else {
          // 400 ms snap with a softly damped return (reference bounce: .15).
          const omega = 24, zeta = .85, wd = omega * Math.sqrt(1 - zeta * zeta);
          displacement = Math.exp(-zeta * omega * t) * (origin * Math.cos(wd * t) + zeta * omega * origin / wd * Math.sin(wd * t));
        }
        this.position = target + displacement;
        this.paint();
        if ((!flick && t >= .4) || (flick && t > .12 && Math.abs(displacement) < .005) || t >= 2) {
          this.set(target);
        } else this.frame = global.requestAnimationFrame(step);
      };
      this.frame = global.requestAnimationFrame(step);
    }
    destroy() { this.stop(); this.listeners.forEach((remove) => remove()); this.element.replaceChildren(); }
  }
  global.FocusWheelPicker = { Wheel };
})(window);
