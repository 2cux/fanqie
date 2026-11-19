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
      // A restored record is not evidence that the computer stayed on.
      const interrupted = this.active();
      if (interrupted) {
        const stoppedAt = Math.max(interrupted.start, Math.min(Date.now(),
          interrupted.creditedThrough ?? interrupted.start + interrupted.credited * 60000));
        this.sync(stoppedAt, true);
        timer.resetForNewDay();
        this.message = "上次计时已结束，离线时间未计入。";
      }
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
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const dayStart = midnight.getTime();
      const revision = storage.getSessionRevision();
      // Sum today's actual records, never the legacy cumulative display offset.
      // Cache finished records so a second tick does not copy the entire history.
      if (this.displayRevision !== revision || this.displayDay !== dayStart) {
        this.displayRevision = revision;
        this.displayDay = dayStart;
        this.displayFinishedSeconds = 0;
        this.displayActive = [];
        const data = storage.loadData();
        this.dayAdjustment = data.dailyRecords[key(now)]?.focusAdjustmentSeconds;
        for (const session of data.sessions) {
          if (session.active) this.displayActive.push(session);
          else this.displayFinishedSeconds += this.secondsToday(session, now, dayStart);
        }
      }
      return Math.max(0, (this.dayAdjustment ?? 0) + this.displayFinishedSeconds + this.displayActive.reduce(
        (total, session) => total + this.secondsToday(session, now, dayStart), 0));
    }
    secondsToday(session, now, dayStart) {
      const end = session.active ? now : Math.min(now, session.end);
      return this.secondsOnDay(session, end, dayStart, now + 1);
    }
    secondsOnDay(session, end, dayStart, until) {
      if (end < dayStart || session.start >= until) return 0;
      const seconds = effectiveSeconds(session, end);
      const effectiveEnd = Math.min(until, end, session.start + seconds * 1000);
      const overlap = Math.max(0, effectiveEnd - Math.max(dayStart, session.start)) / 1000;
      const extra = Math.max(0, seconds - (end - session.start) / 1000);
      const last = Math.max(session.start, end - 1);
      return overlap + (last >= dayStart && last < until ? extra : 0);
    }
    commit(sessions, oldSession, nextSession) {
      const data = storage.loadData();
      const before = oldSession ? allocation(oldSession) : {};
      const after = nextSession ? allocation(nextSession) : {};
      let minuteDelta = (nextSession?.credited || 0) - (oldSession?.credited || 0);
      const dates = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const [date, record] of Object.entries(data.dailyRecords)) {
        if (record.focusAdjustmentSeconds !== undefined && [oldSession, nextSession].some(
          (session) => session && key(session.start) <= date && key(session.end) >= date)) dates.add(date);
      }
      for (const date of dates) {
        const record = data.dailyRecords[date] || { focusMinutes: 0 };
        const delta = (after[date] || 0) - (before[date] || 0);
        let focusMinutes = Math.max(0, record.focusMinutes + delta);
        if (record.focusAdjustmentSeconds !== undefined) {
          const day = new Date(date + "T00:00:00");
          const start = day.getTime();
          day.setDate(day.getDate() + 1);
          const raw = sessions.reduce((sum, session) =>
            sum + this.secondsOnDay(session, session.end, start, day.getTime()), 0);
          focusMinutes = record.baseFocusMinutes + Math.floor(Math.max(0, raw + record.focusAdjustmentSeconds) / 60);
          minuteDelta += focusMinutes - record.focusMinutes - delta;
        }
        data.dailyRecords[date] = { ...record, focusMinutes };
      }
      data.permanentData.totalFocusMinutes = Math.max(0, data.permanentData.totalFocusMinutes + minuteDelta);
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
      const session = { id: `${now}-${Math.random().toString(36).slice(2)}`, start, end, credited: 0,
        active: true };
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
      const displayed = this.displayElapsed(now);
      const adjustedMinuteChanged = this.dayAdjustment !== undefined &&
        Math.floor(displayed / 60) !== Math.floor(this.displayElapsed(Math.max(old.end, new Date(now).setHours(0, 0, 0, 0))) / 60);
      if (next.credited !== old.credited || ended || adjustedMinuteChanged) {
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
    adjustToday(seconds, openedAt, expectedId, now = Date.now()) {
      if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("请选择有效的专注时长。");
      if (key(openedAt) !== key(now) || (storage.loadSession()?.id ?? null) !== expectedId) {
        throw new Error("日期或专注片段已变化，请重新打开调整。");
      }
      this.sync(now);
      const data = storage.loadData();
      const date = key(now);
      const record = data.dailyRecords[date] || { focusMinutes: 0 };
      const midnight = new Date(now).setHours(0, 0, 0, 0);
      const raw = data.sessions.reduce((sum, s) => sum + this.secondsToday(s, now, midnight), 0);
      const baseFocusMinutes = record.baseFocusMinutes ?? Math.max(0, record.focusMinutes -
        data.sessions.reduce((sum, s) => sum + (s.end >= midnight ? allocation(s)[date] || 0 : 0), 0));
      const focusMinutes = baseFocusMinutes + Math.floor(seconds / 60);
      data.dailyRecords[date] = { ...record, baseFocusMinutes, focusMinutes, focusAdjustmentSeconds: seconds - raw };
      data.permanentData.totalFocusMinutes += focusMinutes - record.focusMinutes;
      // Checkpoint the running record so a refresh retains the exact edited second.
      const active = data.sessions.find((s) => s.active);
      if (active) active.end = active.creditedThrough = now;
      storage.updateData(data);
      global.dispatchEvent(new CustomEvent("focuscore:statisticschange", { detail: global.FocusCoreStatistics.getStatistics() }));
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
