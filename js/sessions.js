(function (global) {
  "use strict";
  const storage = global.FocusCoreStorage;
  const key = (time) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const minutes = (start, end) => Math.floor(Math.max(0, end - start) / 60000);
  // Allocate complete minutes by their start date, including sessions spanning midnight.
  function allocation(session) {
    const { start, credited: count } = session;
    const through = session.creditedThrough ?? session.end;
    const result = {};
    for (let i = 0; i < count; i++) {
      // Effective time may exceed wall-clock time. Never assign it to a future day.
      const date = key(Math.min(start + i * 60000, Math.max(start, through - 1)));
      result[date] = (result[date] || 0) + 1;
    }
    return result;
  }
  function effectiveSeconds(session, now) {
    return Math.max(0, ((session.active ? now : Math.min(now, session.end)) - session.start) / 1000 +
      (Number.isFinite(session.offsetSeconds) ? session.offsetSeconds : 0));
  }
  class Sessions {
    constructor(timer) {
      this.timer = timer;
      this.message = "";
      if (timer.state === "running" && !this.active()) {
        timer.snapshot = { ...timer.snapshot, state: "paused", startedAt: null,
          elapsedSeconds: timer.snapshot.creditedMinutes * 60 };
        storage.updateTimer(timer.snapshot);
        this.message = "上次计时已暂停，未确认的离开时间未补算。可通过补录补上实际专注。";
      }
    }
    active() { return storage.loadSession(true); }
    elapsed(now = Date.now()) {
      const current = storage.loadSession();
      return current ? effectiveSeconds(current, now) : 0;
    }
    displayElapsed(now = Date.now()) {
      const current = storage.loadSession();
      if (!current) return 0;
      return effectiveSeconds(current, now) +
        (Number.isFinite(current.displayOffsetSeconds) ? Math.max(0, current.displayOffsetSeconds) : 0);
    }
    commit(sessions, oldSession, nextSession) {
      const data = storage.loadData();
      const before = oldSession ? allocation(oldSession) : {};
      const after = nextSession ? allocation(nextSession) : {};
      for (const date of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const record = data.dailyRecords[date] || { focusMinutes: 0 };
        data.dailyRecords[date] = { ...record,
          focusMinutes: Math.max(0, record.focusMinutes + (after[date] || 0) - (before[date] || 0)) };
      }
      data.permanentData.totalFocusMinutes = Math.max(0, data.permanentData.totalFocusMinutes +
        (nextSession?.credited || 0) - (oldSession?.credited || 0));
      data.sessions = sessions;
      if (nextSession?.credited > 0) data.userState.lastFocusTimestamp = Date.now();
      storage.updateData(data);
      global.dispatchEvent(new CustomEvent("focuscore:statisticschange", {
        detail: global.FocusCoreStatistics.getStatistics(),
      }));
    }
    validate(start, end, exceptId = null, now = Date.now()) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start > now ||
          end - start > 24 * 60 * 60000 || start < now - 364 * 24 * 60 * 60000) {
        throw new Error("请选择最近一年内的有效时间，每段不超过 24 小时。");
      }
      if ((storage.loadData().sessions || []).some((s) => s.id !== exceptId && start < s.end && end > s.start)) {
        throw new Error("这段时间与已有记录重叠，请调整起止时间。");
      }
    }
    begin(start, now = Date.now()) {
      if (this.active()) throw new Error("请先结束当前专注。");
      const end = now;
      if (!Number.isFinite(start) || start > now || start < now - 364 * 24 * 60 * 60000) {
        throw new Error("请选择有效的开始时间。");
      }
      const previous = storage.loadSession();
      // Carry the displayed time across same-day breaks without crediting it again.
      const displayOffsetSeconds = previous && key(previous.end) === key(start)
        ? this.displayElapsed(now) : 0;
      const session = { id: `${now}-${Math.random().toString(36).slice(2)}`, start, end, credited: 0,
        active: true, displayOffsetSeconds };
      storage.updateData({ sessions: [...(storage.loadData().sessions || []), session] });
      if (this.timer.state === "idle") this.timer.start(start);
      else this.timer.resume(start);
      this.message = "";
      this.sync(now);
    }
    sync(now = Date.now(), finish = false) {
      const old = this.active();
      if (!old) return false;
      const end = Math.max(old.start, now);
      const ended = finish;
      if (!ended && (this.timer.snapshot.timerDate !== key(now) || this.timer.state !== "running")) {
        this.timer.snapshot = { state: "running", elapsedSeconds: 0, startedAt: now,
          creditedMinutes: 0, timerDate: key(now) };
        storage.updateTimer(this.timer.snapshot);
      }
      const next = { ...old, credited: Math.floor(effectiveSeconds(old, end) / 60), active: !ended,
        creditedThrough: end,
        end };
      if (ended) {
        this.timer.pause(end);
      }
      if (next.credited !== old.credited || ended) {
        this.commit(storage.loadData().sessions.map((s) => s.id === old.id ? next : s), old, next);
        if (ended) storage.persist();
        return true;
      }
      return false;
    }
    edit(id, start, end, now = Date.now()) {
      const sessions = storage.loadData().sessions || [];
      const old = sessions.find((s) => s.id === id);
      if (old?.active) throw new Error("请先暂停专注，再修正时间。");
      if (end > now) throw new Error("结束时间不能晚于现在。");
      this.validate(start, end, id, now);
      const next = { id: id || `${now}-${Math.random().toString(36).slice(2)}`, start, end,
        credited: minutes(start, end), active: false };
      this.commit(old ? sessions.map((s) => s.id === id ? next : s) : [...sessions, next], old, next);
      return storage.persist();
    }
    adjustElapsed(seconds, expectedId, now = Date.now()) {
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86399) {
        throw new Error("请选择 1 秒到 23 小时 59 分 59 秒之间的专注时长。");
      }
      this.sync(now);
      const old = storage.loadSession();
      if ((old?.id ?? null) !== expectedId) throw new Error("当前片段已变化，请关闭后重新调整。");
      const through = old?.active ? now : old ? Math.min(now, old.end) : now;
      const start = old?.start ?? now - seconds * 1000;
      const next = { ...old, id: old?.id ?? `${now}-${Math.random().toString(36).slice(2)}`,
        start, end: old?.active ? now : old?.end ?? now, active: old?.active ?? false,
        offsetSeconds: seconds - (through - start) / 1000,
        creditedThrough: through, credited: Math.floor(seconds / 60) };
      const records = storage.loadData().sessions;
      this.commit(old ? records.map((s) => s.id === old.id ? next : s) : [...records, next], old, next);
      // The timer snapshot tracks effective elapsed time; session timestamps stay unchanged.
      this.timer.snapshot = { state: next.active ? "running" : "paused", elapsedSeconds: seconds,
        startedAt: next.active ? now : null, creditedMinutes: next.credited, timerDate: key(now) };
      storage.updateTimer(this.timer.snapshot);
      this.message = "已按实际专注时长更新记录。";
      return storage.persist();
    }
    remove(id) {
      const sessions = storage.loadData().sessions || [];
      const old = sessions.find((s) => s.id === id);
      if (!old || old.active) throw new Error("请先暂停专注。");
      this.commit(sessions.filter((s) => s.id !== id), old, null);
      return storage.persist();
    }
  }
  global.FocusCoreSessions = { Sessions };
})(window);
