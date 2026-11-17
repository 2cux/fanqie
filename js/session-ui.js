(function (global) {
  "use strict";
  function init(sessions, changed) {
    const hint = document.querySelector("[data-session-hint]");
    if (!sessions || !hint) return null;
    function render() {
      hint.textContent = sessions.active()
        ? "正在专注，完成后点击「结束本段」。"
        : sessions.message || "按自己的节奏，开始与结束。";
    }
    const editor = global.FocusTimerEditor.init(sessions, () => { changed(); render(); });
    render();
    return { render, destroy() { editor.destroy(); } };
  }
  global.FocusCoreSessionUI = { init };
})(window);
