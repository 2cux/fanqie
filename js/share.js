(function initShareModule(global) {
  "use strict";

  const SHARE_LIFECYCLE_KEY = "__focusCoreShareLifecycle";
  const WEEKLY_FOCUS_TARGET_MINUTES = 30 * 60;

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

  function getWeeklyRemainingMinutes(weekFocusMinutes) {
    return Math.max(
      0,
      WEEKLY_FOCUS_TARGET_MINUTES - toSafeNumber(weekFocusMinutes),
    );
  }

  function readShareData() {
    const statistics = global.FocusCoreStatistics?.getStatistics?.() ?? {};

    return {
      todayFocusMinutes: toSafeNumber(statistics.todayFocusMinutes),
      weekFocusMinutes: toSafeNumber(statistics.weekFocusMinutes),
      totalFocusMinutes: toSafeNumber(statistics.totalFocusMinutes),
      currentStreak: toSafeNumber(statistics.currentStreak),
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
    renderPosterMeasure("[data-poster-streak]", formatPosterDays(data.currentStreak));

    const weeklyRemainingSlot = document.querySelector(
      "[data-poster-weekly-remaining]",
    );
    if (!weeklyRemainingSlot) return;

    const remainingMinutes = getWeeklyRemainingMinutes(data.weekFocusMinutes);
    const isComplete = remainingMinutes <= 0;
    weeklyRemainingSlot.hidden = isComplete;
    weeklyRemainingSlot.setAttribute("aria-hidden", String(isComplete));
    if (!isComplete) {
      renderPosterMeasure(
        "[data-poster-weekly-remaining-value]",
        formatPosterDuration(remainingMinutes),
      );
    }
  }

  // html2canvas 可用时优先捕获 HTML/CSS 预览；离线或 CDN 被拦截时，
  // 使用同一组数据绘制一个独立的 9:16 画布，保证保存图片仍然可用。
  function createLegacyFallbackPosterCanvas(data) {
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
    const drawMeasure = (text, y, numberFont, unitFont, numberColor, unitColor) => {
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
      let x = centerX - totalWidth / 2;

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
    const drawRule = (y) => {
      const gradient = context.createLinearGradient(100, y, 980, y);
      gradient.addColorStop(0, "rgba(173, 218, 174, 0)");
      gradient.addColorStop(0.5, "rgba(173, 218, 174, 0.42)");
      gradient.addColorStop(1, "rgba(173, 218, 174, 0)");
      context.fillStyle = gradient;
      context.fillRect(100, y, 880, 2);
      context.beginPath();
      context.arc(centerX, y + 1, 4, 0, Math.PI * 2);
      context.fillStyle = "#d5edc6";
      context.shadowColor = "rgba(158, 229, 148, 0.8)";
      context.shadowBlur = 18;
      context.fill();
      context.shadowBlur = 0;
    };

    const background = context.createLinearGradient(0, 0, 1080, 1920);
    background.addColorStop(0, "#081711");
    background.addColorStop(0.48, "#0b2118");
    background.addColorStop(1, "#06110d");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const ocean = context.createLinearGradient(0, 1490, 0, 1920);
    ocean.addColorStop(0, "rgba(8, 29, 20, 0.04)");
    ocean.addColorStop(0.34, "rgba(8, 32, 21, 0.26)");
    ocean.addColorStop(1, "rgba(2, 10, 8, 0.94)");
    context.fillStyle = ocean;
    context.fillRect(0, 1490, canvas.width, 430);

    context.save();
    context.beginPath();
    context.moveTo(0, 1618);
    context.lineTo(75, 1598);
    context.lineTo(142, 1610);
    context.lineTo(238, 1554);
    context.lineTo(315, 1590);
    context.lineTo(410, 1538);
    context.lineTo(508, 1595);
    context.lineTo(620, 1556);
    context.lineTo(717, 1597);
    context.lineTo(812, 1544);
    context.lineTo(905, 1593);
    context.lineTo(1080, 1562);
    context.lineTo(1080, 1740);
    context.lineTo(0, 1740);
    context.closePath();
    context.fillStyle = "rgba(7, 31, 21, 0.64)";
    context.fill();

    context.beginPath();
    context.moveTo(0, 1650);
    context.lineTo(96, 1626);
    context.lineTo(187, 1661);
    context.lineTo(300, 1608);
    context.lineTo(391, 1654);
    context.lineTo(490, 1614);
    context.lineTo(590, 1658);
    context.lineTo(710, 1624);
    context.lineTo(824, 1665);
    context.lineTo(932, 1618);
    context.lineTo(1080, 1648);
    context.lineTo(1080, 1760);
    context.lineTo(0, 1760);
    context.closePath();
    context.fillStyle = "rgba(2, 14, 10, 0.9)";
    context.fill();
    context.restore();

    const horizon = context.createLinearGradient(0, 0, 1080, 0);
    horizon.addColorStop(0, "rgba(148, 216, 149, 0)");
    horizon.addColorStop(0.38, "rgba(148, 216, 149, 0.2)");
    horizon.addColorStop(0.5, "rgba(198, 239, 187, 0.42)");
    horizon.addColorStop(0.62, "rgba(148, 216, 149, 0.2)");
    horizon.addColorStop(1, "rgba(148, 216, 149, 0)");
    context.fillStyle = horizon;
    context.shadowColor = "rgba(127, 211, 137, 0.3)";
    context.shadowBlur = 20;
    context.fillRect(0, 1670, 1080, 2);
    context.shadowBlur = 0;

    context.save();
    context.beginPath();
    context.rect(390, 1670, 300, 230);
    context.clip();
    for (let y = 1690; y < 1880; y += 11) {
      const spread = 38 + ((y - 1690) / 190) * 120;
      const offset = Math.sin(y * 0.09) * 18;
      context.beginPath();
      context.moveTo(centerX - spread + offset, y);
      context.quadraticCurveTo(centerX + offset, y - 3, centerX + spread + offset, y);
      context.strokeStyle = `rgba(173, 235, 174, ${0.12 - (y - 1690) / 2500})`;
      context.lineWidth = 2;
      context.stroke();
    }
    context.restore();

    [1715, 1760, 1812, 1862].forEach((y, index) => {
      context.beginPath();
      context.moveTo(-40, y);
      context.quadraticCurveTo(centerX - 210, y - 7 - index * 2, centerX - 18, y);
      context.quadraticCurveTo(centerX + 250, y + 7 + index * 2, 1120, y - 1);
      context.strokeStyle = `rgba(136, 195, 144, ${0.1 - index * 0.015})`;
      context.lineWidth = 2;
      context.stroke();
    });

    const centerGlow = context.createRadialGradient(centerX, 710, 12, centerX, 710, 360);
    centerGlow.addColorStop(0, "rgba(205, 247, 194, 0.64)");
    centerGlow.addColorStop(0.2, "rgba(114, 202, 122, 0.28)");
    centerGlow.addColorStop(0.62, "rgba(64, 153, 96, 0.12)");
    centerGlow.addColorStop(1, "rgba(64, 153, 96, 0)");
    context.fillStyle = centerGlow;
    context.fillRect(180, 380, 720, 650);

    context.strokeStyle = "rgba(142, 213, 142, 0.2)";
    context.lineWidth = 2;
    [190, 270, 350].forEach((radius) => {
      context.beginPath();
      context.arc(centerX, 710, radius, 0, Math.PI * 2);
      context.stroke();
    });

    const particles = [
      [185, 525, 3], [870, 580, 4], [240, 820, 3], [785, 870, 2],
      [350, 620, 2], [730, 760, 2], [610, 470, 2], [460, 930, 2],
    ];
    particles.forEach(([x, y, radius]) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = "rgba(204, 233, 199, 0.72)";
      context.shadowColor = "rgba(173, 232, 177, 0.84)";
      context.shadowBlur = 14;
      context.fill();
      context.shadowBlur = 0;
    });

    const logoGlow = context.createRadialGradient(centerX, 150, 0, centerX, 150, 82);
    logoGlow.addColorStop(0, "rgba(211, 247, 198, 0.28)");
    logoGlow.addColorStop(0.28, "rgba(113, 209, 126, 0.13)");
    logoGlow.addColorStop(1, "rgba(77, 162, 91, 0)");
    context.fillStyle = logoGlow;
    context.fillRect(centerX - 82, 68, 164, 164);

    [36, 49, 61].forEach((radius, index) => {
      context.beginPath();
      context.arc(centerX, 150, radius, 0, Math.PI * 2);
      context.strokeStyle = [
        "rgba(174, 229, 175, 0.66)",
        "rgba(124, 191, 137, 0.34)",
        "rgba(103, 177, 116, 0.16)",
      ][index];
      context.lineWidth = index === 0 ? 2 : 1.5;
      context.stroke();
    });
    context.beginPath();
    context.arc(centerX, 150, 23, Math.PI * 0.25, Math.PI * 1.75);
    context.strokeStyle = "rgba(220, 242, 207, 0.34)";
    context.lineWidth = 1.5;
    context.stroke();
    const logoCore = context.createRadialGradient(centerX - 2, 148, 0, centerX, 150, 10);
    logoCore.addColorStop(0, "#fbffe9");
    logoCore.addColorStop(0.55, "#d7f0c9");
    logoCore.addColorStop(1, "#9fcf9c");
    context.beginPath();
    context.arc(centerX, 150, 8, 0, Math.PI * 2);
    context.fillStyle = logoCore;
    context.shadowColor = "rgba(167, 239, 159, 0.9)";
    context.shadowBlur = 24;
    context.fill();
    context.shadowBlur = 0;

    drawCenteredText("A  Q U I E T  P L A C E", 245, "500 22px Avenir Next, Arial, sans-serif", "rgba(189, 220, 193, 0.8)");
    drawCenteredText("专注栖所", 315, "400 58px STSong, Songti SC, serif", "#f0f2e8");
    drawCenteredText("收拢微光  ·  安住此刻", 374, "400 20px STSong, Songti SC, serif", "rgba(188, 214, 188, 0.66)");

    drawCenteredText("T O D A Y  F O C U S", 650, "500 20px Avenir Next, Arial, sans-serif", "rgba(202, 227, 204, 0.76)");
    drawCenteredText(formatPosterDuration(data.todayFocusMinutes), 735, "400 54px Georgia, serif", "#eef2e8");
    drawRule(820);

    const columns = [180, 540, 900];
    const labels = ["W E E K L Y  F O C U S", "T O T A L  F O C U S", "S T R E A K"];
    const values = [
      formatPosterDuration(data.weekFocusMinutes),
      formatPosterDuration(data.totalFocusMinutes),
      formatPosterDays(data.currentStreak),
    ];
    columns.forEach((x, index) => {
      context.font = "500 15px Avenir Next, Arial, sans-serif";
      context.fillStyle = "rgba(202, 227, 204, 0.7)";
      context.textAlign = "center";
      context.fillText(labels[index], x, 910);
      context.font = "400 30px Georgia, serif";
      context.fillStyle = "#e6ece2";
      context.fillText(values[index], x, 985);
      if (index < 2) {
        context.fillStyle = "rgba(174, 209, 175, 0.16)";
        context.fillRect(x + 180, 880, 2, 130);
      }
    });

    const remainingMinutes = getWeeklyRemainingMinutes(data.weekFocusMinutes);
    if (remainingMinutes > 0) {
      drawCenteredText("本周还需专注", 1205, "400 22px STSong, Songti SC, serif", "rgba(208, 229, 207, 0.56)");
      drawMeasure(
        formatPosterDuration(remainingMinutes),
        1310,
        "400 48px Georgia, serif",
        "500 16px Avenir Next, Arial, sans-serif",
        "#f0f2e8",
        "rgba(208, 229, 207, 0.62)",
      );
    }
    drawCenteredText("·  Daily Focus Share  ·", 1830, "500 18px Avenir Next, Arial, sans-serif", "rgba(184, 215, 185, 0.72)");

    return canvas;
  }

  function createFallbackPosterCanvas(data) {
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

    const logoGlow = context.createRadialGradient(centerX, 143, 0, centerX, 143, 72);
    logoGlow.addColorStop(0, "rgba(211, 233, 163, 0.22)");
    logoGlow.addColorStop(1, "rgba(75, 163, 91, 0)");
    context.fillStyle = logoGlow;
    context.fillRect(centerX - 72, 71, 144, 144);
    context.beginPath();
    context.arc(centerX, 143, 27, 0, Math.PI * 2);
    context.strokeStyle = "rgba(224, 216, 173, 0.48)";
    context.lineWidth = 1.4;
    context.stroke();
    context.beginPath();
    context.arc(centerX, 143, 38, 0.35, 4.85);
    context.strokeStyle = "rgba(130, 197, 126, 0.28)";
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.arc(centerX, 143, 49, 3.25, 6.0);
    context.strokeStyle = "rgba(130, 197, 126, 0.17)";
    context.stroke();
    context.beginPath();
    context.arc(centerX, 143, 6, 0, Math.PI * 2);
    context.fillStyle = "#fffdf0";
    context.shadowColor = "rgba(218, 228, 164, 0.75)";
    context.shadowBlur = 18;
    context.fill();
    context.shadowBlur = 0;

    drawCenteredText("A  Q U I E T  P L A C E", 226, "500 20px Avenir Next, Arial, sans-serif", "#627650");
    drawCenteredText("专注栖所", 286, "400 56px STSong, Songti SC, serif", "#31543f");
    drawCenteredText("收拢微光  ·  安住此刻", 339, "400 19px STSong, Songti SC, serif", "#6e7d59");

    drawCenteredText("T O D A Y  F O C U S", 620, "500 19px Avenir Next, Arial, sans-serif", "#627650");
    drawMeasure(formatPosterDuration(data.todayFocusMinutes), 702, "400 57px Georgia, serif", "500 22px Avenir Next, Arial, sans-serif", "#31543f", "#6e7d59");
    drawSoftRule(790);

    const columns = [188, 540, 892];
    const labels = ["W E E K L Y  F O C U S", "T O T A L  F O C U S", "S T R E A K"];
    const values = [
      formatPosterDuration(data.weekFocusMinutes),
      formatPosterDuration(data.totalFocusMinutes),
      formatPosterDays(data.currentStreak),
    ];
    columns.forEach((x, index) => {
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "500 14px Avenir Next, Arial, sans-serif";
      context.fillStyle = "#627650";
      context.fillText(labels[index], x, 882);
      drawMeasure(
        values[index],
        960,
        "400 30px Georgia, serif",
        "500 12px Avenir Next, Arial, sans-serif",
        "#31543f",
        "#6e7d59",
        x,
      );
    });

    const remainingMinutes = getWeeklyRemainingMinutes(data.weekFocusMinutes);
    if (remainingMinutes > 0) {
      drawCenteredText("本周还需专注", 1180, "400 20px STSong, Songti SC, serif", "#6e7d59");
      drawMeasure(
        formatPosterDuration(remainingMinutes),
        1264,
        "400 50px Georgia, serif",
        "500 16px Avenir Next, Arial, sans-serif",
        "#31543f",
        "#6e7d59",
      );
    }
    drawCenteredText("·  Daily Focus Share  ·", 1835, "500 17px Avenir Next, Arial, sans-serif", "#6e7d59");

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

    function openShare() {
      renderPoster();
      setFeedback("");
      if (!dialog.open) dialog.showModal();
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
        const canvas =
          typeof html2canvas === "function"
            ? await html2canvas(poster, {
                backgroundColor: "#faf5e7",
                height: poster.clientHeight,
                logging: false,
                scale: Math.min(3, Math.max(2, global.devicePixelRatio || 1)),
                useCORS: true,
                width: poster.clientWidth,
              })
            : createFallbackPosterCanvas(readShareData());

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
