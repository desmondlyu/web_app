// ================================================================
// parsers.js — 檔案解析模組
// ================================================================

/** 固定欄位（不是 CAT 代碼，略過） */
const SKIP_COLS = [
  // ── 基本識別欄位 ──
  'Cnt.', 'Lot No', 'Wafer', 'Process', 'Layer',
  // ── 時間欄位 ──
  'Test Start Time', 'Test End Time', 'Period',
  // ── 產品/設備資訊 ──
  'Product', 'Tester', 'Probe Card', 'T7Code', 'Program',
  'Loop', 'Sub. Ver.',
  // ── Flag 欄位 ──
  'Partial', 'EFSuspend', 'EFuse', 'RetestFail', 'Merge',
  'Prober Setup File',
  // ── 溫度、良率統計 ──
  'Temper.', 'O.D.',
  'Die Cnt.', 'Net', 'Pr. Yld.',
  'Sk. Cnt.', 'Sk. Net', 'Sk. Yld.',
  'Wf. Yld.', 'Pr. Ya', 'Pr. Ydc',
  // ── BIN 分類 ──
  'BIN1', 'BIN2', 'BIN3', 'BIN4', 'BIN5'
];

/** PASS 類別（不算 Fail CAT） */
const PASS_CATS = ['01','02','03','04','05','07'];

/** 程式碼關鍵字（test_item 若以此開頭則跳過） */
const CODE_KEYWORDS = ['if ','for ','while ','def ','class ','return ','import '];

// ──────────────────────────────────────────────────────────────
// 解析 CP Summary Excel
// ──────────────────────────────────────────────────────────────

/**
 * 解析 CP Summary Excel 檔案
 * 支援：
 *   - 舊格式：多個工作表，每個 Sheet = 一個站點
 *   - 新格式：單一工作表，Process 欄區分站點
 * @param {File} file
 * @returns {Promise<{stations: Object, product: string}>}
 *   stations[stationName].cat_stats[catCode] = { avg_ppm, max_ppm, never_occurred }
 */
