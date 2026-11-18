(function initApplication(global) {
  "use strict";

  /** 页面协调层：连接计时、统计与视图，不承载数据规则。 */
  const { FocusTimer, TIMER_STATES } = global.FocusCoreTimer;
  const { formatDuration, formatDays } = global.FocusCoreFormatters;
  const WEEKLY_FOCUS_TARGET_MINUTES = 30 * 60;
  const PERSISTENCE_CHECKPOINT_MS = 60 * 1000;

  const STATUS_TEXT = Object.freeze({
    [TIMER_STATES.IDLE]: "静候开始",
    [TIMER_STATES.RUNNING]: "沉浸此刻",
    [TIMER_STATES.PAUSED]: "稍作停留",
  });

  const ACTION_TEXT = Object.freeze({
    [TIMER_STATES.IDLE]: "开始专注",
    [TIMER_STATES.RUNNING]: "暂停专注",
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

  const APP_LIFECYCLE_KEY = "__focusCoreAppLifecycle";

  function initApp() {
    const display = document.querySelector("[data-timer-display]");
    const status = document.querySelector("[data-timer-status]");
    const actionButton = document.querySelector("[data-timer-action]");
    const heatmapContainer = document.querySelector("[data-focus-calendar]");
    const focusAtmosphere = document.querySelector("[data-focus-atmosphere]");
    const weeklyRemainingSlot = document.querySelector(
      "[data-weekly-remaining-slot]",
    );
    const weeklyRemainingValue = document.querySelector(
      "[data-weekly-remaining-value]",
    );
    const todayStat = document.querySelector("[data-stat-today]");
    const weeklyProgress = document.querySelector("[data-weekly-progress]");
    const weeklyComplete = document.querySelector("[data-weekly-complete]");
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
    const sessions = global.FocusCoreSessions ? new global.FocusCoreSessions.Sessions(timer) : null;
    let sessionView = null;
    const actionLabel = actionButton.querySelector("span") || actionButton;
    const magnet = global.createFocusMagnet?.(actionButton);
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
      syncWeeklyRemaining(statistics);
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

    function syncWeeklyRemaining(statistics) {
      if (!weeklyRemainingSlot || !weeklyRemainingValue) return;

      const weeklyFocusMinutes = Number.isFinite(statistics.weekFocusMinutes)
        ? Math.floor(statistics.weekFocusMinutes)
        : 0;
      const remainingMinutes = Math.max(
        0,
        WEEKLY_FOCUS_TARGET_MINUTES - weeklyFocusMinutes,
      );
      const isComplete = remainingMinutes <= 0;

      if (weeklyProgress) {
        weeklyProgress.value = Math.max(0, Math.min(WEEKLY_FOCUS_TARGET_MINUTES, weeklyFocusMinutes));
        weeklyProgress.setAttribute("aria-valuetext", `本周已专注 ${formatDuration(weeklyFocusMinutes)}，目标 30 小时`);
      }
      if (weeklyComplete) weeklyComplete.hidden = !isComplete;

      weeklyRemainingSlot.classList.toggle("is-hidden", isComplete);
      weeklyRemainingSlot.setAttribute("aria-hidden", String(isComplete));
      if (isComplete) return;

      const formattedValue = formatDuration(remainingMinutes);
      if (
        weeklyRemainingValue.childElementCount > 0 &&
        weeklyRemainingValue.getAttribute("aria-label") === formattedValue
      ) {
        return;
      }

      const tokens = formattedValue.trim().split(/\s+/);
      const fragments = [];
      for (let index = 0; index < tokens.length; index += 2) {
        const measure = document.createElement("span");
        const number = document.createElement("span");
        const unit = document.createElement("span");

        measure.className = "weekly-focus-remaining__measure";
        number.className = "weekly-focus-remaining__number";
        unit.className = "weekly-focus-remaining__unit";
        number.textContent = tokens[index];
        unit.textContent = tokens[index + 1] ?? "";
        measure.append(number, unit);
        fragments.push(measure);
      }

      weeklyRemainingValue.replaceChildren(...fragments);
      weeklyRemainingValue.setAttribute("aria-label", formattedValue);
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
      if (sessions) {
        const changed = sessions.sync(now);
        if (changed) {
          if (shouldSchedulePersistence) schedulePersistenceCheckpoint();
          heatmap?.render();
          sessionView?.render();
          renderState();
        }
        return changed;
      }
      if (!global.FocusCoreStatistics) return;

      const uncreditedMinutes = timer.getUncreditedMinutes(now);
      if (uncreditedMinutes <= 0) return false;

      const statisticsUpdated = global.FocusCoreStatistics.recordFocusMinutes(
        uncreditedMinutes,
      );

      if (!statisticsUpdated) {
        showNotice("专注统计更新失败。", "error");
        return false;
      }

      timer.markMinutesCredited(uncreditedMinutes, now);
      if (shouldSchedulePersistence) schedulePersistenceCheckpoint();

      heatmap?.updateDate(new Date(now));
      return true;
    }

    function renderTimer(now = Date.now()) {
      const previousState = timer.state;
      if (sessions) creditCompletedMinutes(now);
      const elapsedSeconds = sessions ? sessions.displayElapsed(now) : timer.getElapsedSeconds(now);
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
      if (actionLabel.textContent !== actionText) {
        actionLabel.textContent = actionText;
      }
      if (actionButton.dataset.state !== timer.state) {
        actionButton.dataset.state = timer.state;
      }
      if (
        focusAtmosphere &&
        focusAtmosphere.dataset.focusState !== timer.state
      ) {
        focusAtmosphere.dataset.focusState = timer.state;
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
      sessions?.sync();
      timer.resetForNewDay();
      persistState();
      syncStatistics();
      heatmap?.render();
      sessionView?.render();
      syncTimerSchedules(render());
    }

    function stopDailyMaintenance() {
      window.clearTimeout(dailyMaintenanceId);
      dailyMaintenanceId = null;
    }

    function scheduleDailyMaintenance() {
      stopDailyMaintenance();
      if (document.hidden || destroyed) return;
      const now = new Date();
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );

      dailyMaintenanceId = window.setTimeout(() => {
        dailyMaintenanceId = null;
        if (document.hidden || destroyed) return;
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
      // Session-based ticks already settle complete minutes.
      if (sessions) return;
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
      if (sessions) {
        try {
          if (sessions.active()) sessions.sync(Date.now(), true);
          else sessions.begin(Date.now());
          persistState();
          sessionView?.render();
          const elapsed = render();
          syncTimerSchedules(elapsed);
          heatmap?.render();
        } catch (error) { showNotice(error.message, "error"); }
        return;
      }
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
    sessionView = global.FocusCoreSessionUI?.init(sessions, () => {
      persistState();
      syncStatistics();
      heatmap?.render();
      syncTimerSchedules(render());
    });

    const handleVisibilityChange = () => {
      document.body.dataset.pageVisible = String(!document.hidden);
      if (!document.hidden) {
        ensureHeatmap();
        refreshForNewDay();
        creditCompletedMinutes(Date.now());
        const elapsedSeconds = render();
        motionController?.setState(timer.state, true);
        syncTimerSchedules(elapsedSeconds);
        scheduleDailyMaintenance();
      } else {
        stopTimerUpdates();
        stopMinuteSettlements();
        stopDailyMaintenance();
        creditCompletedMinutes(Date.now(), false);
        persistState();
        motionController?.destroy();
      }
    };
    addListener(document, "visibilitychange", handleVisibilityChange);
    const flushBeforeClose = () => {
      stopTimerUpdates();
      stopMinuteSettlements();
      stopDailyMaintenance();
      const now = Date.now();
      if (sessions) sessions.sync(now, true);
      else {
        timer.pause(now);
        creditCompletedMinutes(now, false);
      }
      global.FocusCoreStorage.persist();
      motionController?.destroy();
    };

    const handleStatisticsChange = (event) => {
      syncStatistics(event.detail);
    };
    addListener(global, "focuscore:statisticschange", handleStatisticsChange);
    const handleDataCleared = () => {
      if (sessions) {
        timer.snapshot = { state: "idle", elapsedSeconds: 0, startedAt: null,
          creditedMinutes: 0, timerDate: getLocalDateKey() };
        global.FocusCoreStorage.updateTimer(timer.snapshot);
        persistState();
        sessions.message = "";
        sessionView?.render();
        syncTimerSchedules(render());
      }
      syncStatistics();
      heatmap?.render();
      showNotice("所有专注数据已清除。");
    };
    addListener(global, "focuscore:datacleared", handleDataCleared);
    addListener(global, "focuscore:dataimported", () => {
      timer.snapshot = global.FocusCoreStorage.loadTimer();
      if (sessions) sessions.message = "";
      sessionView?.render();
      syncStatistics();
      heatmap?.render();
      syncTimerSchedules(render());
    });

    document.body.dataset.pageVisible = String(!document.hidden);
    creditCompletedMinutes(Date.now(), false);
    persistState();
    syncStatistics();
    const elapsedSeconds = render();
    syncTimerSchedules(elapsedSeconds);
    scheduleDailyMaintenance();
    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        magnet?.destroy();
        flushBeforeClose();
        window.clearTimeout(persistenceCheckpointId);
        window.clearTimeout(noticeTimeoutId);
        persistenceCheckpointId = null;
        noticeTimeoutId = null;
        motionController?.destroy();
        heatmap?.destroy();
        sessionView?.destroy();
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

