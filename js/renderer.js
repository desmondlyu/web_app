// ================================================================
// renderer.js — 儀表板渲染模組
// ================================================================

/** 狀態標籤（繁體中文） */
const STATUS_LABELS = {
  never_occurred: '可移除 (從未失效)',
  very_low_risk:  '低風險可移除 (<50 ppm)',
  low_risk:       '建議觀察 (<500 ppm)',
  repair_item:    'Repair 保護項',
  has_loss:       '有 Yield Loss'
};

const STATUS_CHART_COLORS = {
  never_occurred: '#16A34A',
  very_low_risk:  '#2563EB',
  low_risk:       '#D97706',
  repair_item:    '#9333EA',
  has_loss:       '#DC2626'
};

// Chart.js 實例快取
const _charts = {};

// 表格狀態（排序、過濾）
const _tableState = {};

// ──────────────────────────────────────────────────────────────
// 頂層渲染入口
// ──────────────────────────────────────────────────────────────

/**
 * 渲染完整儀表板
 * @param {Object} result - crossAnalyze 的輸出
 */
function renderDashboard(result) {
  // 清除舊狀態
  for (const k of Object.keys(_tableState)) delete _tableState[k];

  // 頂部資訊列
  document.getElementById('db-product').textContent    = result.product;
  document.getElementById('db-timestamp').textContent =
    '分析時間：' + new Date(result.generated_at).toLocaleString('zh-TW');

  renderGlobalKPI(result);
  renderStationTabs(result);
}

// ──────────────────────────────────────────────────────────────
// 全局 KPI
// ──────────────────────────────────────────────────────────────

