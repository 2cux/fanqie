(function initApplication(global) {
  "use strict";

  /** 页面协调层：连接计时、统计、Energy 与视图，不承载数据规则。 */
  const { FocusTimer, TIMER_STATES } = global.FocusCoreTimer;
  const { formatDuration, formatDays } = global.FocusCoreFormatters;
  const PERSISTENCE_CHECKPOINT_MS = 5 * 60 * 1000;

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

  const APP_LIFECYCLE_KEY = "__focusCoreAppLifecycle";

  function initApp() {
    const display = document.querySelector("[data-timer-display]");
    const status = document.querySelector("[data-timer-status]");
    const actionButton = document.querySelector("[data-timer-action]");
    const heatmapContainer = document.querySelector("[data-focus-calendar]");
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

    // Apply the hidden-tab rendering budget before any visual modules start.
    document.body.dataset.pageVisible = String(!document.hidden);

    const timer = new FocusTimer();
    const motionController = global.FocusCoreMotion
      ? new global.FocusCoreMotion.FocusMotionController(document)
      : null;
    let heatmap = null;
    let timerUpdateId = null;
    let minuteSettlementId = null;
    let persistenceCheckpointId = null;
    let noticeTimeoutId = null;
    let dailyMaintenanceId = null;
    let currentDateKey = getLocalDateKey();
    let renderedEnergy = null;
    const listeners = [];
    let destroyed = false;

    function addListener(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    }

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

    function renderStatValue(element, formattedValue) {
      if (!element || element.getAttribute("aria-label") === formattedValue) return;

      const tokens = formattedValue.trim().split(/\s+/);
      const fragments = [];

      for (let index = 0; index < tokens.length; index += 2) {
        const measure = document.createElement("span");
        const number = document.createElement("span");
        const unit = document.createElement("span");

        measure.className = "stat-card__measure";
        measure.setAttribute("aria-hidden", "true");
        number.className = "stat-card__number";
        number.textContent = tokens[index];
        unit.className = "stat-card__unit";
        unit.textContent = tokens[index + 1] ?? "";
        measure.append(number, unit);
        fragments.push(measure);
      }

      element.replaceChildren(...fragments);
      element.setAttribute("aria-label", formattedValue);
    }

    function syncStatistics(
      statistics = global.FocusCoreStatistics?.getStatistics(),
    ) {
      if (!statistics) return;
      if (todayStat) {
        renderStatValue(todayStat, formatDuration(statistics.todayFocusMinutes));
      }
      if (weekStat) {
        renderStatValue(weekStat, formatDuration(statistics.weekFocusMinutes));
      }
      if (totalStat) {
        renderStatValue(totalStat, formatDuration(statistics.totalFocusMinutes));
      }
      if (streakStat) {
        renderStatValue(streakStat, formatDays(statistics.currentStreak));
      }
    }

    function syncEnergyCore() {
      if (!energyCore || !energyValue || !global.FocusCoreEnergy) return;

      const energy = Math.max(0, global.FocusCoreEnergy.getEnergy());
      if (renderedEnergy === energy) return;

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
      renderedEnergy = energy;
    }

    function ensureHeatmap() {
      if (
        heatmap ||
        document.hidden ||
        !heatmapContainer ||
        !global.FocusCoreCalendar &&
        !global.FocusCoreHeatmap
      ) {
        return heatmap;
      }

      const calendarModule =
        global.FocusCoreCalendar ?? global.FocusCoreHeatmap;
      const Calendar =
        calendarModule.FocusCalendar ?? calendarModule.FocusHeatmap;
      heatmap = new Calendar(heatmapContainer).render();
      return heatmap;
    }

    ensureHeatmap();

    if (global.FocusCoreSettings) {
      global.FocusCoreSettings.initSettingsPanel();
    }

    function persistState() {
      if (persistenceCheckpointId !== null) {
        window.clearTimeout(persistenceCheckpointId);
        persistenceCheckpointId = null;
      }
      const saved = global.FocusCoreStorage.persist();
      if (!saved) {
        showNotice("专注数据保存失败，请检查浏览器存储权限。", "error");
      }
      return saved;
    }

    function schedulePersistenceCheckpoint() {
      if (persistenceCheckpointId !== null) return;

      persistenceCheckpointId = window.setTimeout(() => {
        persistenceCheckpointId = null;
        persistState();
      }, PERSISTENCE_CHECKPOINT_MS);
    }

    function creditCompletedMinutes(
      now = Date.now(),
      shouldSchedulePersistence = true,
    ) {
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
      if (shouldSchedulePersistence) schedulePersistenceCheckpoint();

      heatmap?.updateDate(new Date(now));
      return true;
    }

    function renderTimer(now = Date.now()) {
      const previousState = timer.state;
      const elapsedSeconds = timer.getElapsedSeconds(now);
      const displayText = formatElapsedTime(elapsedSeconds);
      const dateTime = `PT${Math.floor(elapsedSeconds)}S`;

      if (display.textContent !== displayText) display.textContent = displayText;
      if (display.dateTime !== dateTime) display.dateTime = dateTime;
      if (timer.state !== previousState) renderState();
      return elapsedSeconds;
    }

    function renderState() {
      const statusText = STATUS_TEXT[timer.state];
      const actionText = ACTION_TEXT[timer.state];

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
      if (
        !document.hidden &&
        motionController &&
        motionController.state !== timer.state
      ) {
        motionController.setState(timer.state, motionController.state === null);
      }
    }

    function render(now = Date.now()) {
      const elapsedSeconds = renderTimer(now);
      renderState();
      return elapsedSeconds;
    }

    function stopTimerUpdates() {
      if (timerUpdateId === null) return;
      window.clearTimeout(timerUpdateId);
      timerUpdateId = null;
    }

    function stopMinuteSettlements() {
      if (minuteSettlementId === null) return;
      window.clearTimeout(minuteSettlementId);
      minuteSettlementId = null;
    }

    function refreshForNewDay() {
      const nextDateKey = getLocalDateKey();
      if (nextDateKey === currentDateKey) return;

      currentDateKey = nextDateKey;
      timer.resetForNewDay();
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

    function scheduleTimerUpdate(elapsedSeconds = timer.getElapsedSeconds()) {
      stopTimerUpdates();
      if (timer.state !== TIMER_STATES.RUNNING || document.hidden) return;

      const elapsedMilliseconds = elapsedSeconds * 1000;
      const nextSecondDelay =
        1000 - (elapsedMilliseconds % 1000) + 16;

      timerUpdateId = window.setTimeout(() => {
        timerUpdateId = null;
        const nextElapsedSeconds = renderTimer();
        scheduleTimerUpdate(nextElapsedSeconds);
      }, nextSecondDelay);
    }

    function scheduleMinuteSettlement() {
      stopMinuteSettlements();
      if (timer.state !== TIMER_STATES.RUNNING || document.hidden) return;

      const elapsedMilliseconds = timer.getElapsedSeconds() * 1000;
      const nextMinuteDelay =
        60_000 - (elapsedMilliseconds % 60_000) + 16;

      minuteSettlementId = window.setTimeout(() => {
        minuteSettlementId = null;
        creditCompletedMinutes(Date.now());
        scheduleMinuteSettlement();
      }, nextMinuteDelay);
    }

    function syncTimerSchedules(elapsedSeconds) {
      scheduleTimerUpdate(elapsedSeconds);
      scheduleMinuteSettlement();
    }

    const handleActionClick = () => {
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

      const elapsedSeconds = render();
      syncTimerSchedules(elapsedSeconds);
    };
    addListener(actionButton, "click", handleActionClick);

    const handleVisibilityChange = () => {
      document.body.dataset.pageVisible = String(!document.hidden);
      if (!document.hidden) {
        ensureHeatmap();
        refreshForNewDay();
        creditCompletedMinutes(Date.now());
        syncEnergyCore();
        const elapsedSeconds = render();
        motionController?.setState(timer.state, true);
        syncTimerSchedules(elapsedSeconds);
      } else {
        stopTimerUpdates();
        stopMinuteSettlements();
        creditCompletedMinutes(Date.now(), false);
        persistState();
        motionController?.destroy();
      }
    };
    addListener(document, "visibilitychange", handleVisibilityChange);
    const flushBeforeClose = () => {
      stopTimerUpdates();
      stopMinuteSettlements();
      window.clearTimeout(dailyMaintenanceId);
      dailyMaintenanceId = null;
      creditCompletedMinutes(Date.now(), false);
      global.FocusCoreStorage.persist();
      motionController?.destroy();
    };

    const handleStatisticsChange = (event) => {
      syncStatistics(event.detail);
    };
    addListener(global, "focuscore:statisticschange", handleStatisticsChange);
    addListener(global, "focuscore:energychange", syncEnergyCore);
    const handleDataCleared = () => {
      syncEnergyCore();
      syncStatistics();
      heatmap?.render();
      showNotice("所有专注数据已清除。");
    };
    addListener(global, "focuscore:datacleared", handleDataCleared);

    document.body.dataset.pageVisible = String(!document.hidden);
    global.FocusCoreEnergy?.checkDecay();
    creditCompletedMinutes(Date.now(), false);
    persistState();
    syncEnergyCore();
    syncStatistics();
    const elapsedSeconds = render();
    syncTimerSchedules(elapsedSeconds);
    scheduleDailyMaintenance();
    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        flushBeforeClose();
        window.clearTimeout(persistenceCheckpointId);
        window.clearTimeout(noticeTimeoutId);
        persistenceCheckpointId = null;
        noticeTimeoutId = null;
        motionController?.destroy();
        heatmap?.destroy();
        listeners.splice(0).reverse().forEach((removeListener) => {
          removeListener();
        });
      },
    };
  }

  const lifecycle = global[APP_LIFECYCLE_KEY] ?? {
    app: null,
    bound: false,
  };

  function enterPage() {
    if (lifecycle.app) return;
    lifecycle.app = initApp();
  }

  function leavePage() {
    lifecycle.app?.destroy();
    lifecycle.app = null;
  }

  if (!lifecycle.bound) {
    lifecycle.bound = true;
    global.addEventListener("pageshow", enterPage);
    global.addEventListener("pagehide", leavePage);
  }

  global[APP_LIFECYCLE_KEY] = lifecycle;
  enterPage();
})(window);
