(function (global) {
  "use strict";
  function init(sessions, changed) {
    const dialog = document.querySelector("#timer-edit-dialog");
    const trigger = document.querySelector("[data-timer-edit]");
    const error = dialog.querySelector("[data-time-editor-error]");
    const context = dialog.querySelector("[data-time-editor-context]");
    let wheels = [], expectedId = null;
    const listeners = [];
    const on = (element, name, handler) => {
      element.addEventListener(name, handler);
      listeners.push(() => element.removeEventListener(name, handler));
    };
    const dispose = () => { wheels.forEach((wheel) => wheel.destroy()); wheels = []; };
    on(trigger, "click", () => {
      sessions.sync();
      changed();
      const record = global.FocusCoreStorage.loadSession();
      expectedId = record?.id ?? null;
      const elapsed = Math.min(86399, Math.floor(sessions.elapsed()));
      error.textContent = "";
      context.textContent = record?.active
        ? "只调整有效专注时长，不改变起止时间；保存后继续计时。"
        : record ? "只调整有效专注时长，不改变起止时间；保存后仍保持暂停。" : "还没有片段，保存后会补记一段截至现在的专注。";
      dispose();
      wheels = [
        new global.FocusWheelPicker.Wheel(dialog.querySelector("[data-wheel-hours]"), 23, Math.floor(elapsed / 3600)),
        new global.FocusWheelPicker.Wheel(dialog.querySelector("[data-wheel-minutes]"), 59, Math.floor(elapsed / 60) % 60),
        new global.FocusWheelPicker.Wheel(dialog.querySelector("[data-wheel-seconds]"), 59, elapsed % 60),
      ];
      dialog.showModal();
      wheels[1].element.focus();
    });
    dialog.querySelectorAll("[data-time-editor-cancel]").forEach((button) => on(button, "click", () => dialog.close()));
    on(dialog, "close", () => { dispose(); trigger.focus({ preventScroll: true }); });
    on(dialog.querySelector("form"), "submit", (event) => {
      event.preventDefault();
      const seconds = wheels[0].value() * 3600 + wheels[1].value() * 60 + wheels[2].value();
      try {
        const saved = sessions.adjustElapsed(seconds, expectedId);
        changed();
        if (!saved) throw new Error("当前记录已更新，但本地保存失败，请导出备份。");
        dialog.close();
      } catch (err) { error.textContent = err.message; }
    });
    return { destroy() { dispose(); listeners.forEach((remove) => remove()); if (dialog.open) dialog.close(); } };
  }
  global.FocusTimerEditor = { init };
})(window);
