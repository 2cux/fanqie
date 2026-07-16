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
    const heatmapContainer = document.querySelector("[data-focus-heatmap]");
    const energyCore = document.querySelector("[data-energy-core]");
    const energyValue = document.querySelector("[data-energy-value]");

    if (!display || !status || !actionButton) {
      console.error("计时器界面初始化失败：缺少必要的页面元素。");
      return;
    }

    const timer = new FocusTimer();

    function syncEnergyCore() {
      if (!energyCore || !energyValue || !global.FocusCoreEnergy) return;

      const energy = Math.max(0, global.FocusCoreEnergy.getEnergy());
      // 对数映射让低能量有变化，高能量又不会产生过强光晕。
      const glowStrength = Math.min(
        1,
        Math.log1p(energy) / Math.log(10_001),
      );

      energyValue.textContent = energy.toLocaleString("zh-CN");
      energyCore.style.setProperty(
        "--energy-strength",
        glowStrength.toFixed(3),
      );
      energyCore.setAttribute("aria-label", `能量核心，当前能量 ${energy}`);
    }

    if (heatmapContainer && global.FocusCoreHeatmap) {
      const { FocusHeatmap } = global.FocusCoreHeatmap;
      new FocusHeatmap(heatmapContainer).render();
    }

    function render() {
      const elapsedSeconds = timer.getElapsedSeconds();
      display.textContent = formatElapsedTime(elapsedSeconds);
      display.dateTime = `PT${Math.floor(elapsedSeconds)}S`;
      status.textContent = STATUS_TEXT[timer.state];
      actionButton.textContent = ACTION_TEXT[timer.state];
      actionButton.dataset.state = timer.state;
      if (
        energyCore &&
        energyCore.dataset.focusState !== timer.state
      ) {
        energyCore.dataset.focusState = timer.state;
      }
      if (document.body.dataset.focusState !== timer.state) {
        document.body.dataset.focusState = timer.state;
      }
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
      if (!document.hidden) {
        syncEnergyCore();
        render();
      }
    });
    global.addEventListener("focuscore:energychange", syncEnergyCore);

    syncEnergyCore();
    render();
  }

  initApp();
})(window);
