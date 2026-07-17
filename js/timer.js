(function initTimerModule(global) {
  "use strict";

  const { loadTimer, updateTimer } = global.FocusCoreStorage;

  const TIMER_STATES = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
  });

  function getLocalDateKey(now = Date.now()) {
    const date = new Date(now);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  class FocusTimer {
    constructor() {
      this.snapshot = loadTimer();
    }

    get state() {
      return this.snapshot.state;
    }

    resetForNewDay(now = Date.now()) {
      const today = getLocalDateKey(now);
      if (this.snapshot.timerDate === today) return false;

      this.snapshot = {
        state: TIMER_STATES.PAUSED,
        elapsedSeconds: 0,
        startedAt: null,
        creditedMinutes: 0,
        timerDate: today,
      };
      updateTimer(this.snapshot);
      return true;
    }

    getElapsedSeconds(now = Date.now()) {
      this.resetForNewDay(now);
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
        timerDate: getLocalDateKey(now),
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
      this.resetForNewDay(now);
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
