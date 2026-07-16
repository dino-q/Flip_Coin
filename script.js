(function () {
  "use strict";

  const PRESETS = {
    pokemon: {
      label: "Pokémon",
      heads: "assets/default-head.svg",
      tails: "assets/default-tail.svg",
      bg: "assets/card-back.jpg",
    },
    chiikawa: {
      label: "吉伊卡哇",
      heads: "assets/chiikawa-head.png",
      tails: "assets/chiikawa-tail.png",
      bg: "assets/chiikawa-bg.jpg",
      defaultAdjust: {
        heads: { scale: 115, x: 0, y: 10 },
        tails: { scale: 115, x: 0, y: 8 },
      },
    },
  };
  const DEFAULT_PRESET = "pokemon";
  const DEFAULT_IMAGES = PRESETS[DEFAULT_PRESET];
  const IMAGE_KEYS = {
    heads: "heads_image",
    tails: "tails_image",
  };
  const STATS_KEY = "coinBurst.stats";
  const SETTINGS_KEY = "coinBurst.settings";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const VALID_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

  // 擲硬幣物理旋鈕(「自然帶晃」預設)
  const FLIP = {
    speedBase: 360,       // 基礎角速 deg/s
    speedCoupling: 0.6,   // 力道 → 角速耦合(deg/s per unit force)
    speedMax: 1450,       // 角速上限(每幀轉角過大會頻閃,壓在 ~24°/frame 內)
    betaDeg: 78,          // 錐半角:90=乾淨端對端翻;越小越搖;~78=自然帶晃
    betaJitter: 6,        // 每擲 beta 抖動範圍
    throwAxisJitter: 5,   // 滑動法線的小幅誤差，保留自然手感
    leanMax: 12,          // L 偏離螢幕平面(朝鏡頭)的小傾角(deg),增加每擲差異
    phiRate: 0.35,        // 面內自旋相對主角速的比例
    groundSpinDamp: 0.7,  // 落地後角速每幀衰減
    restitution: 0.3,     // 垂直回彈係數(硬幣幾乎不彈)
    bounceSpinKeep: 0.6,  // 每次彈跳保留的角速比例
    flattenOmega: 260,    // 角速降到此值以下開始朝當前面攤平
  };

  const elements = {};
  const coinState = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    // 朝向:面法線 n(nx,ny,nz)決定看到哪一面;phi 為面內自旋(deg)。渲染只讀這幾個
    nx: 0,
    ny: 0,
    nz: 1,
    phi: 0,
    // 飛行:固定世界翻轉軸 L(單位向量)+ 錐半角 beta(rad)+ 主角速 omega(deg/s)+ 進動角 psi(deg)
    Lx: 1,
    Ly: 0,
    Lz: 0,
    beta: 0,
    omega: 0,
    psi: 0,
    spinDir: 1,
    radius: 56,
    visualRadius: 56,
    phase: "idle",
    result: "heads",
    startTime: 0,
    lastTime: 0,
    minDuration: 1700,
    maxDuration: 3200,
    seed: 0,
    settle: null,
  };

  const state = {
    stats: { total: 0, heads: 0, tails: 0 },
    settings: {},
    soundEnabled: true,
    audioContext: null,
    objectUrls: { heads: null, tails: null, bg: null },
    drag: null,
    rafId: 0,
    bounds: null,
  };

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("resize", debounce(handleResize, 120));

  async function init() {
    cacheElements();
    createRim();
    createParticles();
    state.stats = loadStats();
    state.settings = loadSettings();
    state.soundEnabled = state.settings.soundEnabled !== false;
    renderSoundState();
    renderStats();
    bindEvents();
    renderPresetButtons();
    if (state.settings.ruleText) {
      elements.ruleStrip.textContent = state.settings.ruleText;
    }
    if (!state.settings.adjust) {
      const preset = getActivePreset();
      if (preset.defaultAdjust) {
        state.settings.adjust = JSON.parse(JSON.stringify(preset.defaultAdjust));
        saveSettings();
      }
    }
    await loadSavedImages();
    restoreSliders();
    resetCoinPosition();
  }

  function cacheElements() {
    elements.playfield = document.getElementById("playfield");
    elements.coinScene = document.getElementById("coinScene");
    elements.coin = document.getElementById("coin");
    elements.coinRim = document.getElementById("coinRim");
    elements.coinShadow = document.getElementById("coinShadow");
    elements.quickFlipButton = document.getElementById("quickFlipButton");
    elements.resultBanner = document.getElementById("resultBanner");
    elements.particles = document.getElementById("particles");
    elements.soundToggle = document.getElementById("soundToggle");
    elements.headsInput = document.getElementById("headsInput");
    elements.tailsInput = document.getElementById("tailsInput");
    elements.headsImage = document.getElementById("headsImage");
    elements.tailsImage = document.getElementById("tailsImage");
    elements.headsPreview = document.getElementById("headsPreview");
    elements.tailsPreview = document.getElementById("tailsPreview");
    elements.totalCount = document.getElementById("totalCount");
    elements.headsCount = document.getElementById("headsCount");
    elements.tailsCount = document.getElementById("tailsCount");
    elements.winRate = document.getElementById("winRate");
    elements.resetStatsButton = document.getElementById("resetStatsButton");
    elements.restoreAllButton = document.getElementById("restoreAllButton");
    elements.bgInput = document.getElementById("bgInput");
    elements.bgPreview = document.getElementById("bgPreview");
    elements.boardArt = document.querySelector(".board-art");
    elements.statusLine = document.getElementById("statusLine");
    elements.presetRow = document.getElementById("presetRow");
    elements.ruleStrip = document.getElementById("ruleStrip");
  }

  function bindEvents() {
    elements.coin.addEventListener("pointerdown", handlePointerDown);
    elements.coin.addEventListener("keydown", handleCoinKeyDown);
    elements.quickFlipButton.addEventListener("click", startQuickFlip);
    elements.headsInput.addEventListener("change", (event) => handleUpload("heads", event));
    elements.tailsInput.addEventListener("change", (event) => handleUpload("tails", event));
    elements.bgInput.addEventListener("change", handleBgUpload);
    elements.resetStatsButton.addEventListener("click", resetStats);
    elements.restoreAllButton.addEventListener("click", restoreAll);
    elements.soundToggle.addEventListener("click", toggleSound);
    elements.presetRow.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-preset]");
      if (btn) switchPreset(btn.dataset.preset);
    });
    elements.ruleStrip.addEventListener("blur", () => {
      state.settings.ruleText = elements.ruleStrip.textContent;
      saveSettings();
    });
    document.querySelectorAll(".adjust-row").forEach((row) => {
      const target = row.dataset.target;
      row.querySelectorAll("input[type=range]").forEach((slider) => {
        slider.addEventListener("input", () => onAdjustChange(target));
      });
    });
  }

  function handleCoinKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startQuickFlip();
    }
  }

  function loadStats() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATS_KEY));
      if (parsed && Number.isFinite(parsed.total) && Number.isFinite(parsed.heads) && Number.isFinite(parsed.tails)) {
        return {
          total: Math.max(0, parsed.total),
          heads: Math.max(0, parsed.heads),
          tails: Math.max(0, parsed.tails),
        };
      }
    } catch (error) {
      console.warn("Unable to read stats.", error);
    }
    return { total: 0, heads: 0, tails: 0 };
  }

  function saveStats() {
    localStorage.setItem(STATS_KEY, JSON.stringify(state.stats));
  }

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (error) {
      console.warn("Unable to read settings.", error);
      return {};
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  async function loadSavedImages() {
    await Promise.all([loadSavedImage("heads"), loadSavedImage("tails"), loadSavedBg()]);
  }

  async function loadSavedBg() {
    try {
      const record = await window.CoinImageDB.getImage("bg_image");
      if (record && record.blob) {
        setBgImage(URL.createObjectURL(record.blob));
        return;
      }
    } catch (error) {
      console.warn("Unable to load background image.", error);
    }
    setBgImage(getActivePreset().bg);
  }

  async function loadSavedImage(side) {
    try {
      const record = await window.CoinImageDB.getImage(IMAGE_KEYS[side]);
      if (record && record.blob) {
        setCoinImage(side, URL.createObjectURL(record.blob));
        return;
      }
    } catch (error) {
      console.warn(`Unable to load ${side} image.`, error);
      setStatus("圖片資料庫暫時無法讀取");
    }

    const preset = PRESETS[state.settings.preset || DEFAULT_PRESET] || PRESETS[DEFAULT_PRESET];
    setCoinImage(side, preset[side]);
  }

  function getActivePreset() {
    return PRESETS[state.settings.preset || DEFAULT_PRESET] || PRESETS[DEFAULT_PRESET];
  }

  async function switchPreset(key) {
    if (!PRESETS[key]) return;
    const prev = state.settings.preset || DEFAULT_PRESET;
    if (key === prev && !state.settings.headsName && !state.settings.tailsName) return;

    try {
      await window.CoinImageDB.deleteImages();
    } catch (_) {}

    const preset = PRESETS[key];
    state.settings.preset = key;
    delete state.settings.headsName;
    delete state.settings.tailsName;
    delete state.settings.headsUpdatedAt;
    delete state.settings.tailsUpdatedAt;
    delete state.settings.bgName;
    delete state.settings.bgUpdatedAt;
    if (preset.defaultAdjust) {
      state.settings.adjust = JSON.parse(JSON.stringify(preset.defaultAdjust));
    } else {
      delete state.settings.adjust;
    }
    saveSettings();
    setCoinImage("heads", preset.heads);
    setCoinImage("tails", preset.tails);
    setBgImage(preset.bg);
    restoreSliders();
    renderPresetButtons();
    setStatus(preset.label + " 模式");
    playButtonSound(true);
  }

  function renderPresetButtons() {
    const active = state.settings.preset || DEFAULT_PRESET;
    elements.presetRow.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === active);
    });
  }

  async function handleUpload(side, event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = "";

    if (!file) {
      return;
    }

    if (!VALID_TYPES.has(file.type)) {
      setStatus("僅支援 PNG、JPG、WEBP");
      playButtonSound(false);
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setStatus("圖片需小於 5MB");
      playButtonSound(false);
      return;
    }

    try {
      await window.CoinImageDB.putImage(IMAGE_KEYS[side], file);
      setCoinImage(side, URL.createObjectURL(file));
      state.settings[`${side}Name`] = file.name;
      state.settings[`${side}UpdatedAt`] = Date.now();
      saveSettings();
      setStatus(side === "heads" ? "正面已更新" : "反面已更新");
      playButtonSound(true);
    } catch (error) {
      console.error(error);
      setStatus("圖片儲存失敗");
      playButtonSound(false);
    }
  }

  function setCoinImage(side, url) {
    if (state.objectUrls[side] && state.objectUrls[side].startsWith("blob:")) {
      URL.revokeObjectURL(state.objectUrls[side]);
    }

    state.objectUrls[side] = url;
    const image = side === "heads" ? elements.headsImage : elements.tailsImage;
    const preview = side === "heads" ? elements.headsPreview : elements.tailsPreview;
    image.src = url;
    preview.src = url;
  }

  function renderStats() {
    const { total, heads, tails } = state.stats;
    elements.totalCount.textContent = String(total);
    elements.headsCount.textContent = String(heads);
    elements.tailsCount.textContent = String(tails);
    elements.winRate.textContent = `${total ? Math.round((heads / total) * 100) : 0}%`;
  }

  function resetStats() {
    state.stats = { total: 0, heads: 0, tails: 0 };
    saveStats();
    renderStats();
    setResult("READY");
    setStatus("戰績已清除");
    playButtonSound(true);
  }

  async function restoreAll() {
    try {
      await window.CoinImageDB.deleteImages();
      const preset = getActivePreset();
      setCoinImage("heads", preset.heads);
      setCoinImage("tails", preset.tails);
      setBgImage(preset.bg);
      delete state.settings.headsName;
      delete state.settings.tailsName;
      delete state.settings.headsUpdatedAt;
      delete state.settings.tailsUpdatedAt;
      delete state.settings.bgName;
      delete state.settings.bgUpdatedAt;
      if (preset.defaultAdjust) {
        state.settings.adjust = JSON.parse(JSON.stringify(preset.defaultAdjust));
      } else {
        delete state.settings.adjust;
      }
      saveSettings();
      restoreSliders();
      setStatus("全部已還原");
      playButtonSound(true);
    } catch (error) {
      console.error(error);
      setStatus("還原失敗");
      playButtonSound(false);
    }
  }

  async function handleBgUpload(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;

    if (!VALID_TYPES.has(file.type)) {
      setStatus("僅支援 PNG、JPG、WEBP");
      playButtonSound(false);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus("圖片需小於 5MB");
      playButtonSound(false);
      return;
    }

    try {
      await window.CoinImageDB.putImage("bg_image", file);
      setBgImage(URL.createObjectURL(file));
      state.settings.bgName = file.name;
      state.settings.bgUpdatedAt = Date.now();
      saveSettings();
      setStatus("背景已更新");
      playButtonSound(true);
    } catch (error) {
      console.error(error);
      setStatus("背景儲存失敗");
      playButtonSound(false);
    }
  }

  function setBgImage(url) {
    if (state.objectUrls.bg && state.objectUrls.bg.startsWith("blob:")) {
      URL.revokeObjectURL(state.objectUrls.bg);
    }
    state.objectUrls.bg = url;
    applyBgTransform();
    elements.bgPreview.src = url;
  }

  function onAdjustChange(target) {
    const row = document.querySelector('.adjust-row[data-target="' + target + '"]');
    if (!row) return;
    const vals = {};
    row.querySelectorAll("input[type=range]").forEach((s) => {
      vals[s.dataset.prop] = Number(s.value);
    });
    if (!state.settings.adjust) state.settings.adjust = {};
    state.settings.adjust[target] = vals;
    saveSettings();
    applyAdjust(target);
  }

  function applyAdjust(target) {
    const adj = (state.settings.adjust && state.settings.adjust[target]) || {};
    const scale = (adj.scale || 100) / 100;
    const x = adj.x || 0;
    const y = adj.y || 0;

    if (target === "heads" || target === "tails") {
      const img = target === "heads" ? elements.headsImage : elements.tailsImage;
      const preview = target === "heads" ? elements.headsPreview : elements.tailsPreview;
      const tx = "scale(" + scale + ") translate(" + x + "%, " + y + "%)";
      img.style.transform = tx;
      preview.style.transform = tx;
    } else if (target === "bg") {
      applyBgTransform();
    }
  }

  function applyBgTransform() {
    const adj = (state.settings.adjust && state.settings.adjust.bg) || {};
    const scale = (adj.scale || 100) / 100;
    const x = adj.x || 0;
    const y = adj.y || 0;
    const opacity = (adj.opacity != null ? adj.opacity : 72) / 100;
    const url = state.objectUrls.bg || getActivePreset().bg;
    const sizePct = Math.round(scale * 100);
    const posX = 50 + x;
    const posY = 50 + y;
    elements.boardArt.style.backgroundImage =
      "linear-gradient(180deg, rgba(116,209,249,0.22), rgba(55,141,219,0.26) 58%, rgba(12,55,126,0.34)),"
      + "url(\"" + url + "\")";
    elements.boardArt.style.backgroundSize = "cover, " + sizePct + "%";
    elements.boardArt.style.backgroundPosition = "center, " + posX + "% " + posY + "%";
    elements.boardArt.style.opacity = String(opacity);
  }

  function restoreSliders() {
    document.querySelectorAll(".adjust-row").forEach((row) => {
      const target = row.dataset.target;
      const adj = (state.settings.adjust && state.settings.adjust[target]) || {};
      row.querySelectorAll("input[type=range]").forEach((s) => {
        const prop = s.dataset.prop;
        if (adj[prop] != null) s.value = adj[prop];
      });
      applyAdjust(target);
    });
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    state.settings.soundEnabled = state.soundEnabled;
    saveSettings();
    renderSoundState();
    playButtonSound(state.soundEnabled);
  }

  function renderSoundState() {
    elements.soundToggle.textContent = state.soundEnabled ? "音效 ON" : "音效 OFF";
    elements.soundToggle.setAttribute("aria-pressed", String(state.soundEnabled));
  }

  function resetCoinPosition() {
    measureBounds();
    coinState.x = state.bounds.width / 2;
    coinState.y = state.bounds.height * 0.68;
    coinState.z = 0;
    coinState.vx = 0;
    coinState.vy = 0;
    coinState.vz = 0;
    coinState.omega = 0;
    coinState.psi = 0;
    coinState.phase = "idle";
    setRestOrientation(coinState.result || "heads");
    renderCoin();
  }

  function handleResize() {
    const previousWidth = state.bounds ? state.bounds.width : 0;
    const previousHeight = state.bounds ? state.bounds.height : 0;
    measureBounds();

    if (previousWidth && previousHeight) {
      coinState.x = (coinState.x / previousWidth) * state.bounds.width;
      coinState.y = (coinState.y / previousHeight) * state.bounds.height;
      clampCoinToBounds();
      renderCoin();
    }
  }

  function measureBounds() {
    const rect = elements.playfield.getBoundingClientRect();
    const coinRect = elements.coinScene.getBoundingClientRect();
    // visualRadius 給渲染(rim/陰影/置中要貼合實際大小);radius 留 44px 下限只給物理邊界
    coinState.visualRadius = coinRect.width / 2 || coinState.visualRadius;
    coinState.radius = Math.max(44, coinState.visualRadius);
    state.bounds = {
      width: rect.width,
      height: rect.height,
      minX: coinState.radius + 12,
      maxX: rect.width - coinState.radius - 12,
      minY: Math.max(coinState.radius + 12, rect.height * 0.22),
      maxY: rect.height - coinState.radius - 18,
    };
  }

  function handlePointerDown(event) {
    if (coinState.phase === "throwing") {
      return;
    }

    event.preventDefault();
    measureBounds();
    cancelAnimationFrame(state.rafId);

    const point = getLocalPoint(event);
    state.drag = {
      pointerId: event.pointerId,
      offsetX: point.x - coinState.x,
      offsetY: point.y - coinState.y,
      startX: coinState.x,
      startY: coinState.y,
      restFace: coinState.result || "heads",
      history: [{ x: point.x, y: point.y, t: performance.now() }],
    };

    coinState.phase = "dragging";
    coinState.z = 0;
    coinState.vx = 0;
    coinState.vy = 0;
    elements.coin.setPointerCapture(event.pointerId);
    elements.coinScene.classList.add("is-dragging");
    elements.coin.addEventListener("pointermove", handlePointerMove);
    elements.coin.addEventListener("pointerup", handlePointerUp);
    elements.coin.addEventListener("pointercancel", handlePointerCancel);
    setStatus("");
    setResult("READY");
    playButtonSound(true);
  }

  function handlePointerMove(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const point = getLocalPoint(event);
    const previousX = coinState.x;
    const previousY = coinState.y;
    coinState.x = clamp(point.x - state.drag.offsetX, state.bounds.minX, state.bounds.maxX);
    coinState.y = clamp(point.y - state.drag.offsetY, state.bounds.minY, state.bounds.maxY);
    // 拖曳回饋:讓硬幣往拖曳方向傾一點(不翻面,只把 rest 面法線偏一點)
    const dragX = clamp((coinState.x - state.drag.startX) * 0.006, -0.5, 0.5);
    const dragY = clamp((coinState.y - state.drag.startY) * 0.006, -0.5, 0.5);
    const restSign = state.drag.restFace === "tails" ? -1 : 1;
    const tnx = Math.sin(dragX);
    const tny = -Math.sin(dragY);
    coinState.nx = tnx;
    coinState.ny = tny;
    coinState.nz = restSign * Math.sqrt(Math.max(0.0001, 1 - tnx * tnx - tny * tny));
    coinState.phi += (coinState.x - previousX) * 0.15;

    const now = performance.now();
    state.drag.history.push({ x: point.x, y: point.y, t: now });
    state.drag.history = state.drag.history.filter((sample) => now - sample.t < 120);
    renderCoin();
  }

  function handlePointerUp(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    elements.coin.releasePointerCapture(event.pointerId);
    cleanupPointerListeners();

    const velocity = getReleaseVelocity();
    const dx = coinState.x - state.drag.startX;
    const dy = coinState.y - state.drag.startY;
    state.drag = null;
    elements.coinScene.classList.remove("is-dragging");

    let vx = velocity.vx;
    let vy = velocity.vy;
    if (Math.hypot(vx, vy) < 180) {
      vx = dx * 4.8 + randomBetween(-130, 130);
      vy = dy * 4.8 - 180 + randomBetween(-80, 80);
    }

    startThrow(vx, vy);
  }

  function handlePointerCancel(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) {
      return;
    }

    cleanupPointerListeners();
    state.drag = null;
    elements.coinScene.classList.remove("is-dragging");
    coinState.phase = "idle";
    setRestOrientation(coinState.result || "heads");
    renderCoin();
  }

  function cleanupPointerListeners() {
    elements.coin.removeEventListener("pointermove", handlePointerMove);
    elements.coin.removeEventListener("pointerup", handlePointerUp);
    elements.coin.removeEventListener("pointercancel", handlePointerCancel);
  }

  function getReleaseVelocity() {
    const history = state.drag.history;
    if (history.length < 2) {
      return { vx: 0, vy: 0 };
    }

    const last = history[history.length - 1];
    let first = history[0];
    for (let index = history.length - 2; index >= 0; index -= 1) {
      if (last.t - history[index].t > 55) {
        first = history[index];
        break;
      }
    }

    const dt = Math.max(16, last.t - first.t) / 1000;
    return {
      vx: (last.x - first.x) / dt,
      vy: (last.y - first.y) / dt,
    };
  }

  function startQuickFlip() {
    if (coinState.phase === "throwing") {
      return;
    }

    measureBounds();
    const angle = randomBetween(-Math.PI * 0.92, -Math.PI * 0.08);
    const speed = randomBetween(720, 1040);
    startThrow(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  function startThrow(vx, vy) {
    measureBounds();
    const rawForce = Math.hypot(vx, vy);
    const moveSpeed = clamp(rawForce, 200, 650);
    const spinForce = clamp(rawForce, 260, 1600);
    const direction = Math.atan2(vy || -1, vx || 1);
    const releaseNormal = { x: coinState.nx, y: coinState.ny, z: coinState.nz };

    coinState.phase = "throwing";
    coinState.result = null;
    coinState.vx = Math.cos(direction) * moveSpeed;
    coinState.vy = Math.sin(direction) * moveSpeed;
    coinState.vz = randomBetween(440, 600) + spinForce * 0.32;

    // 無力矩進動模型:出手選定一條「固定在世界空間」的翻轉軸 L(整段飛行不變 → 角動量守恆),
    // 面法線繞 L 以固定錐半角 beta 打錐形 → 天然邊翻邊晃(Diaconis/費曼盤)。
    // L 需大致水平(在螢幕平面內)硬幣才會真的翻正反面;beta≈78° 產生自然搖擺。
    // 手指滑動會在與滑動方向垂直的軸上施加角動量；反向投擲時，
    // 翻滾方向也會自然反轉，不再與平移方向各自隨機。
    coinState.spinDir = 1;
    coinState.omega = clamp(FLIP.speedBase + spinForce * FLIP.speedCoupling, 0, FLIP.speedMax);
    coinState.beta = degToRad(clamp(FLIP.betaDeg + randomBetween(-FLIP.betaJitter, FLIP.betaJitter), 55, 90));

    // L 以水平軸為底,在螢幕平面內偏一點、再朝鏡頭小幅傾斜 → 每擲的翻轉軸都不同
    const inPlane = direction + Math.PI / 2 +
      degToRad(randomBetween(-FLIP.throwAxisJitter, FLIP.throwAxisJitter));
    const lean = degToRad(randomBetween(-FLIP.leanMax, FLIP.leanMax));
    const cl = Math.cos(lean);
    coinState.Lx = cl * Math.cos(inPlane);
    coinState.Ly = cl * Math.sin(inPlane);
    coinState.Lz = Math.sin(lean);
    normalizeL();

    coinState.psi = phaseForNormal(releaseNormal); // 延續拖曳姿態，避免放手瞬間跳面
    coinState.phi = randomBetween(0, 360);
    coinState.startTime = performance.now();
    coinState.lastTime = coinState.startTime;
    coinState.minDuration = randomBetween(1400, 2000);
    coinState.maxDuration = randomBetween(2800, 3800);
    coinState.seed = Math.random() * Math.PI * 2;
    coinState.settle = null;

    elements.quickFlipButton.disabled = true;
    elements.coinScene.classList.add("is-flying");
    setStatus("");
    setResult("FLIP");
    playButtonSound(true);
    playFlipSound();
    state.rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min(0.034, Math.max(0.001, (now - coinState.lastTime) / 1000));
    coinState.lastTime = now;

    if (coinState.phase === "throwing") {
      stepThrow(now, dt);
    }

    renderCoin();

    if (coinState.phase === "throwing") {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function stepThrow(now, dt) {
    const elapsed = now - coinState.startTime;
    const lateBrake = clamp((elapsed - coinState.minDuration) / 2000, 0, 1);
    const wobble = elapsed / 1000;

    const airDamp = Math.pow(0.982, dt * 60);

    coinState.vx = coinState.vx * airDamp + Math.sin(wobble * 6.7 + coinState.seed) * 26 * dt;
    coinState.vy = coinState.vy * airDamp + Math.cos(wobble * 5.4 + coinState.seed) * 24 * dt;
    coinState.x += coinState.vx * dt;
    coinState.y += coinState.vy * dt;

    coinState.vz -= 920 * dt;
    coinState.z += coinState.vz * dt;
    if (coinState.z < 0) {
      coinState.z = 0;
      if (Math.abs(coinState.vz) > 115) {
        coinState.vz = -coinState.vz * FLIP.restitution;
        coinState.omega *= FLIP.bounceSpinKeep;   // 彈跳耗旋轉能量(不動 L,角動量方向守恆)
        playBounceSound();
      } else {
        coinState.vz = 0;
      }
    }

    resolveWallCollisions();

    const airborne = coinState.z > 2;
    if (airborne) {
      // 空中:L 不變、角速幾乎不衰減,psi(翻轉)/phi(面內自旋)穩定累加 — 無任何假 sine
      coinState.psi += coinState.omega * dt;
      coinState.phi += coinState.omega * FLIP.phiRate * dt;
    } else {
      // 落地:耗旋轉能量;夠慢時朝「當前朝上那一面」攤平(把 L 轉向鏡頭、beta 收小)
      coinState.omega *= Math.pow(FLIP.groundSpinDamp, dt * 60);
      coinState.psi += coinState.omega * dt;
      coinState.phi += coinState.omega * FLIP.phiRate * dt;

      const groundFriction = 0.86 - lateBrake * 0.14;
      coinState.vx *= Math.pow(groundFriction, dt * 60);
      coinState.vy *= Math.pow(groundFriction, dt * 60);

      if (Math.abs(coinState.omega) < FLIP.flattenOmega) {
        if (!coinState.settle) {
          updateOrientation();
          coinState.settle = { pole: coinState.nz >= 0 ? 1 : -1 };  // 鎖定要攤平到哪一面
        }
        const k = clamp(0.06 + (FLIP.flattenOmega - Math.abs(coinState.omega)) / FLIP.flattenOmega * 0.14, 0.06, 0.2);
        coinState.Lx = lerp(coinState.Lx, 0, k);
        coinState.Ly = lerp(coinState.Ly, 0, k);
        coinState.Lz = lerp(coinState.Lz, coinState.settle.pole, k);
        normalizeL();
        coinState.beta = lerp(coinState.beta, degToRad(2), k);
      }
    }

    updateOrientation();   // 由 (L, beta, psi) 算出面法線 n 存入 coinState;渲染與落定都讀它

    if (elapsed > coinState.minDuration && !airborne) {
      const moveSpeed = Math.hypot(coinState.vx, coinState.vy);
      if (getEdgeAmount() < 0.12 && Math.abs(coinState.omega) < 80 && moveSpeed < 15) {
        finishSettle();
        return;
      }
    }

    if (elapsed > coinState.maxDuration) {
      finishSettle();
    }
  }

  function resolveWallCollisions() {
    const bounce = 0.72;
    let hit = false;

    if (coinState.x < state.bounds.minX) {
      coinState.x = state.bounds.minX;
      coinState.vx = Math.abs(coinState.vx) * bounce;
      reflectSpin("x");
      hit = true;
    } else if (coinState.x > state.bounds.maxX) {
      coinState.x = state.bounds.maxX;
      coinState.vx = -Math.abs(coinState.vx) * bounce;
      reflectSpin("x");
      hit = true;
    }

    if (coinState.y < state.bounds.minY) {
      coinState.y = state.bounds.minY;
      coinState.vy = Math.abs(coinState.vy) * bounce;
      reflectSpin("y");
      hit = true;
    } else if (coinState.y > state.bounds.maxY) {
      coinState.y = state.bounds.maxY;
      coinState.vy = -Math.abs(coinState.vy) * bounce;
      reflectSpin("y");
      hit = true;
    }

    if (hit) {
      playBounceSound();
    }
  }

  // 撞牆時鏡射翻轉軸 L(角動量是贗向量),扣一點轉速
  function reflectSpin(wall) {
    if (wall === "x") coinState.Lx = -coinState.Lx;
    else coinState.Ly = -coinState.Ly;
    normalizeL();
    coinState.omega *= 0.85;
  }

  function finishSettle() {
    const pole = coinState.settle ? coinState.settle.pole : (coinState.nz >= 0 ? 1 : -1);
    coinState.result = pole >= 0 ? "heads" : "tails";
    coinState.z = 0;
    setRestOrientation(coinState.result);   // 攤平到該面 + 微小裝飾傾斜
    finishThrow();
  }

  function finishThrow() {
    coinState.phase = "idle";
    coinState.z = 0;
    coinState.vx = 0;
    coinState.vy = 0;
    coinState.vz = 0;
    coinState.omega = 0;
    coinState.settle = null;
    coinState.phi = ((coinState.phi % 360) + 360) % 360;
    elements.quickFlipButton.disabled = false;
    elements.coinScene.classList.remove("is-flying");

    state.stats.total += 1;
    state.stats[coinState.result] += 1;
    saveStats();
    renderStats();

    setResult(coinState.result === "heads" ? "正面" : "反面", coinState.result);
    burstParticles(coinState.result);
    playResultSound(coinState.result);
  }

  function renderCoin() {
    const radius = coinState.visualRadius || coinState.radius;
    const lift = coinState.z * 0.22;
    const scale = 1 + coinState.z / 1050;
    const sceneX = coinState.x - radius;
    const sceneY = coinState.y - radius - lift;
    const coinDepth = Math.max(4, radius * 0.064);
    // 質感光環:rim 刻意排在幣面外側一小圈(Dino 2026-07-04 指定,間距隨幣徑縮放)
    const rimRadius = radius + clamp(radius * 0.2, 5, 9);
    const rimWidth = Math.max(2.1, (Math.PI * 2 * rimRadius) / 144);
    const rimOpacity = 1;

    elements.coinScene.style.transform = `translate3d(${sceneX}px, ${sceneY}px, 0) scale(${scale})`;
    elements.coinScene.style.setProperty("--coin-depth", `${coinDepth}px`);
    elements.coinScene.style.setProperty("--coin-depth-half", `${coinDepth / 2}px`);
    elements.coinScene.style.setProperty("--coin-depth-half-neg", `${-coinDepth / 2}px`);
    elements.coinScene.style.setProperty("--rim-offset", `${-rimRadius}px`);
    elements.coinScene.style.setProperty("--rim-width", `${rimWidth}px`);
    elements.coinScene.style.setProperty("--rim-opacity", String(rimOpacity));
    // 由面法線 n 算「把 +z 轉到 n」的軸(= cross(+z,n) = (-ny, nx, 0),落在螢幕平面)與角,
    // 再疊面內自旋 phi。CSS rotate3d 會自行正規化軸向,故無須手動 normalize。
    const nz = clamp(coinState.nz, -1, 1);
    const tiltDeg = (Math.acos(nz) * 180) / Math.PI;
    let ax = -coinState.ny;
    let ay = coinState.nx;
    let az = 0;
    if (Math.hypot(ax, ay) < 1e-4) {   // n≈±z 退化:軸不定,給安全值
      ax = nz >= 0 ? 0 : 1;
      ay = 0;
      az = nz >= 0 ? 1 : 0;
    }
    elements.coin.style.setProperty("--ax", ax.toFixed(4));
    elements.coin.style.setProperty("--ay", ay.toFixed(4));
    elements.coin.style.setProperty("--az", az.toFixed(4));
    elements.coin.style.setProperty("--tilt", `${tiltDeg.toFixed(3)}deg`);
    elements.coin.style.setProperty("--phi", `${coinState.phi.toFixed(3)}deg`);

    const shadowScale = clamp(1.1 - coinState.z / 780, 0.56, 1.12);
    const shadowOpacity = clamp(0.48 - coinState.z / 900, 0.16, 0.52);
    const shadowWidth = radius * 1.65;
    const shadowHeight = Math.max(18, radius * 0.42);
    elements.coinShadow.style.width = `${shadowWidth}px`;
    elements.coinShadow.style.height = `${shadowHeight}px`;
    elements.coinShadow.style.opacity = String(shadowOpacity);
    elements.coinShadow.style.transform = `translate3d(${coinState.x - shadowWidth / 2}px, ${coinState.y + radius * 0.58}px, 0) scale(${shadowScale}, ${shadowScale * 0.72})`;
  }

  function clampCoinToBounds() {
    coinState.x = clamp(coinState.x, state.bounds.minX, state.bounds.maxX);
    coinState.y = clamp(coinState.y, state.bounds.minY, state.bounds.maxY);
  }

  function getLocalPoint(event) {
    const rect = elements.playfield.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function setResult(text, result) {
    elements.resultBanner.textContent = text;
    elements.resultBanner.classList.toggle("is-heads", result === "heads");
    elements.resultBanner.classList.toggle("is-tails", result === "tails");
  }

  function setStatus(message) {
    elements.statusLine.textContent = message;
  }

  function createParticles() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 28; index += 1) {
      const particle = document.createElement("span");
      particle.className = "particle";
      fragment.appendChild(particle);
    }
    elements.particles.appendChild(fragment);
  }

  function createRim() {
    const fragment = document.createDocumentFragment();
    const segments = 144;

    for (let index = 0; index < segments; index += 1) {
      const slice = document.createElement("span");
      slice.className = "rim-slice";
      slice.style.setProperty("--angle", `${(360 / segments) * index}deg`);
      slice.style.setProperty("--slice-light", index % 3 === 0 ? "#202936" : "#141b24");
      fragment.appendChild(slice);
    }

    elements.coinRim.appendChild(fragment);
  }

  function burstParticles(result) {
    const colors =
      result === "heads"
        ? ["#ffd76d", "#fff2ae", "#ff5364", "#ffffff"]
        : ["#6be8ff", "#8ab7ff", "#ffffff", "#ffd76d"];

    elements.particles.style.setProperty("--burst-x", `${coinState.x}px`);
    elements.particles.style.setProperty("--burst-y", `${coinState.y}px`);

    Array.from(elements.particles.children).forEach((particle, index) => {
      const angle = (index / elements.particles.children.length) * Math.PI * 2 + Math.random() * 0.72;
      const distance = randomBetween(70, 170);
      particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
      particle.style.setProperty("--scale", String(randomBetween(0.55, 1.35)));
      particle.style.setProperty("--particle-color", colors[index % colors.length]);
      particle.style.animationDelay = `${Math.random() * 70}ms`;
    });

    elements.particles.classList.remove("is-active");
    void elements.particles.offsetWidth;
    elements.particles.classList.add("is-active");
    window.setTimeout(() => elements.particles.classList.remove("is-active"), 820);
  }

  function getAudioContext() {
    if (!state.soundEnabled) {
      return null;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    if (!state.audioContext) {
      state.audioContext = new AudioContextConstructor();
    }

    if (state.audioContext.state === "suspended") {
      state.audioContext.resume();
    }

    return state.audioContext;
  }

  function playTone({ frequency, duration, delay = 0, type = "sine", gain = 0.045 }) {
    const context = getAudioContext();
    if (!context) {
      return;
    }

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const volume = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playButtonSound(success) {
    if (!success) {
      playTone({ frequency: 150, duration: 0.1, type: "sawtooth", gain: 0.025 });
      return;
    }

    playTone({ frequency: 440, duration: 0.06, type: "triangle", gain: 0.032 });
    playTone({ frequency: 720, duration: 0.07, delay: 0.035, type: "triangle", gain: 0.024 });
  }

  function playFlipSound() {
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime;

    const buf = context.createBuffer(1, context.sampleRate * 0.08, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / context.sampleRate;
      const env = Math.exp(-t * 60);
      data[i] = env * (
        Math.sin(t * 2 * Math.PI * 3200) * 0.3 +
        Math.sin(t * 2 * Math.PI * 5800) * 0.2 +
        Math.sin(t * 2 * Math.PI * 8400) * 0.1 +
        (Math.random() * 2 - 1) * 0.15
      );
    }
    const flick = context.createBufferSource();
    flick.buffer = buf;
    const flickGain = context.createGain();
    flickGain.gain.setValueAtTime(0.18, now);
    flick.connect(flickGain);
    flickGain.connect(context.destination);
    flick.start(now);

    const spinCount = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < spinCount; i++) {
      const delay = 0.04 + i * (0.028 + i * 0.004);
      const tickBuf = context.createBuffer(1, context.sampleRate * 0.015, context.sampleRate);
      const tickData = tickBuf.getChannelData(0);
      const freq = 4200 + Math.random() * 1800;
      for (let j = 0; j < tickData.length; j++) {
        const tt = j / context.sampleRate;
        tickData[j] = Math.exp(-tt * 200) * (
          Math.sin(tt * 2 * Math.PI * freq) * 0.4 +
          (Math.random() * 2 - 1) * 0.1
        );
      }
      const tick = context.createBufferSource();
      tick.buffer = tickBuf;
      const tickGain = context.createGain();
      const vol = 0.06 * (1 - i / spinCount * 0.5);
      tickGain.gain.setValueAtTime(vol, now + delay);
      tick.connect(tickGain);
      tickGain.connect(context.destination);
      tick.start(now + delay);
    }
  }

  function playBounceSound() {
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const buf = context.createBuffer(1, context.sampleRate * 0.04, context.sampleRate);
    const data = buf.getChannelData(0);
    const freq = randomBetween(2800, 4200);
    for (let i = 0; i < data.length; i++) {
      const t = i / context.sampleRate;
      data[i] = Math.exp(-t * 120) * (
        Math.sin(t * 2 * Math.PI * freq) * 0.35 +
        (Math.random() * 2 - 1) * 0.08
      );
    }
    const src = context.createBufferSource();
    src.buffer = buf;
    const g = context.createGain();
    g.gain.setValueAtTime(0.08, now);
    src.connect(g);
    g.connect(context.destination);
    src.start(now);
  }

  function playResultSound(result) {
    const base = result === "heads" ? 520 : 390;
    playTone({ frequency: base, duration: 0.14, type: "triangle", gain: 0.04 });
    playTone({ frequency: base * 1.5, duration: 0.18, delay: 0.06, type: "sine", gain: 0.034 });
    playTone({ frequency: base * 2, duration: 0.22, delay: 0.12, type: "triangle", gain: 0.027 });
  }

  function nearestAngle(current, targetModulo) {
    return Math.round((current - targetModulo) / 360) * 360 + targetModulo;
  }

  // 面法線 n = cos(beta)·L + sin(beta)·(cos(psi)·e1 + sin(psi)·e2),{e1,e2} 為垂直 L 的正交基。
  // 隨 psi 累加,n 繞 L 打錐形 → 掃過鏡頭正對/背對 = 翻正反面,帶固定 beta 傾角 = 自然搖擺。
  function updateOrientation() {
    const Lx = coinState.Lx, Ly = coinState.Ly, Lz = coinState.Lz;
    const ax = Math.abs(Lz) < 0.9 ? 0 : 1;
    const az = Math.abs(Lz) < 0.9 ? 1 : 0;
    // e1 = normalize(cross(a, L)),a = (ax,0,az)
    let e1x = 0 * Lz - az * Ly;
    let e1y = az * Lx - ax * Lz;
    let e1z = ax * Ly - 0 * Lx;
    const e1len = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= e1len; e1y /= e1len; e1z /= e1len;
    // e2 = cross(L, e1)
    const e2x = Ly * e1z - Lz * e1y;
    const e2y = Lz * e1x - Lx * e1z;
    const e2z = Lx * e1y - Ly * e1x;
    const cb = Math.cos(coinState.beta), sb = Math.sin(coinState.beta);
    const cp = Math.cos(degToRad(coinState.psi)), sp = Math.sin(degToRad(coinState.psi));
    coinState.nx = cb * Lx + sb * (cp * e1x + sp * e2x);
    coinState.ny = cb * Ly + sb * (cp * e1y + sp * e2y);
    coinState.nz = cb * Lz + sb * (cp * e1z + sp * e2z);
  }

  function phaseForNormal(normal) {
    const Lx = coinState.Lx, Ly = coinState.Ly, Lz = coinState.Lz;
    const ax = Math.abs(Lz) < 0.9 ? 0 : 1;
    const az = Math.abs(Lz) < 0.9 ? 1 : 0;
    let e1x = -az * Ly;
    let e1y = az * Lx - ax * Lz;
    let e1z = ax * Ly;
    const e1len = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= e1len; e1y /= e1len; e1z /= e1len;
    const e2x = Ly * e1z - Lz * e1y;
    const e2y = Lz * e1x - Lx * e1z;
    const e2z = Lx * e1y - Ly * e1x;
    const alongE1 = normal.x * e1x + normal.y * e1y + normal.z * e1z;
    const alongE2 = normal.x * e2x + normal.y * e2y + normal.z * e2z;
    return Math.atan2(alongE2, alongE1) * 180 / Math.PI;
  }

  // 靜置:硬幣平躺、指定面朝鏡頭,帶一點裝飾性微傾不死板
  function setRestOrientation(face) {
    coinState.result = face;
    coinState.Lx = 0;
    coinState.Ly = 0;
    coinState.Lz = face === "tails" ? -1 : 1;
    coinState.beta = degToRad(randomBetween(1.5, 3.5));
    coinState.psi = randomBetween(0, 360);
    coinState.settle = null;
    updateOrientation();
  }

  function normalizeL() {
    const len = Math.hypot(coinState.Lx, coinState.Ly, coinState.Lz) || 1;
    coinState.Lx /= len;
    coinState.Ly /= len;
    coinState.Lz /= len;
  }

  function getVisibleSide() {
    return coinState.nz >= 0 ? "heads" : "tails";
  }

  function getEdgeAmount() {
    return Math.hypot(coinState.nx, coinState.ny);
  }

  function degToRad(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function easeOutQuart(value) {
    return 1 - Math.pow(1 - value, 4);
  }

  function easeInOutCubic(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function smoothStep(edge0, edge1, value) {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function debounce(callback, wait) {
    let timer = 0;
    return function debounced() {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, wait);
    };
  }
})();
