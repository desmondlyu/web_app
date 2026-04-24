// ================================================================
// app.js — 主控制器 + 狀態管理
// ================================================================

// ──────────────────────────────────────────────────────────────
// 主題管理（深色為預設，localStorage 持久化）
// ──────────────────────────────────────────────────────────────

function _applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  // 更新兩組按鈕（上傳頁 & 儀表板頁）
  ['upload', 'dash'].forEach(suffix => {
    const iconEl  = document.getElementById(`theme-icon-${suffix}`);
    const labelEl = document.getElementById(`theme-label-${suffix}`);
    if (iconEl)  iconEl.textContent  = isDark ? '☀' : '🌙';
    if (labelEl) labelEl.textContent = isDark ? '亮色' : '暗色';
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('tto-theme', next);
  _applyTheme(next);
}

// 頁面載入時套用已儲存主題（預設 dark）
(function initTheme() {
  const saved = localStorage.getItem('tto-theme') || 'dark';
  _applyTheme(saved);
})();

/** 應用程式狀態 */
const _state = {
  cpFile:   null,   // CP Summary File
  mssFile:  null,   // MSS File
  rawFiles: [],     // Rawdata TXT Files (可選)
  result:   null,   // crossAnalyze 輸出
  rawData:  null,   // parseRawdata 輸出
  product:  'UNKNOWN'
};

// ──────────────────────────────────────────────────────────────
// 檔案上傳處理
// ──────────────────────────────────────────────────────────────

function onFileChange(type, files) {
  if (!files || !files.length) return;

  if (type === 'cp') {
    _state.cpFile = files[0];
    _setFileLabel('cp-filename', files[0].name, 'zone-cp', 'has-file--blue', 'cp-action');
  } else if (type === 'mss') {
    _state.mssFile = files[0];
    _setFileLabel('mss-filename', files[0].name, 'zone-mss', 'has-file--green', 'mss-action');
  } else if (type === 'raw') {
    _state.rawFiles = Array.from(files);
    const label = _state.rawFiles.length === 1
      ? files[0].name
      : `${_state.rawFiles.length} 個 TXT 檔案`;
    _setFileLabel('raw-filenames', label, 'zone-raw', 'has-file--amber', 'raw-action');
  }

  _updateAnalyzeBtn();
}

function _setFileLabel(labelId, text, zoneId, hasFileClass, actionId) {
  const el = document.getElementById(labelId);
  if (el) { el.textContent = text; el.classList.remove('hidden'); }

  const zone = document.getElementById(zoneId);
  if (zone) zone.classList.add(hasFileClass);

  const action = document.getElementById(actionId);
  if (action) action.textContent = '✓ 已上傳';
}

function onDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId)?.classList.add('dragover');
}

function onDragLeave(e, zoneId) {
  document.getElementById(zoneId)?.classList.remove('dragover');
}

function onDrop(e, type) {
  e.preventDefault();
  const zoneMap = { cp: 'zone-cp', mss: 'zone-mss', raw: 'zone-raw' };
  document.getElementById(zoneMap[type])?.classList.remove('dragover');

  // 驗證拖入的檔案類型
  const files = e.dataTransfer.files;
  if (type === 'raw') {
    const txtFiles = Array.from(files).filter(f => /\.txt$/i.test(f.name));
    if (!txtFiles.length) { showToast('⚠️', '請拖入 .TXT 格式的 rawdata 檔案', true); return; }
    onFileChange(type, txtFiles);
  } else {
    const xlFile = Array.from(files).find(f => /\.xlsx?$/i.test(f.name));
    if (!xlFile) { showToast('⚠️', '請拖入 .xlsx 或 .xls 格式的 Excel 檔案', true); return; }
    onFileChange(type, [xlFile]);
  }
}

function _updateAnalyzeBtn() {
  const btn = document.getElementById('btn-analyze');
  if (btn) btn.disabled = !(_state.cpFile && _state.mssFile);
}

// ──────────────────────────────────────────────────────────────
// 分析流程
// ──────────────────────────────────────────────────────────────