function renderGlobalKPI(result) {
  let totalItems = 0, totalRemovable = 0, totalRepair = 0, totalTimeSec = 0;
  for (const st of Object.values(result.stations)) {
    totalItems     += st.summary.total_items;
    totalRemovable += st.summary.removable_count;
    totalRepair    += st.summary.repair_item_count;
    totalTimeSec   += st.summary.total_removable_time_sec;
  }

  const timeStr = totalTimeSec >= 60
    ? `${(totalTimeSec / 60).toFixed(1)} min`
    : `${totalTimeSec.toFixed(2)} s`;

  const cards = [
    { label: '總測試項目數', value: totalItems,     color: '#2563EB', icon: '📋' },
    { label: '可移除項目數', value: totalRemovable, color: '#16A34A', icon: '✅' },
    { label: 'Repair 保護項', value: totalRepair,  color: '#9333EA', icon: '🔧' },
    { label: '估計節省時間',  value: timeStr,       color: '#D97706', icon: '⏱' }
  ];

  document.getElementById('global-kpi').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div style="font-size:1.4rem;margin-bottom:4px">${c.icon}</div>
      <div class="kpi-card__value" style="color:${c.color}">${c.value}</div>
      <div class="kpi-card__label">${c.label}</div>
    </div>
  `).join('');
}

// ──────────────────────────────────────────────────────────────
// Top 10 最耗時 Test Items（跨站點）
// ──────────────────────────────────────────────────────────────

function renderTop10(result) {
  const container = document.getElementById('top10-station-section');
  if (!container) return;

  // 跨所有站點、所有分類 收集 items，以 test_item 名稱去重（取最大 saved_time_sec，並彙整出現站點）
  const itemMap = new Map(); // key: test_item → { name, maxTime, stations: Set }

  for (const [stName, stData] of Object.entries(result.stations)) {
    const allItems = [
      ...(stData.removable     || []),
      ...(stData.repair_items  || []),
      ...(stData.not_removable || [])
    ];
    for (const item of allItems) {
      const name = item.test_item;
      const t    = item.saved_time_sec || 0;
      if (!itemMap.has(name)) {
        itemMap.set(name, { name, maxTime: t, totalTime: t, stations: new Set([stName]) });
      } else {
        const rec = itemMap.get(name);
        rec.totalTime += t;
        if (t > rec.maxTime) rec.maxTime = t;
        rec.stations.add(stName);
      }
    }
  }

  // 排序：依 totalTime 降冪，取 TOP 10
  const top10 = [...itemMap.values()]
    .filter(r => r.totalTime > 0)
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, 10);

  if (!top10.length) {
    container.innerHTML = '<div class="empty-state">— 無 Rawdata 時間資料，無法計算 Top 10 —</div>';
    return;
  }

  const maxTime = top10[0].totalTime;

  const rankClass = i => [
    'top10-rank-1', 'top10-rank-2', 'top10-rank-3'
  ][i] || 'top10-rank-other';

  const rows = top10.map((r, i) => {
    const pct     = maxTime > 0 ? (r.totalTime / maxTime * 100).toFixed(1) : 0;
    const barW    = maxTime > 0 ? (r.totalTime / maxTime * 100).toFixed(1) : 0;
    const stChips = [...r.stations].map(s =>
      `<span class="top10-chip">${_esc(s)}</span>`
    ).join('');
    const timeStr = r.totalTime >= 60
      ? (r.totalTime / 60).toFixed(2) + ' min'
      : r.totalTime.toFixed(3) + ' s';

    return `
      <tr>
        <td><span class="top10-rank ${rankClass(i)}">${i + 1}</span></td>
        <td class="top10-item-name" title="${_esc(r.name)}">${_esc(r.name)}</td>
        <td style="text-align:center">${stChips}</td>
        <td>
          <div class="top10-bar-row">
            <div class="top10-bar-track"><div class="top10-bar-fill" style="width:${barW}%"></div></div>
            <span class="top10-bar-val">${timeStr}</span>
          </div>
        </td>
        <td style="text-align:right;font-size:0.78rem;font-weight:700;color:#f97316">${pct}%</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="data-table top10-table">
      <thead><tr>
        <th style="width:44px">#</th>
        <th>Test Item 名稱</th>
        <th style="text-align:center">出現站點</th>
        <th>估計節省時間（加總）</th>
        <th style="text-align:right;width:64px">佔比</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ──────────────────────────────────────────────────────────────
// 站點分頁
// ──────────────────────────────────────────────────────────────

function renderStationTabs(result) {
  const names = Object.keys(result.stations);
  if (!names.length) return;

  document.getElementById('station-tabs').innerHTML = names.map(name => `
    <button class="station-tab" data-station="${_eid(name)}"
            onclick="RENDERER.switchStation('${_escJs(name)}', window._TTOResult)">
      ${_esc(name)}
      <span style="font-size:0.65rem;opacity:0.65;margin-left:3px">(${result.stations[name].summary.removable_count}✂)</span>
    </button>
  `).join('');

  // 預設顯示第一個站點
  RENDERER.switchStation(names[0], result);
}

// ──────────────────────────────────────────────────────────────
// 切換站點
// ──────────────────────────────────────────────────────────────

function switchStation(stationName, result) {
  // 更新分頁 active 狀態
  document.querySelectorAll('.station-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.station === _eid(stationName));
  });

  const stData = result.stations[stationName];
  if (!stData) return;

  // 銷毀此站點舊圖表（避免 canvas reuse 錯誤）
  const chartKey = _eid(stationName);
  if (_charts[chartKey]) { _charts[chartKey].destroy(); delete _charts[chartKey]; }

  const content = document.getElementById('station-content');
  content.innerHTML = _buildStationHTML(stationName, stData);

  // 建立環形圖
  const canvasEl = document.getElementById(`chart-${chartKey}`);
  if (canvasEl) {
    _charts[chartKey] = new Chart(canvasEl.getContext('2d'), _buildDonutConfig(stData.summary));
  }

  // 建立三張資料表
  _buildTable(`tbl-rm-${chartKey}`,  stData.removable,     _colsRemovable());
  _buildTable(`tbl-rp-${chartKey}`,  stData.repair_items,  _colsRepair());
  _buildTable(`tbl-nr-${chartKey}`,  stData.not_removable, _colsNotRemovable());

  // Top 10 最耗時（跨站點）——放在可移除項目上方
  renderTop10(result);
}

// ──────────────────────────────────────────────────────────────
// 站點 HTML 骨架
// ──────────────────────────────────────────────────────────────

