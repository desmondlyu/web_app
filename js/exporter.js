// ================================================================
// exporter.js — Excel 匯出模組（SheetJS）
// ================================================================

/**
 * 匯出 TTO 分析報告為 Excel
 * @param {Object}      result  - crossAnalyze 的輸出
 * @param {Object|null} rawData - parseRawdata 的輸出（可選）
 */
function exportToExcel(result, rawData) {
  const wb      = XLSX.utils.book_new();
  const product = result.product || 'UNKNOWN';

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dtStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

  // ── 工作表 1：KPI_總覽 ─────────────────────────────────────
  const kpiRows = [[
    '站點', '總項目', '可移除', '從未失效', '低風險可移除', '建議觀察', 'Repair保護', 'Yield Loss', '可節省時間(s)'
  ]];
  for (const [stName, st] of Object.entries(result.stations)) {
    const s = st.summary;
    kpiRows.push([
      stName, s.total_items, s.removable_count, s.never_occurred_count,
      s.very_low_risk_count, s.low_risk_count, s.repair_item_count, s.has_loss_count,
      Number(s.total_removable_time_sec.toFixed(4))
    ]);
  }
  // 合計列
  if (kpiRows.length > 1) {
    const data   = kpiRows.slice(1);
    const totals = [1, 2, 3, 4, 5, 6, 7].map(ci => data.reduce((s, r) => s + (Number(r[ci]) || 0), 0));
    const timeTotal = data.reduce((s, r) => s + (Number(r[8]) || 0), 0);
    kpiRows.push(['合計', ...totals, Number(timeTotal.toFixed(4))]);
  }
  _appendSheet(wb, kpiRows, 'KPI_總覽');

  // ── 工作表 2：CP_可移除 ────────────────────────────────────
  const rmRows = [['站點', 'Step', 'Test Item', 'CAT IDs', 'Avg PPM', 'Max PPM', '狀態', '估計節省(s)']];
  for (const [stName, st] of Object.entries(result.stations)) {
    for (const item of st.removable) {
      rmRows.push([
        stName, item.test_no, item.test_item, item.cat_ids.join(','),
        Number(item.worst_cat_avg_ppm.toFixed(4)),
        Number(item.worst_cat_max_ppm.toFixed(4)),
        STATUS_LABELS[item.status] || item.status,
        Number(item.saved_time_sec.toFixed(4))
      ]);
    }
  }
  _appendSheet(wb, rmRows, 'CP_可移除');

  // ── 工作表 3：CP_不建議移除 ───────────────────────────────
  const nrRows = [['站點', 'Step', 'Test Item', 'CAT IDs', 'Avg PPM', 'Max PPM', '狀態']];
  for (const [stName, st] of Object.entries(result.stations)) {
    for (const item of st.not_removable) {
      nrRows.push([
        stName, item.test_no, item.test_item, item.cat_ids.join(','),
        Number(item.worst_cat_avg_ppm.toFixed(4)),
        Number(item.worst_cat_max_ppm.toFixed(4)),
        STATUS_LABELS[item.status] || item.status
      ]);
    }
  }
  _appendSheet(wb, nrRows, 'CP_不建議移除');

  // ── 工作表 4：CP_Repair保護 ───────────────────────────────
  const rpRows = [['站點', 'Step', 'Test Item', 'CAT IDs', '狀態']];
  for (const [stName, st] of Object.entries(result.stations)) {
    for (const item of st.repair_items) {
      rpRows.push([stName, item.test_no, item.test_item, item.cat_ids.join(','), 'Repair 保護項']);
    }
  }
  _appendSheet(wb, rpRows, 'CP_Repair保護');

  // ── 工作表 5：Top10_最耗時項目 ─────────────────────────────
  // 使用 rawData（與 Web 儀表板同邏輯）
  const top10Rows = [['排名', '站點', 'Test Item', '執行次數', '總時間(s)', '占比(%)']];
  
  if (rawData && rawData.stations && Object.keys(rawData.stations).length > 0) {
    for (const [stName, stRawData] of Object.entries(rawData.stations)) {
      const rows = [];
      let stationTotalTime = 0;
      const processedObjects = new Set(); // 防止重複計算同一物件
      
      // 收集該站點的所有項目
      for (const item of Object.values(stRawData.items || {})) {
        if (!processedObjects.has(item) && item.time_sec > 0) {
          rows.push({
            item_name:  item.item_name,
            exec_count: item.exec_count || 0,
            time_sec:   item.time_sec
          });
          stationTotalTime += item.time_sec;
          processedObjects.add(item);
        }
      }
      
      // 按執行時間降序排列，取前 10
      if (rows.length > 0) {
        rows.sort((a, b) => b.time_sec - a.time_sec);
        const top10 = rows.slice(0, 10);
        
        top10.forEach((item, idx) => {
          const percentage = stationTotalTime > 0 
            ? (item.time_sec / stationTotalTime * 100).toFixed(2) 
            : '0.00';
          top10Rows.push([
            idx + 1,
            stName,
            item.item_name,
            item.exec_count,
            Number(item.time_sec.toFixed(4)),
            Number(percentage)
          ]);
        });
      }
    }
  }
  
  _appendSheet(wb, top10Rows, 'Top10_最耗時項目');

  XLSX.writeFile(wb, `TTO_Report_${product}_${dtStr}.xlsx`);
}

/**
 * 建立工作表並加入工作簿（含欄寬設定）
 */
function _appendSheet(wb, rows, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 設定欄寬（根據最長內容自動計算）
  if (rows.length > 0) {
    ws['!cols'] = rows[0].map((_, ci) => {
      const maxLen = rows.reduce((m, r) => {
        const cell = r[ci];
        return Math.max(m, cell != null ? String(cell).length : 0);
      }, 0);
      return { wch: Math.min(Math.max(maxLen + 2, 8), 45) };
    });
  }

  // 嘗試套用標題列樣式（SheetJS Pro 支援；Community Edition 下靜默略過）
  try {
    const hdrStyle = {
      font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill:      { fgColor: { rgb: '2563EB' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' }
    };
    const altStyle = {
      fill:      { fgColor: { rgb: 'EFF6FF' }, patternType: 'solid' },
      alignment: { vertical: 'center' }
    };

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    // 標題列
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (ws[addr]) ws[addr].s = hdrStyle;
    }

    // 交替列背景
    for (let R = 2; R <= range.e.r; R += 2) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr]) ws[addr].s = altStyle;
      }
    }
  } catch (_) { /* 社群版不支援樣式，靜默略過 */ }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}
