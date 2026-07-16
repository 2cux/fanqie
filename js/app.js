(function initApplication(global) {
  "use strict";

  /** 页面协调层：连接计时、统计、Energy 与视图，不承载数据规则。 */
  const { FocusTimer, TIMER_STATES } = global.FocusCoreTimer;
  const { formatDuration } = global.FocusCoreFormatters;

  const STATUS_TEXT = Object.freeze({
    [TIMER_STATES.IDLE]: "静候开始",
    [TIMER_STATES.RUNNING]: "沉浸此刻",
    [TIMER_STATES.PAUSED]: "稍作停留",
  });

  const ACTION_TEXT = Object.freeze({
    [TIMER_STATES.IDLE]: "进入专注",
    [TIMER_STATES.RUNNING]: "暂歇",
    [TIMER_STATES.PAUSED]: "回到专注",
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
    const energyParticles = energyCore
      ? Array.from(energyCore.querySelectorAll(".core-particles i"))
      : [];
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

    function syncStatistics(
      statistics = global.FocusCoreStatistics?.getStatistics(),
    ) {
      if (!statistics) return;
      if (todayStat) {
        todayStat.textContent = formatDuration(statistics.todayFocusMinutes);
      }
      if (weekStat) {
        weekStat.textContent = formatDuration(statistics.weekFocusMinutes);
      }
      if (totalStat) {
        totalStat.textContent = formatDuration(statistics.totalFocusMinutes);
      }
      if (streakStat) {
        streakStat.textContent = statistics.currentStreak.toLocaleString("zh-CN");
      }
    }

    function syncEnergyCore() {
      if (!energyCore || !energyValue || !global.FocusCoreEnergy) return;

      const energy = Math.max(0, global.FocusCoreEnergy.getEnergy());
      const visuals = global.FocusCoreEnergyVisual?.mapEnergyToVisuals(
        energy,
        energyParticles.length,
      ) ?? { intensity: 0, range: 0, flow: 0, particlePresence: [] };

      energyValue.textContent = energy.toLocaleString("zh-CN");
      energyCore.style.setProperty("--energy-strength", visuals.intensity.toFixed(4));
      energyCore.style.setProperty("--energy-range", visuals.range.toFixed(4));
      energyCore.style.setProperty("--energy-flow", visuals.flow.toFixed(4));
      energyParticles.forEach((particle, index) => {
        particle.style.setProperty(
          "--particle-presence",
          (visuals.particlePresence[index] ?? 0).toFixed(4),
        );
      });
      energyCore.setAttribute("aria-label", `能量核心，当前能量 ${energy}`);
    }

    if (heatmapContainer && global.FocusCoreHeatmap) {
      const { FocusHeatmap } = global.FocusCoreHeatmap;
      heatmap = new FocusHeatmap(heatmapContainer).render();
    }

    if (global.FocusCoreSettings) {
      global.FocusCoreSettings.initSettingsPanel();
    }

    function persistState() {
      const saved = global.FocusCoreStorage.persist();
      if (!saved) {
        showNotice("专注数据保存失败，请检查浏览器存储权限。", "error");
      }
      return saved;
    }

    function creditCompletedMinutes(now = Date.now(), shouldPersist = true) {
      if (!global.FocusCoreStatistics || !global.FocusCoreEnergy) return;

      const uncreditedMinutes = timer.getUncreditedMinutes(now);
      if (uncreditedMinutes <= 0) return false;

      const statisticsUpdated = global.FocusCoreStatistics.recordFocusMinutes(
        uncreditedMinutes,
      );

      if (!statisticsUpdated) {
        showNotice("专注统计更新失败。", "error");
        return false;
      }

      const energyBefore = global.FocusCoreEnergy.getEnergy();
      const energyAfter = global.FocusCoreEnergy.addEnergy(uncreditedMinutes);
      if (energyAfter < energyBefore + uncreditedMinutes) {
        showNotice("Energy 更新失败。", "error");
        return false;
      }

      timer.markMinutesCredited(uncreditedMinutes, now);
      if (shouldPersist) persistState();

      heatmap?.render();
      return true;
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
      persistState();
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
        creditCompletedMinutes(Date.now());
        render();
        scheduleTimerUpdate();
      }, nextSecondDelay);
    }

    actionButton.addEventListener("click", () => {
      if (timer.state === TIMER_STATES.IDLE) {
        timer.start();
        persistState();
      } else if (timer.state === TIMER_STATES.RUNNING) {
        const now = Date.now();
        timer.pause(now);
        creditCompletedMinutes(now, false);
        persistState();
      } else {
        timer.resume();
        persistState();
      }

      render();
      scheduleTimerUpdate();
    });

    document.addEventListener("visibilitychange", () => {
      document.body.dataset.pageVisible = String(!document.hidden);
      if (!document.hidden) {
        refreshForNewDay();
        creditCompletedMinutes(Date.now());
        syncEnergyCore();
        render();
        scheduleTimerUpdate();
      } else {
        stopTimerUpdates();
      }
    });
    const flushBeforeClose = () => {
      stopTimerUpdates();
      window.clearTimeout(dailyMaintenanceId);
      dailyMaintenanceId = null;
      creditCompletedMinutes(Date.now(), false);
      global.FocusCoreStorage.persist();
    };
    global.addEventListener("pagehide", flushBeforeClose);
    global.addEventListener("pageshow", () => {
      refreshForNewDay();
      render();
      scheduleTimerUpdate();
      scheduleDailyMaintenance();
    });
    global.addEventListener("focuscore:statisticschange", (event) => {
      syncStatistics(event.detail);
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
    creditCompletedMinutes(Date.now(), false);
    persistState();
    syncEnergyCore();
    syncStatistics();
    render();
    scheduleTimerUpdate();
    scheduleDailyMaintenance();
  }

  initApp();
})(window);