function _buildStationHTML(name, stData) {
  const s  = stData.summary;
  const eid = _eid(name);
  const timeStr = s.total_removable_time_sec >= 60
    ? `${(s.total_removable_time_sec / 60).toFixed(2)} min`
    : `${s.total_removable_time_sec.toFixed(3)} s`;

  const miniKpis = [
    { label: '總項目',     value: s.total_items,          bg: '#F3F4F6', text: '#374151' },
    { label: '可移除',     value: s.removable_count,       bg: '#DCFCE7', text: '#16A34A' },
    { label: '低風險',     value: s.very_low_risk_count,   bg: '#DBEAFE', text: '#2563EB' },
    { label: 'Repair',     value: s.repair_item_count,     bg: '#F3E8FF', text: '#9333EA' },
    { label: 'Yield Loss', value: s.has_loss_count,        bg: '#FEE2E2', text: '#DC2626' }
  ];

  const summaryRows = [
    ['從未失效',     s.never_occurred_count,  'never_occurred'],
    ['低風險可移除', s.very_low_risk_count,   'very_low_risk'],
    ['建議觀察',     s.low_risk_count,        'low_risk'],
    ['Repair 保護',  s.repair_item_count,     'repair_item'],
    ['有 Yield Loss',s.has_loss_count,        'has_loss'],
  ];

  return `
    <!-- 迷你 KPI -->
    <div class="grid grid-cols-3 md:grid-cols-5 gap-3 mb-6">
      ${miniKpis.map(k => `
        <div class="mini-kpi" style="background:${k.bg}">
          <div class="mini-kpi__value" style="color:${k.text}">${k.value}</div>
          <div class="mini-kpi__label" style="color:${k.text}">${k.label}</div>
        </div>`).join('')}
    </div>

    <!-- 圖表 + 摘要 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div class="bg-gray-50 rounded-xl p-4">
        <h4 class="text-xs font-semibold text-gray-500 mb-3 text-center uppercase tracking-wide">狀態分佈</h4>
        <div class="chart-container">
          <canvas id="chart-${eid}"></canvas>
        </div>
      </div>
      <div class="bg-gray-50 rounded-xl p-4">
        <h4 class="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">站點摘要 — ${_esc(name)}</h4>
        <table class="w-full text-sm">
          <tbody>
            ${summaryRows.map(([label, count, status]) => `
              <tr>
                <td class="py-1 pr-4">
                  <span class="status-badge status-badge--${status}">${label}</span>
                </td>
                <td class="py-1 text-right font-bold text-gray-700">${count}</td>
              </tr>`).join('')}
            <tr style="border-top:1px solid #E5E7EB">
              <td class="pt-2 pr-4 text-xs text-gray-500">可節省時間</td>
              <td class="pt-2 text-right font-bold text-blue-600">${timeStr}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 可移除項甲0表 -->
    <div id="top10-station-section" style="margin-bottom:20px"></div>

    <!-- 可移除項目表 -->
    <div class="data-table-wrapper">
      <div class="data-table-header" style="background:#15803D">
        <h4>✂ 可移除項目 (${stData.removable.length})</h4>
        <input class="data-table-filter" placeholder="🔍 搜尋..."
               oninput="RENDERER.filterTable('tbl-rm-${eid}', this.value)">
      </div>
      <div id="tbl-rm-${eid}"></div>
    </div>

    <!-- Repair 保護項表 -->
    <div class="data-table-wrapper">
      <div class="data-table-header" style="background:#7E22CE">
        <h4>🔧 Repair 保護項 (${stData.repair_items.length})</h4>
        <input class="data-table-filter" placeholder="🔍 搜尋..."
               oninput="RENDERER.filterTable('tbl-rp-${eid}', this.value)">
      </div>
      <div id="tbl-rp-${eid}"></div>
    </div>

    <!-- 不建議移除表 -->
    <div class="data-table-wrapper">
      <div class="data-table-header" style="background:#B91C1C">
        <h4>⛔ 不建議移除 (${stData.not_removable.length})</h4>
        <input class="data-table-filter" placeholder="🔍 搜尋..."
               oninput="RENDERER.filterTable('tbl-nr-${eid}', this.value)">
      </div>
      <div id="tbl-nr-${eid}"></div>
    </div>
  `;
}

// ──────────────────────────────────────────────────────────────
// 環形圖設定
// ──────────────────────────────────────────────────────────────

function _buildDonutConfig(summary) {
  const keys   = ['never_occurred','very_low_risk','low_risk','repair_item','has_loss'];
  const counts = [summary.never_occurred_count, summary.very_low_risk_count,
                  summary.low_risk_count, summary.repair_item_count, summary.has_loss_count];

  // 只顯示非零項
  const labels = [], data = [], colors = [];
  keys.forEach((k, i) => {
    if (counts[i] > 0) {
      labels.push(STATUS_LABELS[k]);
      data.push(counts[i]);
      colors.push(STATUS_CHART_COLORS[k]);
    }
  });

  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
      },
      cutout: '60%'
    }
  };
}

