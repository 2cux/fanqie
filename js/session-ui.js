(function (global) {
  "use strict";
  function init(sessions, changed) {
    const hint = document.querySelector("[data-session-hint]");
    if (!sessions || !hint) return null;
    function render() {
      hint.textContent = sessions.active()
        ? "正在专注，需要休息时点击「暂停专注」。"
        : sessions.message || (sessions.timer.state === "paused"
          ? "计时已暂停，继续专注后接着累计，休息时间不计入。"
          : "按自己的节奏，开始专注。");
    }
    const editor = global.FocusTimerEditor.init(sessions, () => { changed(); render(); });
    render();
    return { render, destroy() { editor.destroy(); } };
  }
  global.FocusCoreSessionUI = { init };
})(window);
