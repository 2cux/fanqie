(function initApplication(global) {
  "use strict";

  const { FocusTimer, TIMER_STATES } = global.FocusCoreTimer;

  const STATUS_TEXT = Object.freeze({
    [TIMER_STATES.IDLE]: "未开始",
    [TIMER_STATES.RUNNING]: "正在专注",
    [TIMER_STATES.PAUSED]: "已暂停",
  });

  const ACTION_TEXT = Object.freeze({
    [TIMER_STATES.IDLE]: "开始专注",
    [TIMER_STATES.RUNNING]: "暂停",
    [TIMER_STATES.PAUSED]: "继续专注",
  });

  function formatElapsedTime(elapsedSeconds) {
    const totalSeconds = Math.max(0, Math.floor(elapsedSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
      .map((unit) => String(unit).padStart(2, "0"))
      .join(":");
  }

  function initApp() {
    const display = document.querySelector("[data-timer-display]");
    const status = document.querySelector("[data-timer-status]");
    const actionButton = document.querySelector("[data-timer-action]");

    if (!display || !status || !actionButton) {
      console.error("计时器界面初始化失败：缺少必要的页面元素。");
      return;
    }

    const timer = new FocusTimer();

    function render() {
      const elapsedSeconds = timer.getElapsedSeconds();
      display.textContent = formatElapsedTime(elapsedSeconds);
      display.dateTime = `PT${Math.floor(elapsedSeconds)}S`;
      status.textContent = STATUS_TEXT[timer.state];
      actionButton.textContent = ACTION_TEXT[timer.state];
      actionButton.dataset.state = timer.state;
    }

    actionButton.addEventListener("click", () => {
      if (timer.state === TIMER_STATES.IDLE) {
        timer.start();
      } else if (timer.state === TIMER_STATES.RUNNING) {
        timer.pause();
      } else {
        timer.resume();
      }

      render();
    });

    // 回调只负责刷新显示；实际时长始终由时间戳差值计算。
    window.setInterval(() => {
      if (timer.state === TIMER_STATES.RUNNING) render();
    }, 250);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) render();
    });

    render();
  }

  initApp();
})(window);