// ──────────────────────────────────────────────────────────────
// 表格欄位定義
// ──────────────────────────────────────────────────────────────

function _colsRemovable() {
  return [
    { key: 'test_no',           label: 'Step',         cls: 'col-step' },
    { key: 'test_item',         label: 'Test Item',     cls: 'col-item' },
    { key: 'cat_ids',           label: 'CAT IDs',       cls: 'col-cats',   fmt: v => v.join(', ') },
    { key: 'worst_cat_avg_ppm', label: 'Avg PPM',       cls: 'col-num',    fmt: v => v.toFixed(2) },
    { key: 'worst_cat_max_ppm', label: 'Max PPM',       cls: 'col-num',    fmt: v => v.toFixed(2) },
    { key: 'status',            label: '狀態',           cls: 'col-status', fmt: v => _statusBadge(v) },
    { key: 'saved_time_sec',    label: '估計節省(s)',    cls: 'col-time',   fmt: v => v.toFixed(4) }
  ];
}

function _colsRepair() {
  return [
    { key: 'test_no',   label: 'Step',     cls: 'col-step' },
    { key: 'test_item', label: 'Test Item', cls: 'col-item' },
    { key: 'cat_ids',   label: 'CAT IDs',  cls: 'col-cats', fmt: v => v.join(', ') },
    { key: 'status',    label: '狀態',      cls: 'col-status', fmt: v => _statusBadge(v) }
  ];
}

function _colsNotRemovable() {
  return [
    { key: 'test_no',           label: 'Step',     cls: 'col-step' },
    { key: 'test_item',         label: 'Test Item', cls: 'col-item' },
    { key: 'cat_ids',           label: 'CAT IDs',  cls: 'col-cats', fmt: v => v.join(', ') },
    { key: 'worst_cat_avg_ppm', label: 'Avg PPM',  cls: 'col-num',  fmt: v => v.toFixed(2) },
    { key: 'worst_cat_max_ppm', label: 'Max PPM',  cls: 'col-num',  fmt: v => v.toFixed(2) },
    { key: 'status',            label: '狀態',      cls: 'col-status', fmt: v => _statusBadge(v) }
  ];
}

function _statusBadge(v) {
  return `<span class="status-badge status-badge--${v}">${STATUS_LABELS[v] || v}</span>`;
}

// ──────────────────────────────────────────────────────────────
// 表格建立
// ──────────────────────────────────────────────────────────────

function _buildTable(containerId, items, cols) {
  _tableState[containerId] = {
    allItems:      items,
    filteredItems: [...items],
    cols,
    sortCol: null,
    sortDir: 'asc'
  };
  _renderTableInto(containerId);
}

function _renderTableInto(containerId) {
  const state = _tableState[containerId];
  if (!state) return;
  const container = document.getElementById(containerId);
  if (!container) return;

  const { filteredItems, cols, sortCol, sortDir } = state;

  if (!filteredItems.length) {
    container.innerHTML = '<div class="empty-state">— 無資料 —</div>';
    return;
  }

  const headerHTML = `<thead><tr>${cols.map(c => {
    const isSorted = sortCol === c.key;
    const cls      = isSorted ? (sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    const icon     = isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
    return `<th class="${c.cls || ''} ${cls}"
                onclick="RENDERER.sortTable('${containerId}','${c.key}')">
      ${c.label}<i class="sort-icon">${icon}</i>
    </th>`;
  }).join('')}</tr></thead>`;

  const VIRTUAL_THRESHOLD = 500;

  if (filteredItems.length <= VIRTUAL_THRESHOLD) {
    // 一般渲染
    const bodyHTML = `<tbody>${filteredItems.map(item => _buildRowHTML(item, cols)).join('')}</tbody>`;
    container.innerHTML = `
      <div class="virtual-scroll-outer">
        <table class="data-table">${headerHTML}${bodyHTML}</table>
      </div>`;
  } else {
    // 虛擬捲動（500+ 列）
    const ROW_H   = 40;
    const BUFFER  = 20;
    const initEnd = Math.min(BUFFER * 2, filteredItems.length);
    const botH    = Math.max(0, (filteredItems.length - initEnd) * ROW_H);
    const wrapId  = `vs-${containerId}`;

    container.innerHTML = `
      <div class="virtual-scroll-outer" id="${wrapId}"
           onscroll="RENDERER.onVScroll('${containerId}', this)">
        <table class="data-table">
          ${headerHTML}
          <tbody id="${wrapId}-body">
            <tr id="${wrapId}-top" style="height:0px"></tr>
            ${_buildVRows(filteredItems, 0, initEnd, cols)}
            <tr id="${wrapId}-bot" style="height:${botH}px"></tr>
          </tbody>
        </table>
      </div>`;

    const wrapEl = document.getElementById(wrapId);
    if (wrapEl) {
      wrapEl._vsState = { start: 0, end: initEnd, rowH: ROW_H, buffer: BUFFER };
    }
  }
}

