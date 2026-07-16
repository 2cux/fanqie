(function initSettingsModule(global) {
  "use strict";

  let initialized = false;

  function buildExportData(data) {
    return {
      totalFocusMinutes: data.permanentData.totalFocusMinutes,
      energy: data.permanentData.energy,
    };
  }

  function getDateKey() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${today.getFullYear()}-${month}-${day}`;
  }

  function initSettingsPanel() {
    if (initialized) return;
    const openButton = document.querySelector("[data-settings-open]");
    const settingsDialog = document.querySelector("#settings-dialog");
    const confirmDialog = document.querySelector("#clear-confirm-dialog");
    const closeButton = document.querySelector("[data-settings-close]");
    const exportButton = document.querySelector("[data-export-data]");
    const requestClearButton = document.querySelector("[data-request-clear]");
    const cancelClearButton = document.querySelector("[data-cancel-clear]");
    const confirmClearButton = document.querySelector("[data-confirm-clear]");
    const feedback = document.querySelector("[data-settings-feedback]");

    if (
      !openButton ||
      !settingsDialog ||
      !confirmDialog ||
      !closeButton ||
      !exportButton ||
      !requestClearButton ||
      !cancelClearButton ||
      !confirmClearButton
    ) {
      return;
    }

    initialized = true;

    const openSettings = () => {
      if (feedback) feedback.textContent = "";
      settingsDialog.showModal();
      openButton.setAttribute("aria-expanded", "true");
    };

    const closeSettings = () => {
      settingsDialog.close();
      openButton.setAttribute("aria-expanded", "false");
    };

    openButton.addEventListener("click", openSettings);
    closeButton.addEventListener("click", closeSettings);
    settingsDialog.addEventListener("close", () => {
      openButton.setAttribute("aria-expanded", "false");
    });
    settingsDialog.addEventListener("click", (event) => {
      if (event.target === settingsDialog) closeSettings();
    });

    exportButton.addEventListener("click", () => {
      try {
        const data = global.FocusCoreStorage.loadData();
        const exportData = buildExportData(data);
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        const objectUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");

        downloadLink.href = objectUrl;
        downloadLink.download = `focus-core-${getDateKey()}.json`;
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        if (feedback) feedback.textContent = "JSON 已导出。";
      } catch (error) {
        console.error("导出数据失败", error);
        if (feedback) feedback.textContent = "导出失败，请稍后重试。";
      }
    });

    requestClearButton.addEventListener("click", () => {
      closeSettings();
      confirmDialog.showModal();
    });

    cancelClearButton.addEventListener("click", () => {
      confirmDialog.close();
      openSettings();
    });

    confirmDialog.addEventListener("click", (event) => {
      if (event.target === confirmDialog) {
        confirmDialog.close();
        openSettings();
      }
    });

    confirmClearButton.addEventListener("click", () => {
      const cleared = global.FocusCoreStorage.clearData();
      confirmDialog.close();

      if (cleared) {
        global.dispatchEvent(new CustomEvent("focuscore:datacleared"));
        return;
      }

      openSettings();
      if (feedback) feedback.textContent = "清除失败，请检查浏览器存储权限。";
    });
  }

  global.FocusCoreSettings = Object.freeze({
    buildExportData,
    initSettingsPanel,
  });
})(window);
