// ================================================================
// parsers.js — 檔案解析模組
// ================================================================

/** 固定欄位（不是 CAT 代碼，略過） */
const SKIP_COLS = [
  'Lot No','Wafer','Process','Test Start Time','Product','Program',
  'Loop','Sub. Ver.','Temper.','Sk. Yld.','Wf. Yld.','Pr. Ya','Pr. Ydc',
  'BIN1','BIN2','BIN3','BIN4','BIN5'
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
 * @param {File} file
 * @returns {Promise<{stations: Object, product: string}>}
 *   stations[stationName].cat_stats[catCode] = { avg_ppm, max_ppm, never_occurred }
 */
async function parseCPSummary(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const stations = {};
  let product = 'UNKNOWN';

  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) continue;

    const header   = rows[0].map(h => (h != null ? String(h).trim() : ''));
    const lotNoIdx = header.indexOf('Lot No');
    if (lotNoIdx === -1) continue;

    const productIdx = header.indexOf('Product');

    // 識別 Fail CAT 欄位（排除固定欄位和 PASS cats）
    const catCols = [];
    for (let i = 0; i < header.length; i++) {
      const n = header[i];
      if (!n)                   continue;
      if (SKIP_COLS.includes(n)) continue;
      if (PASS_CATS.includes(n)) continue;
      catCols.push({ idx: i, name: n });
    }

    const catValues = {};
    catCols.forEach(({ name }) => { catValues[name] = []; });

    // 逐列解析（跳過 Lot No 為空的列：平均/摘要列）
    for (let r = 1; r < rows.length; r++) {
      const row    = rows[r];
      if (!row) continue;
      const lotVal = row[lotNoIdx];
      if (lotVal == null || String(lotVal).trim() === '') continue;

      // 嘗試取得 product 名稱（取第一筆非空值）
      if (product === 'UNKNOWN' && productIdx !== -1 && row[productIdx] != null) {
        product = String(row[productIdx]).trim();
      }

      for (const { idx, name } of catCols) {
        const raw = row[idx];
        const v   = (raw == null || raw === '') ? 0 : parseFloat(raw);
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
        avg_ppm:       ppms.reduce((a, b) => a + b, 0) / ppms.length,
        max_ppm:       Math.max(...ppms),
        never_occurred: ppms.every(v => v === 0)
      };
    }

    stations[sheetName] = { cat_stats };
  }

  return { stations, product };
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
