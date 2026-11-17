(function initShareModule(global) {
  "use strict";

  const SHARE_LIFECYCLE_KEY = "__focusCoreShareLifecycle";

  function toSafeNumber(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function formatPosterDuration(minutes) {
    const totalMinutes = Math.floor(toSafeNumber(minutes));
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours} h ${remainingMinutes} min`;
  }

  function formatPosterDays(days) {
    const totalDays = Math.floor(toSafeNumber(days));
    return `${totalDays} ${totalDays === 1 ? "day" : "days"}`;
  }

  function readShareData() {
    const statistics = global.FocusCoreStatistics?.getStatistics?.() ?? {};

    return {
      todayFocusMinutes: toSafeNumber(statistics.todayFocusMinutes),
      weekFocusMinutes: toSafeNumber(statistics.weekFocusMinutes),
      totalFocusMinutes: toSafeNumber(statistics.totalFocusMinutes),
    };
  }

  function renderPosterMeasure(selector, formattedValue) {
    const element = document.querySelector(selector);
    if (!element) return;

    const tokens = String(formattedValue).trim().split(/\s+/);
    const fragments = [];

    for (let index = 0; index < tokens.length; index += 2) {
      const measure = document.createElement("span");
      const number = document.createElement("span");
      const unit = document.createElement("span");

      measure.className = "share-poster__measure-pair";
      number.className = "share-poster__number";
      unit.className = "share-poster__unit";
      number.textContent = tokens[index];
      unit.textContent = tokens[index + 1] ?? "";
      measure.append(number, unit);
      fragments.push(measure);
    }

    element.replaceChildren(...fragments);
    element.setAttribute("aria-label", formattedValue);
  }

  function renderPoster(data = readShareData()) {
    renderPosterMeasure("[data-poster-today]", formatPosterDuration(data.todayFocusMinutes));
    renderPosterMeasure("[data-poster-week]", formatPosterDuration(data.weekFocusMinutes));
    renderPosterMeasure("[data-poster-total]", formatPosterDuration(data.totalFocusMinutes));

  }

  // Offline export uses the same three public statistics as the preview.
  async function createFallbackPosterCanvas(data) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas 导出。");

    const centerX = canvas.width / 2;
    const drawCenteredText = (text, y, font, color) => {
      context.font = font;
      context.fillStyle = color;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, centerX, y);
    };
    const drawMeasure = (text, y, numberFont, unitFont, numberColor, unitColor, xCenter = centerX) => {
      const tokens = String(text).trim().split(/\s+/);
      const pairs = [];
      const pairGap = 8;
      const measureGap = 18;

      for (let index = 0; index < tokens.length; index += 2) {
        const number = tokens[index];
        const unit = tokens[index + 1] ?? "";
        context.font = numberFont;
        const numberWidth = context.measureText(number).width;
        context.font = unitFont;
        const unitWidth = context.measureText(unit).width;
        pairs.push({ number, unit, numberWidth, unitWidth });
      }

      const totalWidth = pairs.reduce(
        (sum, pair) => sum + pair.numberWidth + pairGap + pair.unitWidth,
        0,
      ) + Math.max(0, pairs.length - 1) * measureGap;
      let x = xCenter - totalWidth / 2;

      pairs.forEach((pair, index) => {
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        context.font = numberFont;
        context.fillStyle = numberColor;
        context.fillText(pair.number, x, y);
        x += pair.numberWidth + pairGap;
        context.font = unitFont;
        context.fillStyle = unitColor;
        context.fillText(pair.unit, x, y);
        x += pair.unitWidth;
        if (index < pairs.length - 1) x += measureGap;
      });
    };
    const drawSoftRule = (y) => {
      const gradient = context.createLinearGradient(180, y, 900, y);
      gradient.addColorStop(0, "rgba(224, 216, 173, 0)");
      gradient.addColorStop(0.5, "rgba(224, 216, 173, 0.2)");
      gradient.addColorStop(1, "rgba(224, 216, 173, 0)");
      context.fillStyle = gradient;
      context.fillRect(180, y, 720, 1);
      context.beginPath();
      context.arc(centerX, y, 2.5, 0, Math.PI * 2);
      context.fillStyle = "#e9e0b9";
      context.shadowColor = "rgba(218, 228, 164, 0.58)";
      context.shadowBlur = 12;
      context.fill();
      context.shadowBlur = 0;
    };
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, "#faf5e7");
    background.addColorStop(0.48, "#e7edda");
    background.addColorStop(1, "#dae5cf");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const centerWash = context.createRadialGradient(centerX, 635, 20, centerX, 635, 470);
    centerWash.addColorStop(0, "rgba(83, 177, 101, 0.18)");
    centerWash.addColorStop(0.34, "rgba(47, 142, 88, 0.12)");
    centerWash.addColorStop(1, "rgba(29, 95, 64, 0)");
    context.fillStyle = centerWash;
    context.fillRect(130, 240, 820, 770);

    const atmosphere = context.createLinearGradient(0, 1320, 0, 1920);
    atmosphere.addColorStop(0, "rgba(8, 34, 23, 0)");
    atmosphere.addColorStop(0.45, "rgba(142, 172, 107, 0.07)");
    atmosphere.addColorStop(1, "rgba(142, 172, 107, 0.15)");
    context.fillStyle = atmosphere;
    context.fillRect(0, 1320, 1080, 600);

    context.fillStyle = "rgba(224, 216, 173, 0.17)";
    [[112, 412, 1], [923, 477, 2], [152, 864, 2], [844, 938, 1], [281, 594, 1], [756, 710, 1]].forEach(([x, y, radius]) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.shadowColor = "rgba(218, 228, 164, 0.52)";
      context.shadowBlur = 10;
      context.fill();
      context.shadowBlur = 0;
    });

    // Reuse the vector emblem so both export paths carry the same artwork.
    const emblem = new Image();
    await new Promise((resolve, reject) => {
      emblem.onload = resolve;
      emblem.onerror = () => reject(new Error("分享图案加载失败，请刷新重试。"));
      emblem.src = new URL("assets/share-sanctuary.svg", document.baseURI).href;
    });
    context.drawImage(emblem, centerX - 154, 106, 308, 233);
    drawCenteredText("A  Q U I E T  P L A C E", 370, "500 20px Avenir Next, Arial, sans-serif", "#627650");
    drawCenteredText("专注栖所", 422, "400 56px STSong, Songti SC, serif", "#31543f");
    drawCenteredText("收拢微光  ·  安住此刻", 475, "400 19px STSong, Songti SC, serif", "#6e7d59");

    drawCenteredText("今日专注 / TODAY FOCUS", 635, "500 19px Avenir Next, Arial, sans-serif", "#627650");
    drawMeasure(formatPosterDuration(data.todayFocusMinutes), 790, "400 144px Georgia, serif", "500 32px Avenir Next, Arial, sans-serif", "#31543f", "#6e7d59");
    drawCenteredText("把时间，留给真正重要的事", 905, "400 24px STSong, SimSun, serif", "#6e7d59");
    drawSoftRule(1030);

    const columns = [324, 756];
    const labels = ["本周专注 / THIS WEEK", "总专注时间 / TOTAL"];
    const values = [
      formatPosterDuration(data.weekFocusMinutes),
      formatPosterDuration(data.totalFocusMinutes),
    ];
    columns.forEach((x, index) => {
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "500 22px Avenir Next, Arial, sans-serif";
      context.fillStyle = "#627650";
      context.fillText(labels[index], x, 1150);
      drawMeasure(
        values[index],
        1240,
        "400 58px Georgia, serif",
        "500 22px Avenir Next, Arial, sans-serif",
        "#31543f",
        "#6e7d59",
        x,
      );
    });

    drawCenteredText("每一刻专注，都算数。", 1560, "400 32px STSong, SimSun, serif", "#31543f");
    drawCenteredText("D A I L Y   F O C U S   S H A R E", 1740, "500 18px Arial, sans-serif", "#6e7d59");
    context.strokeStyle = "rgba(83, 112, 71, 0.16)";
    context.strokeRect(43, 77, 994, 1766);

    context.save();
    context.strokeStyle = "rgba(111, 141, 83, 0.2)";
    context.lineWidth = 1;
    [1430, 1535, 1654, 1785].forEach((y, index) => {
      context.beginPath();
      context.moveTo(-40, y);
      context.quadraticCurveTo(centerX - 230, y - 6 - index * 2, centerX, y);
      context.quadraticCurveTo(centerX + 230, y + 6 + index * 2, 1120, y - 1);
      context.stroke();
    });
    context.restore();

    return canvas;
  }

  function triggerDownload(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("无法生成 PNG 文件。"));
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = `quiet-place-focus-${getDateKey()}.png`;
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        resolve();
      }, "image/png");
    });
  }

  function getDateKey() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${today.getFullYear()}-${month}-${day}`;
  }

  const HTML2CANVAS_URL =
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
  let html2CanvasLoad = null;

  function loadHtml2Canvas() {
    if (typeof global.html2canvas === "function") {
      return Promise.resolve(global.html2canvas);
    }
    if (html2CanvasLoad) return html2CanvasLoad;

    html2CanvasLoad = new Promise((resolve) => {
      const script = document.createElement("script");
      const timeoutId = global.setTimeout(() => resolve(null), 4000);
      script.src = HTML2CANVAS_URL;
      script.async = true;
      script.onload = () => {
        global.clearTimeout(timeoutId);
        resolve(
          typeof global.html2canvas === "function" ? global.html2canvas : null,
        );
      };
      script.onerror = () => {
        global.clearTimeout(timeoutId);
        resolve(null);
      };
      document.head.append(script);
    });

    return html2CanvasLoad;
  }

  function initSharePanel() {
    const lifecycle = global[SHARE_LIFECYCLE_KEY] ?? { initialized: false };
    if (lifecycle.initialized) return;

    const openButton = document.querySelector("[data-share-open]");
    const dialog = document.querySelector("#share-dialog");
    const poster = document.querySelector("[data-share-poster]");
    const saveButton = document.querySelector("[data-share-save]");
    const feedback = document.querySelector("[data-share-feedback]");
    const closeButtons = Array.from(document.querySelectorAll("[data-share-close]"));

    if (!openButton || !dialog || !poster || !saveButton || closeButtons.length === 0) {
      return;
    }

    lifecycle.initialized = true;
    global[SHARE_LIFECYCLE_KEY] = lifecycle;

    function setFeedback(message, type = "info") {
      if (!feedback) return;
      feedback.textContent = message;
      feedback.dataset.type = type;
    }

    function sizePoster() {
      if (poster.clientWidth) poster.style.fontSize = `${poster.clientWidth / 360 * 16}px`;
    }
    if (global.ResizeObserver) {
      lifecycle.resizeObserver = new global.ResizeObserver(sizePoster);
      lifecycle.resizeObserver.observe(poster);
    }

    function openShare() {
      renderPoster();
      setFeedback("");
      if (!dialog.open) dialog.showModal();
      sizePoster();
      openButton.setAttribute("aria-expanded", "true");
    }

    function closeShare() {
      if (dialog.open) dialog.close();
      openButton.setAttribute("aria-expanded", "false");
    }

    async function savePoster() {
      if (saveButton.disabled) return;
      renderPoster();

      saveButton.disabled = true;
      saveButton.textContent = "生成中…";
      setFeedback(
        typeof global.html2canvas === "function"
          ? "正在收拢这份微光…"
          : "正在使用内置画布收拢这份微光…",
      );

      try {
        const html2canvas = await loadHtml2Canvas();
        await new Promise((resolve) => global.requestAnimationFrame(resolve));
        let canvas;
        try {
          canvas = typeof html2canvas === "function"
            ? await html2canvas(poster, {
                backgroundColor: "#faf5e7",
                height: poster.clientHeight,
                logging: false,
                scale: Math.min(3, Math.max(2, global.devicePixelRatio || 1)),
                useCORS: true,
                width: poster.clientWidth,
              })
            : await createFallbackPosterCanvas(readShareData());
        } catch (captureError) {
          console.warn("Preview capture unavailable; using built-in poster", captureError);
          canvas = await createFallbackPosterCanvas(readShareData());
        }

        await triggerDownload(canvas);
        setFeedback("图片已保存。", "success");
      } catch (error) {
        console.error("导出每日分享失败", error);
        setFeedback("保存失败，请稍后重试。", "error");
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "保存图片";
      }
    }

    openButton.addEventListener("click", openShare);
    closeButtons.forEach((button) => button.addEventListener("click", closeShare));
    dialog.addEventListener("close", () => {
      openButton.setAttribute("aria-expanded", "false");
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeShare();
    });
    saveButton.addEventListener("click", savePoster);

    const refreshOpenPoster = () => {
      if (dialog.open) renderPoster();
    };
    global.addEventListener("focuscore:statisticschange", refreshOpenPoster);
  }

  global.FocusCoreShare = Object.freeze({
    formatPosterDays,
    formatPosterDuration,
    initSharePanel,
    readShareData,
    renderPoster,
  });

  initSharePanel();
})(window);