function _buildVRows(items, start, end, cols) {
  return items.slice(start, end).map(item => _buildRowHTML(item, cols)).join('');
}

function _buildRowHTML(item, cols) {
  return `<tr>${cols.map(c => {
    const raw     = item[c.key];
    const display = c.fmt ? c.fmt(raw) : (raw != null ? _esc(String(raw)) : '');
    return `<td class="${c.cls || ''}">${display}</td>`;
  }).join('')}</tr>`;
}

// ── 虛擬捲動回呼 ───────────────────────────────────────────────

function onVScroll(containerId, wrapper) {
  const state = _tableState[containerId];
  if (!state) return;
  const vs = wrapper._vsState;
  if (!vs)   return;

  const { rowH, buffer } = vs;
  const scrollTop = wrapper.scrollTop;
  const visH      = wrapper.clientHeight;
  const newStart  = Math.max(0, Math.floor(scrollTop / rowH) - buffer);
  const newEnd    = Math.min(state.filteredItems.length, Math.ceil((scrollTop + visH) / rowH) + buffer);

  if (newStart === vs.start && newEnd === vs.end) return;
  vs.start = newStart;
  vs.end   = newEnd;

  const wrapId = `vs-${containerId}`;
  const topEl  = document.getElementById(`${wrapId}-top`);
  const botEl  = document.getElementById(`${wrapId}-bot`);
  if (!topEl || !botEl) return;

  const totalH = state.filteredItems.length * rowH;
  topEl.style.height = `${newStart * rowH}px`;
  botEl.style.height = `${Math.max(0, totalH - newEnd * rowH)}px`;

  // 移除舊的資料列（保留 spacer）
  let node = topEl.nextSibling;
  while (node && node !== botEl) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }

  // 插入新的可視列
  topEl.insertAdjacentHTML('afterend', _buildVRows(state.filteredItems, newStart, newEnd, state.cols));
}

// ── 排序 ───────────────────────────────────────────────────────

function sortTable(containerId, colKey) {
  const state = _tableState[containerId];
  if (!state) return;

  if (state.sortCol === colKey) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortCol = colKey;
    state.sortDir = 'asc';
  }

  state.filteredItems.sort((a, b) => {
    let av = a[colKey];
    let bv = b[colKey];
    if (Array.isArray(av)) av = av.join(',');
    if (Array.isArray(bv)) bv = bv.join(',');
    if (typeof av === 'number' && typeof bv === 'number') {
      return state.sortDir === 'asc' ? av - bv : bv - av;
    }
    return state.sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  _renderTableInto(containerId);
}

// ── 過濾 ───────────────────────────────────────────────────────

function filterTable(containerId, text) {
  const state = _tableState[containerId];
  if (!state) return;

  const q = text.toLowerCase();
  state.filteredItems = q
    ? state.allItems.filter(item =>
        state.cols.some(c => {
          const v = item[c.key];
          return String(Array.isArray(v) ? v.join(',') : (v ?? '')).toLowerCase().includes(q);
        })
      )
    : [...state.allItems];

  state.sortCol = null;
  state.sortDir = 'asc';
  _renderTableInto(containerId);
}

// ── 清除圖表 ───────────────────────────────────────────────────

function destroyAllCharts() {
  for (const [k, chart] of Object.entries(_charts)) {
    chart.destroy();
    delete _charts[k];
  }
}

// ──────────────────────────────────────────────────────────────
// 工具函式
// ──────────────────────────────────────────────────────────────

/** 將站點名稱轉為合法 HTML element id（移除非法字元） */
function _eid(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** HTML 跳脫 */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JS 字串跳脫（用在 onclick 屬性內） */
function _escJs(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ──────────────────────────────────────────────────────────────
// 公開命名空間
// ──────────────────────────────────────────────────────────────

const RENDERER = {
  switchStation,
  filterTable,
  sortTable,
  onVScroll,
  destroyAllCharts
};
