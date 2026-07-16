(function initStorageModule(global) {
  "use strict";

  /**
   * 本地存储模块。
   * 集中处理 JSON 序列化，并隔离浏览器禁用 localStorage 时产生的异常。
   */
  function readStorage(key, fallbackValue) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallbackValue : JSON.parse(value);
    } catch (error) {
      console.warn(`无法读取本地数据：${key}`, error);
      return fallbackValue;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`无法保存本地数据：${key}`, error);
      return false;
    }
  }

  global.FocusCoreStorage = Object.freeze({ readStorage, writeStorage });
})(window);