async function parseCPSummary(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const stations = {};
  let product = 'UNKNOWN';

  // 檢查是否為新格式（單頁 + Process 欄）
  const isNewFormat = _detectNewCPFormat(wb);

  if (isNewFormat) {
    // 新格式：單一工作表，按 Process 分組
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) return { stations, product };

    const header = rows[0].map(h => (h != null ? String(h).trim() : ''));
    const lotNoIdx = header.indexOf('Lot No');
    const processIdx = header.indexOf('Process');
    const wfYldIdx = header.indexOf('Wf. Yld.');
    const productIdx = header.indexOf('Product');

    if (lotNoIdx === -1 || processIdx === -1) {
      console.warn('[CP Parser] New format missing required columns');
      return { stations, product };
    }

    // 識別 Fail CAT 欄位（在 Wf. Yld. 之後）
    const catCols = [];
    const startIdx = wfYldIdx !== -1 ? wfYldIdx + 1 : header.findIndex((h, i) => i > lotNoIdx && h && !SKIP_COLS.includes(h));
    for (let i = startIdx; i < header.length; i++) {
      const n = header[i];
      if (!n) continue;
      if (SKIP_COLS.includes(n)) continue;
      if (PASS_CATS.includes(n)) continue;
      catCols.push({ idx: i, name: n });
    }

    // 按 Process 分組資料
    const stationData = {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const lotVal = row[lotNoIdx];
      if (lotVal == null || String(lotVal).trim() === '') continue;

      const processVal = row[processIdx];
      if (processVal == null) continue;
      const station = String(processVal).trim();
      if (!station) continue;

      if (!stationData[station]) {
        stationData[station] = {};
      }

      // 嘗試取得 product 名稱
      if (product === 'UNKNOWN' && productIdx !== -1 && row[productIdx] != null) {
        product = String(row[productIdx]).trim();
      }

      // 累積 CAT 值
      for (const { idx, name } of catCols) {
        if (!stationData[station][name]) {
          stationData[station][name] = [];
        }
        const raw = row[idx];
        const v = (raw == null || raw === '') ? 0 : parseFloat(raw);
        stationData[station][name].push(isNaN(v) ? 0 : v);
      }
    }

    // 計算每個站點的統計值
    for (const [station, catValues] of Object.entries(stationData)) {
      const cat_stats = {};
      for (const [catName, vals] of Object.entries(catValues)) {
        if (!vals.length) {
          cat_stats[catName] = { avg_ppm: 0, max_ppm: 0, never_occurred: true };
          continue;
        }
        const ppms = vals.map(v => v * 10000);
        cat_stats[catName] = {
          avg_ppm: ppms.reduce((a, b) => a + b, 0) / ppms.length,
          max_ppm: Math.max(...ppms),
          never_occurred: ppms.every(v => v === 0)
        };
      }
      stations[station] = { cat_stats };
    }
  } else {
    // 舊格式：多個工作表，每個 Sheet = 一個站點
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (rows.length < 2) continue;

      const header = rows[0].map(h => (h != null ? String(h).trim() : ''));
      const lotNoIdx = header.indexOf('Lot No');
      if (lotNoIdx === -1) continue;

      const productIdx = header.indexOf('Product');

      // 識別 Fail CAT 欄位（排除固定欄位和 PASS cats）
      const catCols = [];
      for (let i = 0; i < header.length; i++) {
        const n = header[i];
        if (!n) continue;
        if (SKIP_COLS.includes(n)) continue;
        if (PASS_CATS.includes(n)) continue;
        catCols.push({ idx: i, name: n });
      }

      const catValues = {};
      catCols.forEach(({ name }) => {
        catValues[name] = [];
      });

      // 逐列解析（跳過 Lot No 為空的列：平均/摘要列）
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        const lotVal = row[lotNoIdx];
        if (lotVal == null || String(lotVal).trim() === '') continue;

        // 嘗試取得 product 名稱（取第一筆非空值）
        if (product === 'UNKNOWN' && productIdx !== -1 && row[productIdx] != null) {
          product = String(row[productIdx]).trim();
        }

        for (const { idx, name } of catCols) {
          const raw = row[idx];
          const v = (raw == null || raw === '') ? 0 : parseFloat(raw);
          catValues[name].push(isNaN(v) ? 0 : v);
        }
      }

      // 計算每個 CAT 的統計值（PPM = value × 10000）
      const cat_stats = {};
      for (const { name } of catCols) {
        const vals = catValues[name];
        if (!vals.length) {
          cat_stats[name] = { avg_ppm: 0, max_ppm: 0, never_occurred: true };
          continue;
        }
        const ppms = vals.map(v => v * 10000);
        cat_stats[name] = {
          avg_ppm: ppms.reduce((a, b) => a + b, 0) / ppms.length,
          max_ppm: Math.max(...ppms),
          never_occurred: ppms.every(v => v === 0)
        };
      }

      stations[sheetName] = { cat_stats };
    }
  }

  return { stations, product };
}

/**
 * 檢測是否為新格式 CP Summary
 * 新格式特徵：
 *   1. 只有一個工作表
 *   2. 工作表中有 Process 欄（用來識別站點）
 *   3. 有 Wf. Yld. 欄（良率欄）
 */
function _detectNewCPFormat(wb) {
  if (wb.SheetNames.length !== 1) {
    return false; // 多個工作表 = 舊格式
  }

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (rows.length < 1) return false;

  const header = rows[0].map(h => (h != null ? String(h).trim() : ''));
  const hasProcess = header.includes('Process');
  const hasWfYld = header.includes('Wf. Yld.');

  return hasProcess && hasWfYld;
}

// ──────────────────────────────────────────────────────────────
// 解析 MSS Excel
// ──────────────────────────────────────────────────────────────

/**
 * 解析 MSS Excel 檔案
 * @param {File} file
 * @returns {Promise<{stations: Object}>}
 *   stations[stationName] = [{ test_no, test_item, cat_ids, is_repair }]
 */
