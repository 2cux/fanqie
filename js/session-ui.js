(function (global) {
  "use strict";
  function init(sessions, changed) {
    const root = document.querySelector("[data-session-controls]");
    if (!sessions || !root) return null;
    const $ = (selector) => document.querySelector(selector);
    const list = $("[data-session-list]");
    const dialog = $("[data-session-dialog]");
    const form = $("[data-session-form]");
    const startInput = $("[data-session-start]");
    const endInput = $("[data-session-end]");
    const error = $("[data-session-error]");
    const durationInput = $("[data-session-duration]");
    const backdate = $("[data-session-backdate]");
    let mode = "add", editingId = null;
    const listeners = [];
    const on = (target, type, handler) => {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    };
    const localInput = (time) => {
      const d = new Date(time);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    };
    const timeLabel = (time) => new Date(time).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    function open(nextMode, session) {
      mode = nextMode;
      editingId = session?.id ?? null;
      const now = Date.now();
      startInput.value = localInput(session?.start ?? now - 5 * 60000);
      endInput.value = localInput(session?.end ?? now);
      endInput.required = mode !== "backdate";
      $("[data-session-end-field]").hidden = mode === "backdate";
      $("[data-session-presets]").hidden = mode !== "backdate";
      $("#session-edit-title").textContent = mode === "backdate" ? "从刚才开始计时" : mode === "edit" ? "修正这段专注" : "补录专注";
      error.textContent = "";
      dialog.showModal();
    }
    function render() {
      const active = sessions.active();
      durationInput.disabled = !!active;
      backdate.disabled = !!active;
      $("[data-session-hint]").textContent = active
        ? `本段将在 ${timeLabel(active.end)} 自动暂停。`
        : sessions.message || "准备好时开始；忘记点击也可以补记。";
      list.replaceChildren();
      const records = (global.FocusCoreStorage.loadData().sessions || []).slice().sort((a, b) => b.start - a.start).slice(0, 30);
      if (!records.length) { list.textContent = "还没有片段，从下一次专注开始记录。"; return; }
      for (const record of records) {
        const row = document.createElement("div");
        row.className = "session-row";
        const text = document.createElement("span");
        text.textContent = `${timeLabel(record.start)} — ${timeLabel(record.end)} · ${record.credited} 分钟${record.active ? " · 进行中（结束时间为计划）" : ""}`;
        row.append(text);
        if (!record.active) {
          for (const [action, label] of [["edit", "修正"], ["delete", "删除"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary-button";
            button.dataset.sessionId = record.id;
            button.dataset.sessionCommand = action;
            button.textContent = label;
            button.setAttribute("aria-label", `${label} ${timeLabel(record.start)} 的专注`);
            row.append(button);
          }
        }
        list.append(row);
      }
    }
    on(backdate, "click", () => open("backdate"));
    on($("[data-session-add]"), "click", () => open("add"));
    on($("[data-session-cancel]"), "click", () => dialog.close());
    on($("[data-session-presets]"), "click", (event) => {
      const value = event.target.closest("[data-back-minutes]")?.dataset.backMinutes;
      if (value) startInput.value = localInput(Date.now() - Number(value) * 60000);
    });
    on(form, "submit", (event) => {
      event.preventDefault();
      try {
        const start = new Date(startInput.value).getTime();
        if (mode === "backdate") sessions.begin(start, Number(durationInput.value));
        else if (!sessions.edit(editingId, start, new Date(endInput.value).getTime())) {
          throw new Error("已更新当前页面，但保存失败，请导出备份并检查存储权限。");
        }
        changed();
        render();
        dialog.close();
      } catch (e) { error.textContent = e.message; }
    });
    on(list, "click", (event) => {
      const button = event.target.closest("[data-session-command]");
      if (!button) return;
      const record = global.FocusCoreStorage.loadData().sessions.find((s) => s.id === button.dataset.sessionId);
      if (!record) return;
      if (button.dataset.sessionCommand === "edit") open("edit", record);
      else if (global.confirm("删除这段专注？对应统计时长也会扣除。")) {
        if (!sessions.remove(record.id)) sessions.message = "保存失败，请及时导出数据备份。";
        changed();
        render();
      }
    });
    render();
    return { render, duration: () => Number(durationInput.value), destroy() {
      listeners.forEach((remove) => remove());
      if (dialog.open) dialog.close();
    } };
  }
  global.FocusCoreSessionUI = { init };
})(window);
