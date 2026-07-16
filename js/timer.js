(function initTimerModule(global) {
  "use strict";

  const { readStorage, writeStorage } = global.FocusCoreStorage;

  const TIMER_STATES = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
  });

  const STORAGE_KEY = "focus-core.timer.v1";
  const VALID_STATES = new Set(Object.values(TIMER_STATES));

  const DEFAULT_SNAPSHOT = Object.freeze({
    state: TIMER_STATES.IDLE,
    elapsedSeconds: 0,
    startedAt: null,
  });

  /**
   * 无限正计时器。
   *
   * elapsedSeconds 保存已经结算的专注秒数；运行期间再叠加
   * Date.now() - startedAt，避免依赖定时器回调次数计算时间。
   */
  class FocusTimer {
    constructor() {
      this.snapshot = this.#restore();
    }

    get state() {
      return this.snapshot.state;
    }

    getElapsedSeconds(now = Date.now()) {
      const { state, elapsedSeconds, startedAt } = this.snapshot;

      if (state !== TIMER_STATES.RUNNING || startedAt === null) {
        return elapsedSeconds;
      }

      const runningSeconds = Math.max(0, now - startedAt) / 1000;
      return elapsedSeconds + runningSeconds;
    }

    start(now = Date.now()) {
      if (this.state !== TIMER_STATES.IDLE) return false;

      this.snapshot = {
        state: TIMER_STATES.RUNNING,
        elapsedSeconds: 0,
        startedAt: now,
      };
      this.#persist();
      return true;
    }

    pause(now = Date.now()) {
      if (this.state !== TIMER_STATES.RUNNING) return false;

      this.snapshot = {
        state: TIMER_STATES.PAUSED,
        elapsedSeconds: this.getElapsedSeconds(now),
        startedAt: null,
      };
      this.#persist();
      return true;
    }

    resume(now = Date.now()) {
      if (this.state !== TIMER_STATES.PAUSED) return false;

      this.snapshot = {
        ...this.snapshot,
        state: TIMER_STATES.RUNNING,
        startedAt: now,
      };
      this.#persist();
      return true;
    }

    #persist() {
      writeStorage(STORAGE_KEY, this.snapshot);
    }

    #restore() {
      const saved = readStorage(STORAGE_KEY, DEFAULT_SNAPSHOT);
      const state = VALID_STATES.has(saved?.state)
        ? saved.state
        : TIMER_STATES.IDLE;
      const elapsedSeconds =
        Number.isFinite(saved?.elapsedSeconds) && saved.elapsedSeconds >= 0
          ? saved.elapsedSeconds
          : 0;
      const startedAt =
        Number.isFinite(saved?.startedAt) && saved.startedAt > 0
          ? saved.startedAt
          : null;

      // 运行状态缺失开始时间时无法可靠还原，降级为暂停以避免错误累加。
      if (state === TIMER_STATES.RUNNING && startedAt === null) {
        return {
          state: TIMER_STATES.PAUSED,
          elapsedSeconds,
          startedAt: null,
        };
      }

      return {
        state,
        elapsedSeconds: state === TIMER_STATES.IDLE ? 0 : elapsedSeconds,
        startedAt: state === TIMER_STATES.RUNNING ? startedAt : null,
      };
    }
  }

  global.FocusCoreTimer = Object.freeze({ FocusTimer, TIMER_STATES });
})(window);
