(function initFormattersModule(global) {
  "use strict";

  /**
   * 将完整分钟格式化为统一的统计时长。
   * 不足一小时显示为 45min；一小时起显示为 2h 05min。
   */
  function formatDuration(minutes) {
    const totalMinutes =
      Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;

    if (totalMinutes < 60) return `${totalMinutes}min`;

    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}h ${remainingMinutes}min`;
  }

  global.FocusCoreFormatters = Object.freeze({ formatDuration });
})(window);