async function parseMSS(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const stations = {};

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Temp') continue;

    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) continue;

    const items = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 5) continue;

      const rawNo   = row[0];  // 欄位 0：test_no
      const rawItem = row[1];  // 欄位 1：test_item
      const rawCat  = row[4];  // 欄位 4：cat_ids（逗號分隔）

      // test_no 需為正整數
      const n = Number(rawNo);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) continue;

      // test_item 驗證
      if (rawItem == null) continue;
      const itemStr = String(rawItem).trim();
      if (!itemStr) continue;
      if (itemStr === '{' || itemStr === '}') continue;
      const itemLow = itemStr.toLowerCase();
      let isCode = false;
      for (const kw of CODE_KEYWORDS) {
        if (itemLow.startsWith(kw.toLowerCase())) { isCode = true; break; }
      }
      if (isCode) continue;

      // cat_ids 不可為空或 "9"
      if (rawCat == null) continue;
      const catStr = String(rawCat).trim();
      if (!catStr || catStr === '9') continue;
      const catIds = catStr.split(',').map(c => c.trim()).filter(Boolean);
      if (!catIds.length) continue;

      items.push({
        test_no:   n,
        test_item: itemStr,
        cat_ids:   catIds,
        is_repair: itemLow.includes('repair')
      });
    }

    if (items.length) stations[sheetName] = items;
  }

  return { stations };
}

// ──────────────────────────────────────────────────────────────
// 解析 Rawdata TXT 檔案
// ──────────────────────────────────────────────────────────────

/**
 * 解析多個 Rawdata TXT 檔案
 * @param {FileList|Array} files
 * @returns {Promise<{stations: Object, product: string}>}
 *   stations[stationName].items[key] = { test_no, item_name, time_sec, avg_time_sec, pass_count, fail_count, exec_count }
 */
async function parseRawdata(files) {
  const stations = {};
  let product    = 'UNKNOWN';

  // Regex：測試項目標頭（24+ 斜線）
  const HDR_RE  = /^\/{24,}\s+(\d+),\s*([\w_]+)\s+\/{24,}/;
  // Regex：測試時間列
  const TIME_RE = /<<<\s*Test\s+Time\s*>>>,\s*(\d+),\s*([\w_]+),\s*([\d.]+)\s*,\s*\(S\)/;

  for (const file of files) {
    // 從檔名解析 PRODUCT 和 STATION
    const base  = file.name.replace(/\.[^.]+$/, '');
    const parts = base.split('_');
    const station = (parts[1] || 'UNKNOWN').toUpperCase();
    if (product === 'UNKNOWN' && parts[0]) product = parts[0];

    let text;
    try { text = await file.text(); }
    catch (e) { console.warn('無法讀取 rawdata:', file.name, e); continue; }

    const lines  = text.split(/\r?\n/);
    const stItems = {};
    let meta    = { lot_name: null, wafer_name: null, device_name: null };
    let started = false;
    let curNo   = null;
    let curName = null;

    for (const rawLine of lines) {
      const ln = rawLine.trim();

      if (!started) {
        // TEST START!! 之前為 header 區域
        if (ln.includes('TEST START!!')) { started = true; continue; }

        // 解析 header key=value（格式：lot_name = D6518FD2BB02）
        const ei = ln.indexOf('=');
        if (ei > 0) {
          const k = ln.substring(0, ei).trim().toLowerCase().replace(/[\s()\-\/]+/g, '_').replace(/_+$/, '');
          const v = ln.substring(ei + 1).trim().split('\t')[0].trim(); // 去除 tab 後的額外欄位
          if (!v || v.startsWith('0x') && k !== 'lot_name') {
            // 略過純數字/十六進位的非關鍵欄位
          } else if ((k === 'lot_name' || k.includes('lot'))        && !meta.lot_name)    meta.lot_name    = v;
          else if ((k === 'wafer_name' || k.includes('wafer'))      && !meta.wafer_name)  meta.wafer_name  = v;
          else if ((k === 'device_name' || k.includes('device'))    && !meta.device_name) meta.device_name = v.replace(/\s+/g, '');
        }
        continue;
      }

      // 測試項目標頭行
      const hm = ln.match(HDR_RE);
      if (hm) {
        curNo   = parseInt(hm[1]);
        curName = hm[2];
        const key = `${curNo}_${curName}`;
        if (!stItems[key]) {
          stItems[key] = { test_no: curNo, item_name: curName, time_sec: 0, pass_count: 0, fail_count: 0, exec_count: 0 };
        }
        continue;
      }

      // 測試時間列
      const tm = ln.match(TIME_RE);
      if (tm) {
        const no   = parseInt(tm[1]);
        const name = tm[2];
        const sec  = parseFloat(tm[3]);
        const key  = `${no}_${name}`;
        if (!stItems[key]) {
          stItems[key] = { test_no: no, item_name: name, time_sec: 0, pass_count: 0, fail_count: 0, exec_count: 0 };
        }
        stItems[key].time_sec   += sec;
        stItems[key].exec_count += 1;
        continue;
      }

      // PASS / FAIL 列（計算 P/F 字元數）
      if (ln.startsWith('PASS:') && curNo != null) {
        const key = `${curNo}_${curName}`;
        if (stItems[key]) stItems[key].pass_count += (ln.substring(5).match(/P/g) || []).length;
      } else if (ln.startsWith('FAIL:') && curNo != null) {
        const key = `${curNo}_${curName}`;
        if (stItems[key]) stItems[key].fail_count += (ln.substring(5).match(/F/g) || []).length;
      }
    }

    // 合併到 stations（支援同站多檔）
    if (!stations[station]) stations[station] = { items: {}, wafer_count: 0 };
    stations[station].wafer_count++;
    if (meta.device_name && product === 'UNKNOWN') product = meta.device_name;

    for (const [key, item] of Object.entries(stItems)) {
      if (!stations[station].items[key]) {
        stations[station].items[key] = { ...item };
      } else {
        const e = stations[station].items[key];
        e.time_sec   += item.time_sec;
        e.pass_count += item.pass_count;
        e.fail_count += item.fail_count;
        e.exec_count += item.exec_count;
      }
    }
  }

  // 計算每個 item 的平均執行時間（÷ exec_count）
  for (const st of Object.values(stations)) {
    for (const item of Object.values(st.items)) {
      item.avg_time_sec = item.exec_count > 0 ? item.time_sec / item.exec_count : 0;
    }
  }

  return { stations, product };
}

