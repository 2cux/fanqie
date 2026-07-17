(function initFormattersModule(global) {
  "use strict";

  /**
   * 将完整分钟格式化为统一的统计时长。
   * 不足一小时显示为 45 min；一小时起显示为 2 h 05 min。
   */
  function formatDuration(minutes) {
    const totalMinutes =
      Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;

    if (totalMinutes < 60) return `${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours} h ${remainingMinutes} min`;
  }

  /** 将连续专注天数格式化为带英文单复数的统计值。 */
  function formatDays(days) {
    const totalDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
    return `${totalDays} ${totalDays === 1 ? "day" : "days"}`;
  }

  global.FocusCoreFormatters = Object.freeze({ formatDuration, formatDays });
})(window);
