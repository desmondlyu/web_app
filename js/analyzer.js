// ================================================================
// analyzer.js — 交叉分析模組
// ================================================================

/**
 * 分類單一測試項目
 * @param {string[]} catIds     - 該 test item 對應的 CAT ID 列表
 * @param {Object}   catStats   - CP Summary 的統計資料 { "0H": { avg_ppm, max_ppm, never_occurred } }
 * @param {boolean}  isRepair   - 是否為 repair 項目
 * @param {number}   thrVeryLow - 極低風險閾值（ppm，預設 50）
 * @param {number}   thrLow     - 低風險閾值（ppm，預設 500）
 * @returns {{ worst_avg: number, worst_max: number, status: string }}
 */
function classify(catIds, catStats, isRepair, thrVeryLow = 50, thrLow = 500) {
  let worstAvg = 0;
  let worstMax = 0;
  let allNever = true;  // 假設所有 cat 都從未發生

  for (const cat of catIds) {
    if (!catStats[cat]) continue; // 若 CP Summary 無此 CAT，視為從未發生
    const s = catStats[cat];
    if (s.avg_ppm > worstAvg) worstAvg = s.avg_ppm;
    if (s.max_ppm > worstMax) worstMax = s.max_ppm;
    if (!s.never_occurred) allNever = false;
  }

  // 優先順序判斷
  if (isRepair)                        return { worst_avg: worstAvg, worst_max: worstMax, status: 'repair_item' };
  if (allNever && worstAvg === 0)      return { worst_avg: worstAvg, worst_max: worstMax, status: 'never_occurred' };
  if (worstAvg < thrVeryLow)           return { worst_avg: worstAvg, worst_max: worstMax, status: 'very_low_risk' };
  if (worstAvg < thrLow)               return { worst_avg: worstAvg, worst_max: worstMax, status: 'low_risk' };
  return                                      { worst_avg: worstAvg, worst_max: worstMax, status: 'has_loss' };
}

/**
 * 執行交叉分析（CP Summary × MSS × Rawdata）
 * @param {Object}      cpData     - parseCPSummary 的輸出
 * @param {Object}      mssData    - parseMSS 的輸出
 * @param {Object|null} rawData    - parseRawdata 的輸出（可選）
 * @param {Object}      thresholds - { thr_very_low, thr_low }
 * @param {string}      product    - 產品名稱
 * @returns {Object} 完整分析結果（與 cp_yield_dashboard.json 格式相容）
 */
function crossAnalyze(cpData, mssData, rawData, thresholds, product) {
  const tv = thresholds.thr_very_low != null ? thresholds.thr_very_low : 50;
  const tl = thresholds.thr_low      != null ? thresholds.thr_low      : 500;

  // 收集所有站點名稱（大小寫不敏感 union）
  const stationMap = new Map(); // UPPERCASE → display name
  for (const name of Object.keys(cpData.stations  || {})) stationMap.set(name.toUpperCase(), name);
  for (const name of Object.keys(mssData.stations || {})) {
    if (!stationMap.has(name.toUpperCase())) stationMap.set(name.toUpperCase(), name);
  }

  const result = {
    product:         product || 'UNKNOWN',
    generated_at:    new Date().toISOString(),
    ppm_thresholds:  { never_occurred: 0, very_low_risk: tv, low_risk: tl },
    stations:        {}
  };

  for (const [normName, displayName] of stationMap) {

    // 找對應 CP cat_stats（case-insensitive）
    let catStats = {};
    for (const [k, v] of Object.entries(cpData.stations || {})) {
      if (k.toUpperCase() === normName) { catStats = v.cat_stats; break; }
    }

    // 找對應 MSS items（case-insensitive）
    let mssItems = [];
    for (const [k, v] of Object.entries(mssData.stations || {})) {
      if (k.toUpperCase() === normName) { mssItems = v; break; }
    }

    // 找對應 rawdata station（case-insensitive）
    let rawStation = null;
    if (rawData && rawData.stations) {
      for (const [k, v] of Object.entries(rawData.stations)) {
        if (k.toUpperCase() === normName) { rawStation = v; break; }
      }
    }

    const removable     = [];
    const repair_items  = [];
    const not_removable = [];

    for (const item of mssItems) {
      const { test_no, test_item, cat_ids, is_repair } = item;
      const cls = classify(cat_ids, catStats, is_repair, tv, tl);

      // 從 rawdata 查詢此 test item 的平均執行時間
      // MSS 的 test_item 可能有 "- " 前綴（例 "- Opens_PPS"），rawdata 無此前綴
      let saved_time_sec = 0;
      if (rawStation) {
        const key1 = `${test_no}_${test_item}`;
        const key2 = `${test_no}_${test_item.replace(/^[-\s]+/, '')}`; // 去除前綴 "- "
        const hit  = rawStation.items[key1] || rawStation.items[key2];
        if (hit) saved_time_sec = hit.avg_time_sec || 0;
      }

      const out = {
        test_no,
        test_item,
        cat_ids,
        is_repair,
        worst_cat_avg_ppm: cls.worst_avg,
        worst_cat_max_ppm: cls.worst_max,
        status:            cls.status,
        saved_time_sec
      };

      if (cls.status === 'repair_item')                                      repair_items.push(out);
      else if (cls.status === 'never_occurred' || cls.status === 'very_low_risk') removable.push(out);
      else                                                                    not_removable.push(out);
    }

    result.stations[displayName] = {
      summary: {
        total_items:          mssItems.length,
        never_occurred_count: removable.filter(i => i.status === 'never_occurred').length,
        very_low_risk_count:  removable.filter(i => i.status === 'very_low_risk').length,
        low_risk_count:       not_removable.filter(i => i.status === 'low_risk').length,
        repair_item_count:    repair_items.length,
        has_loss_count:       not_removable.filter(i => i.status === 'has_loss').length,
        removable_count:      removable.length,
        total_removable_time_sec: removable.reduce((s, i) => s + i.saved_time_sec, 0)
      },
      removable,
      repair_items,
      not_removable
    };
  }

  return result;
}
