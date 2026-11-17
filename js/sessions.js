(function (global) {
  "use strict";
  const storage = global.FocusCoreStorage;
  const key = (time) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const minutes = (start, end) => Math.floor(Math.max(0, end - start) / 60000);
  // Allocate complete minutes by their start date, including sessions spanning midnight.
  function allocation(start, count) {
    const result = {};
    for (let i = 0; i < count; i++) {
      const date = key(start + i * 60000);
      result[date] = (result[date] || 0) + 1;
    }
    return result;
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
    active() { return (storage.loadData().sessions || []).find((s) => s.active); }
    elapsed(now = Date.now()) {
      const records = storage.loadData().sessions || [];
      const current = this.active() || records.slice().sort((a, b) => b.end - a.end)[0];
      return current ? Math.max(0, Math.min(now, current.end) - current.start) / 1000 : 0;
    }
    commit(sessions, oldSession, nextSession) {
      const data = storage.loadData();
      const before = oldSession ? allocation(oldSession.start, oldSession.credited) : {};
      const after = nextSession ? allocation(nextSession.start, nextSession.credited) : {};
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
    begin(start, duration, now = Date.now()) {
      if (this.active()) throw new Error("请先结束当前专注。");
      const end = start + duration * 60000;
      if (![25, 45, 60].includes(duration) || end <= now) throw new Error("补记的开始时间须在本段时长以内；已结束的专注请使用补录。");
      this.validate(start, end, null, now);
      const session = { id: `${now}-${Math.random().toString(36).slice(2)}`, start, end, credited: 0, active: true };
      storage.updateData({ sessions: [...(storage.loadData().sessions || []), session] });
      if (this.timer.state === "idle") this.timer.start(start);
      else this.timer.resume(start);
      this.message = "";
      this.sync(now);
    }
    sync(now = Date.now(), finish = false) {
      const old = this.active();
      if (!old) return false;
      const end = Math.min(now, old.end);
      const ended = finish || now >= old.end;
      if (!ended && (this.timer.snapshot.timerDate !== key(now) || this.timer.state !== "running")) {
        this.timer.snapshot = { state: "running", elapsedSeconds: 0, startedAt: now,
          creditedMinutes: 0, timerDate: key(now) };
        storage.updateTimer(this.timer.snapshot);
      }
      const next = { ...old, credited: minutes(old.start, end), active: !ended,
        end: ended ? end : old.end };
      if (ended) {
        this.timer.pause(end);
        if (!finish) this.message = "本段已到点，已自动暂停。仍在专注可开始下一段；超出的时间可补录。";
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
      if (old?.active) throw new Error("请先结束本段，再修正时间。");
      if (end > now) throw new Error("结束时间不能晚于现在。");
      this.validate(start, end, id, now);
      const next = { id: id || `${now}-${Math.random().toString(36).slice(2)}`, start, end,
        credited: minutes(start, end), active: false };
      this.commit(old ? sessions.map((s) => s.id === id ? next : s) : [...sessions, next], old, next);
      return storage.persist();
    }
    remove(id) {
      const sessions = storage.loadData().sessions || [];
      const old = sessions.find((s) => s.id === id);
      if (!old || old.active) throw new Error("请先结束本段。");
      this.commit(sessions.filter((s) => s.id !== id), old, null);
      return storage.persist();
    }
  }
  global.FocusCoreSessions = { Sessions };
})(window);
