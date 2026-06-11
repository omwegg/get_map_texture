(function () {
  "use strict";

  // ── 定数 ────────────────────────────────────────────

  const TILE_SIZE = 256;
  const TILE_WARN = 100;

  const TILE_SOURCES = [
    // ── 高解像度衛星画像 ──
    {
      label: "ESRI 衛星画像（高解像度）",
      group: "高解像度衛星画像",
      maxZoom: 19,
      getUrl: (z, x, y) =>
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    },
    {
      label: "Google 衛星画像",
      group: "高解像度衛星画像",
      maxZoom: 21,
      getUrl: (z, x, y) =>
        `https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`,
    },
    // ── 地理院タイル ──
    {
      label: "空中写真（シームレス）",
      group: "地理院タイル",
      maxZoom: 18,
      getUrl: (z, x, y) =>
        `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`,
    },
    {
      label: "標準地図",
      group: "地理院タイル",
      maxZoom: 18,
      getUrl: (z, x, y) =>
        `https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`,
    },
    {
      label: "淡色地図",
      group: "地理院タイル",
      maxZoom: 18,
      getUrl: (z, x, y) =>
        `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`,
    },
    {
      label: "白地図",
      group: "地理院タイル",
      maxZoom: 14,
      getUrl: (z, x, y) =>
        `https://cyberjapandata.gsi.go.jp/xyz/blank/${z}/${x}/${y}.png`,
    },
    {
      label: "色別標高図",
      group: "地理院タイル",
      maxZoom: 15,
      getUrl: (z, x, y) =>
        `https://cyberjapandata.gsi.go.jp/xyz/relief/${z}/${x}/${y}.png`,
    },
  ];

  // ── 状態 ────────────────────────────────────────────

  let panel = null;
  let overlay = null;
  let selecting = false;
  let clickCount = 0;
  let topLeft = null;
  let bottomRight = null;
  let markers = [];
  let rectEl = null;
  let downloading = false;
  let cachedMapState = null;

  // ── Google Maps のビューポート解析 ───────────────────

  function parseMapUrl(url) {
    // パターン 1: @lat,lng,Xz  (ズームレベル表記)
    let m = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)z/);
    if (m) {
      return {
        lat: parseFloat(m[1]),
        lng: parseFloat(m[2]),
        zoom: parseFloat(m[3]),
      };
    }

    // パターン 2: @lat,lng,Xm  (メートル表記 — 衛星ビュー等)
    m = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)m/);
    if (m) {
      const lat = parseFloat(m[1]);
      const meters = parseFloat(m[3]);
      // 経験的な変換: zoom ≈ 25.6 - log2(meters)
      const zoom = 25.6 - Math.log2(meters);
      return {
        lat,
        lng: parseFloat(m[2]),
        zoom: Math.max(1, Math.min(21, zoom)),
      };
    }

    // パターン 3: @lat,lng,Xa,...  (3D / Street View)
    m = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)a/);
    if (m) {
      const lat = parseFloat(m[1]);
      const alt = parseFloat(m[3]);
      const zoom = 25.6 - Math.log2(alt);
      return {
        lat,
        lng: parseFloat(m[2]),
        zoom: Math.max(1, Math.min(21, zoom)),
      };
    }

    return null;
  }

  function getMapState() {
    const state = parseMapUrl(location.href);
    if (state) {
      cachedMapState = state;
      return state;
    }
    // URL から取得できない場合はキャッシュを返す
    return cachedMapState;
  }

  // URL の変化を監視してキャッシュを更新
  (function watchUrl() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        const s = parseMapUrl(lastUrl);
        if (s) cachedMapState = s;
      }
    }, 1000);
  })();

  function getMapRect() {
    const selectors = [
      'div[aria-roledescription="map"]',
      "canvas.widget-scene-canvas",
      "#scene",
      ".widget-scene",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 100 && r.height > 100) return r;
      }
    }
    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  // ── 座標変換 ────────────────────────────────────────

  function pixelToLatLng(clientX, clientY) {
    const state = getMapState();
    if (!state) return null;

    const rect = getMapRect();
    const scale = 256 * Math.pow(2, state.zoom);

    const dx = clientX - rect.left - rect.width / 2;
    const dy = clientY - rect.top - rect.height / 2;

    const cx = ((state.lng + 180) / 360) * scale;
    const latRad = (state.lat * Math.PI) / 180;
    const cy =
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
        2) *
      scale;

    const wx = cx + dx;
    const wy = cy + dy;

    const lng = (wx / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * wy) / scale;
    const lat =
      (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

    return {
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
    };
  }

  function latlngToTile(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n
    );
    return { x, y };
  }

  // ── ソース選択の HTML 生成 ──────────────────────────

  function buildSourceOptions() {
    let html = "";
    let currentGroup = "";
    TILE_SOURCES.forEach((src, i) => {
      if (src.group !== currentGroup) {
        if (currentGroup) html += "</optgroup>";
        html += `<optgroup label="${src.group}">`;
        currentGroup = src.group;
      }
      html += `<option value="${i}">${src.label}</option>`;
    });
    if (currentGroup) html += "</optgroup>";
    return html;
  }

  function buildZoomOptions(maxZoom, selected) {
    let html = "";
    for (let z = 1; z <= maxZoom; z++) {
      html += `<option value="${z}"${z === selected ? " selected" : ""}>${z}</option>`;
    }
    return html;
  }

  // ── パネル構築 ──────────────────────────────────────

  function createPanel() {
    if (panel) return;

    const defaultSource = TILE_SOURCES[0];

    panel = document.createElement("div");
    panel.id = "gsi-panel";
    panel.innerHTML = `
      <div class="gsi-header">
        <span>タイル取得ツール</span>
        <button id="gsi-minimize" title="最小化">−</button>
      </div>
      <div class="gsi-body">
        <label>画像ソース</label>
        <select id="gsi-type">${buildSourceOptions()}</select>

        <label>ズームレベル</label>
        <select id="gsi-zoom">${buildZoomOptions(defaultSource.maxZoom, 15)}</select>

        <button id="gsi-select" class="gsi-btn gsi-btn-select">
          📍 範囲を選択
        </button>

        <div id="gsi-coords">
          <div id="gsi-tl">左上: 未選択</div>
          <div id="gsi-br">右下: 未選択</div>
          <div id="gsi-tile-info"></div>
        </div>

        <div id="gsi-progress" style="display:none">
          <div id="gsi-progress-bar"><div id="gsi-progress-fill"></div></div>
          <div id="gsi-progress-text"></div>
        </div>

        <button id="gsi-download" class="gsi-btn gsi-btn-download" disabled>
          ダウンロード
        </button>
      </div>
    `;
    document.body.appendChild(panel);

    makeDraggable(panel, panel.querySelector(".gsi-header"));

    $("gsi-minimize").addEventListener("click", togglePanel);
    $("gsi-select").addEventListener("click", startSelection);
    $("gsi-download").addEventListener("click", startDownload);
    $("gsi-type").addEventListener("change", onSourceChanged);
    $("gsi-zoom").addEventListener("change", updateTileInfo);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function togglePanel() {
    const body = panel.querySelector(".gsi-body");
    const btn = $("gsi-minimize");
    if (body.style.display === "none") {
      body.style.display = "";
      btn.textContent = "−";
    } else {
      body.style.display = "none";
      btn.textContent = "+";
    }
  }

  // ── ソース切替時のズーム調整 ────────────────────────

  function onSourceChanged() {
    const src = TILE_SOURCES[parseInt($("gsi-type").value)];
    const zoomEl = $("gsi-zoom");
    const current = parseInt(zoomEl.value) || 15;
    const clamped = Math.min(current, src.maxZoom);
    zoomEl.innerHTML = buildZoomOptions(src.maxZoom, clamped);
    updateTileInfo();
  }

  // ── ドラッグ ────────────────────────────────────────

  function makeDraggable(el, handle) {
    let dragging = false,
      sx,
      sy,
      ox,
      oy;
    handle.style.cursor = "grab";

    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      ox = el.offsetLeft;
      oy = el.offsetTop;
      handle.style.cursor = "grabbing";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = ox + e.clientX - sx + "px";
      el.style.top = oy + e.clientY - sy + "px";
      el.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = "grab";
    });
  }

  // ── 範囲選択モード ──────────────────────────────────

  function startSelection() {
    if (selecting || downloading) return;

    selecting = true;
    clickCount = 0;
    topLeft = null;
    bottomRight = null;
    clearVisuals();

    const btn = $("gsi-select");
    btn.textContent = "🎯 左上をクリック...";
    btn.classList.add("active");

    $("gsi-tl").textContent = "左上: マップ上をクリック...";
    $("gsi-br").textContent = "右下: —";
    $("gsi-tile-info").textContent = "";
    $("gsi-download").disabled = true;

    overlay = document.createElement("div");
    overlay.id = "gsi-overlay";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", onOverlayClick);
    overlay.addEventListener("contextmenu", cancelSelection);
  }

  function cancelSelection(e) {
    e.preventDefault();
    endSelection();
    clearVisuals();
    $("gsi-tl").textContent = "左上: 未選択";
    $("gsi-br").textContent = "右下: 未選択";
    $("gsi-tile-info").textContent = "右クリックでキャンセルしました";
  }

  function endSelection() {
    selecting = false;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    const btn = $("gsi-select");
    btn.textContent = "📍 範囲を再選択";
    btn.classList.remove("active");
  }

  function onOverlayClick(e) {
    const ll = pixelToLatLng(e.clientX, e.clientY);
    if (!ll) {
      alert(
        "Google Maps のビューポート情報を取得できませんでした。\n\n" +
        "対処法:\n" +
        "・地図を少しドラッグして動かしてください（URLが更新されます）\n" +
        "・ストリートビューを閉じて通常の地図表示にしてください\n\n" +
        "現在のURL:\n" + location.href.substring(0, 120)
      );
      return;
    }

    clickCount++;

    if (clickCount === 1) {
      topLeft = ll;
      addMarker(e.clientX, e.clientY, "1");
      $("gsi-tl").textContent = `左上: ${ll.lat}, ${ll.lng}`;
      $("gsi-br").textContent = "右下: マップ上をクリック...";
      $("gsi-select").textContent = "🎯 右下をクリック...";
    } else {
      bottomRight = ll;
      addMarker(e.clientX, e.clientY, "2");
      $("gsi-br").textContent = `右下: ${ll.lat}, ${ll.lng}`;
      drawRect();
      endSelection();
      updateTileInfo();
    }
  }

  // ── マーカー & 矩形 ────────────────────────────────

  function addMarker(x, y, label) {
    const m = document.createElement("div");
    m.className = "gsi-marker";
    m.textContent = label;
    m.style.left = x + "px";
    m.style.top = y + "px";
    document.body.appendChild(m);
    markers.push(m);
  }

  function drawRect() {
    if (markers.length < 2) return;
    const x1 = parseInt(markers[0].style.left);
    const y1 = parseInt(markers[0].style.top);
    const x2 = parseInt(markers[1].style.left);
    const y2 = parseInt(markers[1].style.top);

    rectEl = document.createElement("div");
    rectEl.className = "gsi-rect";
    rectEl.style.left = Math.min(x1, x2) + "px";
    rectEl.style.top = Math.min(y1, y2) + "px";
    rectEl.style.width = Math.abs(x2 - x1) + "px";
    rectEl.style.height = Math.abs(y2 - y1) + "px";
    document.body.appendChild(rectEl);
  }

  function clearVisuals() {
    markers.forEach((m) => m.remove());
    markers = [];
    if (rectEl) {
      rectEl.remove();
      rectEl = null;
    }
  }

  // ── タイル情報の計算 ────────────────────────────────

  function getTileRange() {
    if (!topLeft || !bottomRight) return null;
    const zoom = parseInt($("gsi-zoom").value);
    const tl = latlngToTile(topLeft.lat, topLeft.lng, zoom);
    const br = latlngToTile(bottomRight.lat, bottomRight.lng, zoom);

    const xMin = Math.min(tl.x, br.x);
    const xMax = Math.max(tl.x, br.x);
    const yMin = Math.min(tl.y, br.y);
    const yMax = Math.max(tl.y, br.y);

    return {
      xMin,
      xMax,
      yMin,
      yMax,
      cx: xMax - xMin + 1,
      cy: yMax - yMin + 1,
    };
  }

  function updateTileInfo() {
    const range = getTileRange();
    if (!range) return;

    const total = range.cx * range.cy;
    const info = $("gsi-tile-info");
    info.textContent = `${range.cx} x ${range.cy} = ${total} 枚`;
    info.className = total > TILE_WARN ? "warn" : "";

    $("gsi-download").disabled = false;
  }

  // ── ダウンロード ────────────────────────────────────

  async function startDownload() {
    if (downloading) return;

    const range = getTileRange();
    if (!range) return;

    const total = range.cx * range.cy;
    if (total > TILE_WARN) {
      if (!confirm(`${total} 枚のタイルをダウンロードします。\n続行しますか？`)) {
        return;
      }
    }

    const zoom = parseInt($("gsi-zoom").value);
    const source = TILE_SOURCES[parseInt($("gsi-type").value)];

    // 選択表示をクリア（座標はパネルに残る）
    clearVisuals();

    // UI ロック
    downloading = true;
    $("gsi-download").disabled = true;
    $("gsi-select").disabled = true;
    const progress = $("gsi-progress");
    const fill = $("gsi-progress-fill");
    const text = $("gsi-progress-text");
    progress.style.display = "block";
    fill.style.width = "0%";

    // Canvas
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE * range.cx;
    canvas.height = TILE_SIZE * range.cy;
    const ctx = canvas.getContext("2d");

    let done = 0;
    let failed = 0;

    for (let row = 0; row < range.cy; row++) {
      for (let col = 0; col < range.cx; col++) {
        const x = range.xMin + col;
        const y = range.yMin + row;
        done++;

        text.textContent = `[${done}/${total}] タイル (${x}, ${y})`;
        fill.style.width = (done / total) * 100 + "%";

        try {
          const url = source.getUrl(zoom, x, y);
          const dataUrl = await fetchTile(url);
          if (dataUrl) {
            const img = await loadImage(dataUrl);
            ctx.drawImage(img, col * TILE_SIZE, row * TILE_SIZE);
          } else {
            throw new Error("fetch failed");
          }
        } catch {
          failed++;
          ctx.fillStyle = "#b4b4b4";
          ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }

        await new Promise((r) => requestAnimationFrame(r));
      }
    }

    // ファイル名を生成
    const srcLabel = source.label.replace(/[（）\(\)\s]/g, "_");
    const filename = `${srcLabel}_z${zoom}_${range.xMin}_${range.yMin}_${range.cx}x${range.cy}.jpg`;

    canvas.toBlob(
      (blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);

        fill.style.width = "100%";
        let msg = `完了! (${canvas.width}x${canvas.height} px)`;
        if (failed) msg += `  ⚠ ${failed} 枚失敗`;
        text.textContent = msg;

        downloading = false;
        $("gsi-download").disabled = false;
        $("gsi-select").disabled = false;
      },
      "image/jpeg",
      0.95
    );
  }

  function fetchTile(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "fetchTile", url }, (res) => {
        resolve(res && res.dataUrl ? res.dataUrl : null);
      });
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ── 初期化 ──────────────────────────────────────────

  function init() {
    const toggle = document.createElement("button");
    toggle.id = "gsi-toggle";
    toggle.textContent = "🗺️";
    toggle.title = "タイル取得ツール";
    document.body.appendChild(toggle);

    toggle.addEventListener("click", () => {
      if (!panel) createPanel();
      panel.style.display = "block";
      panel.querySelector(".gsi-body").style.display = "";
      $("gsi-minimize").textContent = "−";
    });

    createPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