async function startAnalysis() {
  document.getElementById('btn-analyze').disabled = true;
  document.getElementById('progress-section').classList.remove('hidden');

  try {
    // 1. 解析 CP Summary
    _setProgress(8, '解析 CP Summary...');
    const cpData = await parseCPSummary(_state.cpFile);

    // 2. 解析 MSS
    _setProgress(28, '解析 MSS...');
    const mssData = await parseMSS(_state.mssFile);

    // 3. 解析 Rawdata（選填）
    let rawData = null;
    if (_state.rawFiles.length > 0) {
      _setProgress(48, `解析 Rawdata（${_state.rawFiles.length} 個檔案）...`);
      rawData = await parseRawdata(_state.rawFiles);
    }

    // 4. 交叉分析
    _setProgress(68, '交叉分析中...');
    const thrVeryLow = parseFloat(document.getElementById('thr-very-low').value) || 50;
    const thrLow     = parseFloat(document.getElementById('thr-low').value)      || 500;

    // 決定 product 名稱（CP Summary > rawdata > UNKNOWN）
    let product = (cpData.product && cpData.product !== 'UNKNOWN') ? cpData.product : 'UNKNOWN';
    if (product === 'UNKNOWN' && rawData && rawData.product !== 'UNKNOWN') product = rawData.product;

    const result = crossAnalyze(
      cpData, mssData, rawData,
      { thr_very_low: thrVeryLow, thr_low: thrLow },
      product
    );

    // 5. 渲染儀表板
    _setProgress(85, '渲染儀表板...');
    _state.result  = result;
    _state.rawData = rawData;
    _state.product = product;

    window._TTOResult  = result;  // renderer.js 的 onclick 需要存取
    window._TTORawData = rawData; // renderTop10 需要存取

    await _sleep(80); // 讓 progress bar 動畫顯示

    renderDashboard(result);

    _setProgress(100, '完成！');
    await _sleep(350);

    // 切換到儀表板畫面
    document.getElementById('upload-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('progress-section').classList.add('hidden');

  } catch (err) {
    console.error('分析失敗：', err);
    showToast('❌', `分析失敗：${err.message || String(err)}`, true);
    document.getElementById('progress-section').classList.add('hidden');
    document.getElementById('btn-analyze').disabled = false;
  }
}

function _setProgress(pct, text) {
  const bar = document.getElementById('progress-bar');
  const txt = document.getElementById('progress-text');
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent  = text;
}

// ──────────────────────────────────────────────────────────────
// 匯出
// ──────────────────────────────────────────────────────────────

function doExport() {
  if (!_state.result) { showToast('⚠️', '尚未有分析結果，請先執行分析', true); return; }
  try {
    exportToExcel(_state.result, _state.rawData);
    showToast('✅', 'Excel 匯出成功！');
  } catch (e) {
    console.error('匯出失敗：', e);
    showToast('❌', `匯出失敗：${e.message || String(e)}`, true);
  }
}

// ──────────────────────────────────────────────────────────────
// 導航
// ──────────────────────────────────────────────────────────────

function goBack() {
  RENDERER.destroyAllCharts();
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('upload-screen').classList.remove('hidden');
  // 重設進度
  _setProgress(0, '準備中...');
  document.getElementById('progress-section').classList.add('hidden');
  document.getElementById('btn-analyze').disabled = !(_state.cpFile && _state.mssFile);
}

// ──────────────────────────────────────────────────────────────
// Toast 通知
// ──────────────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(icon, msg, isError = false) {
  const el    = document.getElementById('toast');
  const iconEl = document.getElementById('toast-icon');
  const msgEl  = document.getElementById('toast-message');
  if (!el || !iconEl || !msgEl) return;

  iconEl.textContent = icon;
  msgEl.textContent  = msg;
  el.classList.remove('hidden');

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 5000 : 3500);
}

// ──────────────────────────────────────────────────────────────
// 工具函式
// ──────────────────────────────────────────────────────────────

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ──────────────────────────────────────────────────────────────
// 全局 APP 命名空間（供 HTML 事件處理器使用）
// ──────────────────────────────────────────────────────────────

const APP = {
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  startAnalysis,
  doExport,
  goBack,
  toggleTheme
};
