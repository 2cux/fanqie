(function initEnergyModule(global) {
  "use strict";

  const { loadData, updateData } = global.FocusCoreStorage;
  const ENERGY_DECAY_INTERVAL = 24 * 60 * 60 * 1000;

  function getTimestamp(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getTime();
    }

    return Number.isFinite(value) ? value : null;
  }

  function getEnergy() {
    return Math.floor(loadData().permanentData.energy);
  }

  function emitEnergyChange(energy) {
    if (typeof global.CustomEvent !== "function") return;

    global.dispatchEvent(
      new CustomEvent("focuscore:energychange", {
        detail: { energy },
      }),
    );
  }

  /**
   * Add Energy for completed focus minutes and record the precise time of the
   * latest valid focus. Fractions do not produce Energy.
   */
  function addEnergy(completedMinutes = 1) {
    if (!Number.isFinite(completedMinutes) || completedMinutes <= 0) {
      return getEnergy();
    }

    const increment = Math.floor(completedMinutes);
    const data = loadData();
    const currentEnergy = Math.floor(data.permanentData.energy);
    if (increment < 1) return currentEnergy;

    const nextEnergy = currentEnergy + increment;
    if (
      !updateData({
        permanentData: { energy: nextEnergy },
        userState: {
          lastFocusTimestamp: Date.now(),
          // A valid focus starts a new inactivity cycle, even if it happens in
          // the same millisecond as the previous decay check.
          lastEnergyDecayTimestamp: null,
        },
      })
    ) {
      return currentEnergy;
    }

    emitEnergyChange(nextEnergy);
    return nextEnergy;
  }

  /**
   * Halve Energy once after 24 continuous hours without valid focus.
   * A decay is eligible only when the latest focus has not already caused one.
   */
  function checkDecay(referenceTime = new Date()) {
    const nowTimestamp = getTimestamp(referenceTime);
    if (nowTimestamp === null) return getEnergy();

    const data = loadData();
    const originalEnergy = Math.floor(data.permanentData.energy);
    const lastFocusTimestamp = getTimestamp(
      data.userState.lastFocusTimestamp,
    );
    const lastEnergyDecayTimestamp = getTimestamp(
      data.userState.lastEnergyDecayTimestamp,
    );

    const hasBeenInactiveFor24Hours =
      lastFocusTimestamp !== null &&
      nowTimestamp - lastFocusTimestamp >= ENERGY_DECAY_INTERVAL;
    const latestFocusHasNotDecayed =
      lastFocusTimestamp !== null &&
      (lastEnergyDecayTimestamp === null ||
        lastEnergyDecayTimestamp < lastFocusTimestamp);

    if (!hasBeenInactiveFor24Hours || !latestFocusHasNotDecayed) {
      return originalEnergy;
    }

    const nextEnergy = Math.floor(originalEnergy / 2);
    if (
      !updateData({
        permanentData: { energy: nextEnergy },
        userState: { lastEnergyDecayTimestamp: nowTimestamp },
      })
    ) {
      return originalEnergy;
    }

    if (nextEnergy !== originalEnergy) emitEnergyChange(nextEnergy);
    return nextEnergy;
  }

  global.FocusCoreEnergy = Object.freeze({
    addEnergy,
    checkDecay,
    getEnergy,
  });
})(window);
