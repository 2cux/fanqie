(function initFocusMotion(global) {
  "use strict";

  const STATE_RATES = Object.freeze({
    idle: Object.freeze({ core: 0.72, ambient: 0.68 }),
    running: Object.freeze({ core: 1.42, ambient: 1.2 }),
    paused: Object.freeze({ core: 0.38, ambient: 0.32 }),
  });

  const AMBIENT_ANIMATIONS = new Set([
    "ambient-gradient-breathe",
    "ambient-light-drift-one",
    "ambient-light-drift-two",
    "ambient-flow-drift",
    "ambient-shadow-breathe",
    "ambient-particle-drift",
    "ambient-mist-drift-one",
    "ambient-mist-drift-two",
  ]);

  const CORE_ANIMATIONS = new Set([
    "core-breathe",
    "core-halo-breathe",
    "aura-drift-one",
    "aura-drift-two",
    "aura-drift-three",
    "energy-flow",
    "energy-flow-reverse",
    "particle-drift",
    "particle-orbit",
    "particle-gather",
  ]);

  function easeInOutCubic(progress) {
    const value = Math.max(0, Math.min(1, Number(progress) || 0));
    return value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function getAnimationRate(animation, rates) {
    if (AMBIENT_ANIMATIONS.has(animation.animationName)) return rates.ambient;
    if (CORE_ANIMATIONS.has(animation.animationName)) return rates.core;
    return null;
  }

  class FocusMotionController {
    constructor(root = document, options = {}) {
      this.root = root;
      this.duration = options.duration ?? 1500;
      this.requestFrame = options.requestFrame ?? global.requestAnimationFrame.bind(global);
      this.cancelFrame = options.cancelFrame ?? global.cancelAnimationFrame.bind(global);
      this.now = options.now ?? (() => global.performance.now());
      this.frameId = null;
      this.state = null;
    }

    getAnimations() {
      return typeof this.root.getAnimations === "function"
        ? this.root.getAnimations({ subtree: true })
        : [];
    }

    setState(state, immediate = false) {
      const rates = STATE_RATES[state] ?? STATE_RATES.idle;
      const animations = this.getAnimations();
      const targets = animations
        .map((animation) => ({
          animation,
          from: Number(animation.playbackRate) || 1,
          to: getAnimationRate(animation, rates),
        }))
        .filter(({ to }) => to !== null);

      if (this.frameId !== null) this.cancelFrame(this.frameId);
      this.frameId = null;
      this.state = state;

      if (immediate || this.duration <= 0) {
        targets.forEach(({ animation, to }) => this.updateRate(animation, to));
        return;
      }

      const startedAt = this.now();
      const tick = (timestamp) => {
        const progress = Math.min(1, (timestamp - startedAt) / this.duration);
        const eased = easeInOutCubic(progress);
        targets.forEach(({ animation, from, to }) => {
          this.updateRate(animation, from + (to - from) * eased);
        });

        if (progress < 1) {
          this.frameId = this.requestFrame(tick);
        } else {
          this.frameId = null;
        }
      };

      this.frameId = this.requestFrame(tick);
    }

    updateRate(animation, rate) {
      if (typeof animation.updatePlaybackRate === "function") {
        animation.updatePlaybackRate(rate);
      } else {
        animation.playbackRate = rate;
      }
    }

    destroy() {
      if (this.frameId !== null) this.cancelFrame(this.frameId);
      this.frameId = null;
    }
  }

  global.FocusCoreMotion = Object.freeze({
    FocusMotionController,
    STATE_RATES,
    easeInOutCubic,
  });
})(window);
