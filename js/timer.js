(function initTimerModule(global) {
  "use strict";

  const { loadTimer, updateTimer } = global.FocusCoreStorage;

  const TIMER_STATES = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
  });

  class FocusTimer {
    constructor() {
      this.snapshot = loadTimer();
    }

    get state() {
      return this.snapshot.state;
    }

    getElapsedSeconds(now = Date.now()) {
      const { state, elapsedSeconds, startedAt } = this.snapshot;
      if (state !== TIMER_STATES.RUNNING || startedAt === null) {
        return elapsedSeconds;
      }

      return elapsedSeconds + Math.max(0, now - startedAt) / 1000;
    }

    getUncreditedMinutes(now = Date.now()) {
      const completedMinutes = Math.floor(this.getElapsedSeconds(now) / 60);
      return Math.max(0, completedMinutes - this.snapshot.creditedMinutes);
    }

    markMinutesCredited(minutes, now = Date.now()) {
      const availableMinutes = this.getUncreditedMinutes(now);
      const creditedNow = Math.min(Math.floor(minutes), availableMinutes);
      if (!Number.isFinite(creditedNow) || creditedNow <= 0) return 0;

      this.snapshot = {
        ...this.snapshot,
        creditedMinutes: this.snapshot.creditedMinutes + creditedNow,
      };
      updateTimer(this.snapshot);
      return creditedNow;
    }

    start(now = Date.now()) {
      if (this.state !== TIMER_STATES.IDLE) return false;
      this.snapshot = {
        state: TIMER_STATES.RUNNING,
        elapsedSeconds: 0,
        startedAt: now,
        creditedMinutes: 0,
      };
      updateTimer(this.snapshot);
      return true;
    }

    pause(now = Date.now()) {
      if (this.state !== TIMER_STATES.RUNNING) return false;
      this.snapshot = {
        ...this.snapshot,
        state: TIMER_STATES.PAUSED,
        elapsedSeconds: this.getElapsedSeconds(now),
        startedAt: null,
      };
      updateTimer(this.snapshot);
      return true;
    }

    resume(now = Date.now()) {
      if (this.state !== TIMER_STATES.PAUSED) return false;
      this.snapshot = {
        ...this.snapshot,
        state: TIMER_STATES.RUNNING,
        startedAt: now,
      };
      updateTimer(this.snapshot);
      return true;
    }
  }

  global.FocusCoreTimer = Object.freeze({ FocusTimer, TIMER_STATES });
})(window);
