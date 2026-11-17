(function initSettingsModule(global) {
  "use strict";

  let initialized = false;

  function buildExportData(data) {
    return {
      totalFocusMinutes: data.permanentData.totalFocusMinutes,
      dailyRecords: data.dailyRecords,
      sessions: data.sessions ?? [],
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
    const importButton = document.querySelector("[data-import-data]");
    const importFile = document.querySelector("[data-import-file]");
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

    importButton?.addEventListener("click", () => {
      if (feedback) feedback.textContent = "";
      importFile.value = "";
      importFile.click();
    });

    importFile?.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      if (!file) return;
      importButton.disabled = true;
      try {
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text.replace(/^\uFEFF/, ""));
        } catch {
          throw new Error("文件不是有效的 JSON，请选择导出的数据文件。");
        }
        global.FocusCoreStorage.importData(data);
        global.dispatchEvent(new CustomEvent("focuscore:dataimported"));
        if (feedback) feedback.textContent = "导入成功，日历和统计已更新。";
      } catch (error) {
        if (feedback) feedback.textContent = `导入失败：${error.message}`;
      } finally {
        importButton.disabled = false;
        importFile.value = "";
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