// ──────────────────────────────────────────────────────────────
// 解析 TTLOG Master_Summary Excel
// ──────────────────────────────────────────────────────────────

/**
 * 解析 TTLOG (Master_Summary 分頁) Excel 檔案
 * @param {File} file
 * @returns {Promise<{stations: Object, product: string}>}
 *   stations[stationName].items[key] = { test_no, item_name, time_sec, pass_count, fail_count, exec_count, avg_time_sec }
 */
async function parseTTLOG(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  
  // 尋找 Master_Summary 工作表
  let masterSheet = null;
  let sheetName = null;
  
  for (const name of wb.SheetNames) {
    if (name.toLowerCase().includes('master') || name.toLowerCase().includes('summary')) {
      sheetName = name;
      masterSheet = wb.Sheets[name];
      break;
    }
  }
  
  if (!masterSheet) {
    console.warn('[TTLOG Parser] 找不到 Master_Summary 工作表');
    return { stations: {}, product: 'UNKNOWN' };
  }
  
  const rows = XLSX.utils.sheet_to_json(masterSheet, { header: 1, defval: null });
  if (rows.length < 2) return { stations: {}, product: 'UNKNOWN' };
  
  const header = rows[0].map(h => (h != null ? String(h).trim() : ''));
  const stations = {};
  let product = 'UNKNOWN';
  
  // 識別欄位索引
  const testItemIdx = header.findIndex(h => h.toLowerCase().includes('test_item'));
  const grandTotalTimeIdx = header.findIndex(h => h.toUpperCase().includes('GRAND') && h.toUpperCase().includes('TOTAL') && h.toUpperCase().includes('TIME'));
  
  if (testItemIdx === -1) {
    console.warn('[TTLOG Parser] 找不到 Test_Item 欄位');
    return { stations: {}, product: 'UNKNOWN' };
  }
  
  if (grandTotalTimeIdx === -1) {
    console.warn('[TTLOG Parser] 找不到 Grand_Total_Time 欄位');
    return { stations: {}, product: 'UNKNOWN' };
  }
  
  // 識別所有站點欄位（格式：StationName_Count, StationName_Time）
  const stationPatterns = ['DS00', 'S1P1', 'DS03', 'DS05', 'SFIN', 'SPRE', 'DS07', 'DS08', 'DS09', 'DS04'];
  const stationCols = {}; // station -> { countIdx, timeIdx }
  
  for (const station of stationPatterns) {
    const countIdx = header.findIndex(h => h.toUpperCase().includes(station) && h.toUpperCase().includes('COUNT'));
    const timeIdx = header.findIndex(h => h.toUpperCase().includes(station) && h.toUpperCase().includes('TIME'));
    if (countIdx !== -1 || timeIdx !== -1) {
      stationCols[station] = { countIdx, timeIdx };
    }
  }
  
  if (Object.keys(stationCols).length === 0) {
    console.warn('[TTLOG Parser] 找不到任何站點欄位（Station_Count, Station_Time）');
    return { stations: {}, product: 'UNKNOWN' };
  }
  
  // 解析資料列
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[testItemIdx]) continue;
    
    let testItemName = String(row[testItemIdx]).trim();
    if (!testItemName) continue;
    
    // 移除末尾的 _(M)
    testItemName = testItemName.replace(/_\(M\)$/, '').trim();
    
    // 驗證 Grand_Total_Time
    let grandTotalTime = 0;
    if (grandTotalTimeIdx !== -1 && row[grandTotalTimeIdx] != null) {
      grandTotalTime = parseFloat(row[grandTotalTimeIdx]) || 0;
    }
    
    // Grand_Total_Time 必須大於 0 才視為有效資料列
    if (grandTotalTime <= 0) continue;
    
    // TTLOG 資料結構說明
    // ── 在 crossAnalyze() 中，鍵值匹配會嘗試多種組合，包括 test_item 名稱單獨查詢
    // ── 故此處使用多鍵策略：既儲存 row_index_test_item 組合，也儲存 test_item 單獨鍵值
    const testNo = r; // 行號（作為備用識別，但不用作主要匹配鍵值）
    
    // 迴圈處理每個站點，提取各站點的時間
    for (const [station, colIndices] of Object.entries(stationCols)) {
      const { countIdx, timeIdx } = colIndices;
      
      let execCount = 0;
      let timeSec = 0;
      
      if (countIdx !== -1 && row[countIdx] != null) {
        execCount = parseInt(row[countIdx]) || 0;
      }
      if (timeIdx !== -1 && row[timeIdx] != null) {
        timeSec = parseFloat(row[timeIdx]) || 0;
      }
      
      // 只要有時間數據或執行次數就記錄此 item
      if (execCount > 0 || timeSec > 0) {
        if (!stations[station]) {
          stations[station] = { items: {}, wafer_count: 1 };
        }
        
        // 多鍵策略：既用 testNo_testItemName，也用 testItemName 單獨鍵值
        // 這樣 crossAnalyze() 中多種鍵值查詢都能找到數據
        const primaryKey = `${testNo}_${testItemName}`;
        const secondaryKey = testItemName;
        
        const itemData = {
          test_no: testNo,
          item_name: testItemName,
          time_sec: timeSec,
          pass_count: 0,
          fail_count: 0,
          exec_count: execCount,
          avg_time_sec: execCount > 0 ? timeSec / execCount : 0,
          grand_total_time: grandTotalTime
        };
        
        // 先更新或建立主鍵值
        if (!stations[station].items[primaryKey]) {
          stations[station].items[primaryKey] = { ...itemData };
        } else {
          // 若多次出現，進行加總
          const item = stations[station].items[primaryKey];
          item.time_sec += timeSec;
          item.exec_count += execCount;
          item.avg_time_sec = item.exec_count > 0 ? item.time_sec / item.exec_count : 0;
        }
        
        // 再更新或建立副鍵值（指向主鍵值的資料，保持同步）
        stations[station].items[secondaryKey] = stations[station].items[primaryKey];
      }
    }
  }
  
  // 從檔名取得 product
  const base = file.name.replace(/\.[^.]+$/, '');
  const parts = base.split('_');
  if (parts[0]) product = parts[0];
  
  return { stations, product, source: 'TTLOG' };
}
