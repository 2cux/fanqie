(function initApplication(global) {
  "use strict";

  /** 页面协调层：连接计时、统计、Energy 与视图，不承载数据规则。 */
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
    const todayStat = document.querySelector("[data-stat-today]");
    const weekStat = document.querySelector("[data-stat-week]");
    const totalStat = document.querySelector("[data-stat-total]");
    const streakStat = document.querySelector("[data-stat-streak]");
    const appNotice = document.querySelector("[data-app-notice]");

    if (!display || !status || !actionButton) {
      console.error("计时器界面初始化失败：缺少必要的页面元素。");
      return;
    }

    const timer = new FocusTimer();
    let heatmap = null;
    let timerUpdateId = null;
    let noticeTimeoutId = null;
    let dailyMaintenanceId = null;
    let currentDateKey = getLocalDateKey();

    const formatMetric = (value) =>
      value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });

    function getLocalDateKey(date = new Date()) {
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${date.getFullYear()}-${month}-${day}`;
    }

    function showNotice(message, type = "info") {
      if (!appNotice) return;

      window.clearTimeout(noticeTimeoutId);
      appNotice.textContent = message;
      appNotice.dataset.type = type;
      appNotice.hidden = false;
      noticeTimeoutId = window.setTimeout(() => {
        appNotice.hidden = true;
      }, 3200);
    }

    function syncStatistics() {
      if (!global.FocusCoreStatistics) return;

      const statistics = global.FocusCoreStatistics.getStatistics();
      if (todayStat) {
        todayStat.textContent = formatMetric(statistics.todayFocusMinutes);
      }
      if (weekStat) {
        weekStat.textContent = formatMetric(statistics.weekFocusMinutes);
      }
      if (totalStat) {
        totalStat.textContent = formatMetric(statistics.totalFocusMinutes);
      }
      if (streakStat) {
        streakStat.textContent = statistics.currentStreak.toLocaleString("zh-CN");
      }
    }

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
      heatmap = new FocusHeatmap(heatmapContainer).render();
    }

    if (global.FocusCoreSettings) {
      global.FocusCoreSettings.initSettingsPanel();
    }

    function creditCompletedMinutes() {
      if (!global.FocusCoreStatistics || !global.FocusCoreEnergy) return;

      const uncreditedMinutes = timer.getUncreditedMinutes();
      if (uncreditedMinutes <= 0) return;

      const previousTodayMinutes =
        global.FocusCoreStatistics.getStatistics().todayFocusMinutes;
      const statisticsSaved = global.FocusCoreStatistics.recordFocusMinutes(
        uncreditedMinutes,
      );

      if (!statisticsSaved) {
        showNotice("专注数据保存失败，请检查浏览器存储权限。", "error");
        return;
      }

      // 先标记统计结算，避免界面刷新时重复累计同一分钟。
      if (!timer.markMinutesCredited(uncreditedMinutes)) {
        showNotice("计时进度保存失败，请检查浏览器存储权限。", "error");
      }
      const energyBefore = global.FocusCoreEnergy.getEnergy();
      const energyAfter = global.FocusCoreEnergy.addEnergy(uncreditedMinutes);
      if (energyAfter < energyBefore + uncreditedMinutes) {
        showNotice("Energy 保存失败，请检查浏览器存储权限。", "error");
      }

      syncStatistics();
      // 热力图每天只需在第一分钟完成时重绘一次。
      if (previousTodayMinutes <= 0) heatmap?.render();
    }

    function render() {
      const elapsedSeconds = timer.getElapsedSeconds();
      const displayText = formatElapsedTime(elapsedSeconds);
      const dateTime = `PT${Math.floor(elapsedSeconds)}S`;
      const statusText = STATUS_TEXT[timer.state];
      const actionText = ACTION_TEXT[timer.state];

      if (display.textContent !== displayText) display.textContent = displayText;
      if (display.dateTime !== dateTime) display.dateTime = dateTime;
      if (status.textContent !== statusText) status.textContent = statusText;
      if (actionButton.textContent !== actionText) {
        actionButton.textContent = actionText;
      }
      if (actionButton.dataset.state !== timer.state) {
        actionButton.dataset.state = timer.state;
      }
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

    function stopTimerUpdates() {
      if (timerUpdateId === null) return;
      window.clearTimeout(timerUpdateId);
      timerUpdateId = null;
    }

    function refreshForNewDay() {
      const nextDateKey = getLocalDateKey();
      if (nextDateKey === currentDateKey) return;

      currentDateKey = nextDateKey;
      global.FocusCoreEnergy?.checkDecay();
      syncEnergyCore();
      syncStatistics();
      heatmap?.render();
    }

    function scheduleDailyMaintenance() {
      window.clearTimeout(dailyMaintenanceId);
      const now = new Date();
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );

      dailyMaintenanceId = window.setTimeout(() => {
        refreshForNewDay();
        scheduleDailyMaintenance();
      }, nextDay.getTime() - now.getTime() + 1000);
    }

    function scheduleTimerUpdate() {
      stopTimerUpdates();
      if (timer.state !== TIMER_STATES.RUNNING || document.hidden) return;

      const elapsedMilliseconds = timer.getElapsedSeconds() * 1000;
      const nextSecondDelay =
        1000 - (elapsedMilliseconds % 1000) + 16;

      timerUpdateId = window.setTimeout(() => {
        timerUpdateId = null;
        creditCompletedMinutes();
        render();
        scheduleTimerUpdate();
      }, nextSecondDelay);
    }

    actionButton.addEventListener("click", () => {
      if (timer.state === TIMER_STATES.IDLE) {
        timer.start();
      } else if (timer.state === TIMER_STATES.RUNNING) {
        timer.pause();
      } else {
        timer.resume();
      }

      creditCompletedMinutes();
      render();
      scheduleTimerUpdate();
    });

    document.addEventListener("visibilitychange", () => {
      document.body.dataset.pageVisible = String(!document.hidden);
      if (!document.hidden) {
        refreshForNewDay();
        creditCompletedMinutes();
        syncEnergyCore();
        render();
        scheduleTimerUpdate();
      } else {
        stopTimerUpdates();
      }
    });
    global.addEventListener("focuscore:energychange", syncEnergyCore);
    global.addEventListener("focuscore:datacleared", () => {
      syncEnergyCore();
      syncStatistics();
      heatmap?.render();
      showNotice("所有专注数据已清除。");
    });

    document.body.dataset.pageVisible = String(!document.hidden);
    global.FocusCoreEnergy?.checkDecay();
    creditCompletedMinutes();
    syncEnergyCore();
    syncStatistics();
    render();
    scheduleTimerUpdate();
    scheduleDailyMaintenance();
  }

  initApp();
})(window);
