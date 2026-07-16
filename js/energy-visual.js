(function initEnergyVisual(global) {
  "use strict";

  /**
   * 连续饱和函数：Energy 自然增长时视觉持续增强，但不会无限过曝。
   * 函数在任意 Energy（包括 100）都没有等级或阈值跳变。
   */
  function saturatingGrowth(energy, rate) {
    const safeEnergy = Math.max(0, Number(energy) || 0);
    return 1 - Math.pow(1 + safeEnergy, -rate);
  }

  function smoothstep(edge0, edge1, value) {
    const progress = Math.max(
      0,
      Math.min(1, (value - edge0) / (edge1 - edge0)),
    );
    return progress * progress * (3 - 2 * progress);
  }

  function mapEnergyToVisuals(energy, particleCount = 12) {
    const safeEnergy = Math.max(0, Number(energy) || 0);
    const intensity = saturatingGrowth(safeEnergy, 0.22);
    const range = saturatingGrowth(safeEnergy, 0.15);
    const flow = saturatingGrowth(safeEnergy, 0.19);
    const density = saturatingGrowth(safeEnergy, 0.15);
    const lastParticle = Math.max(1, particleCount - 1);

    return {
      intensity,
      range,
      flow,
      density,
      particlePresence: Array.from({ length: particleCount }, (_, index) => {
        const threshold = index / lastParticle;
        // 淡入区间互相重叠，让“粒子变多”也保持连续。
        return smoothstep(threshold - 0.2, threshold + 0.08, density);
      }),
    };
  }

  global.FocusCoreEnergyVisual = Object.freeze({
    mapEnergyToVisuals,
    saturatingGrowth,
  });
})(window);
