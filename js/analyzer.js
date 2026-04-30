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

      // 從 rawdata 查詢此 test item 的總執行時間（可節省時間）
      // MSS 的 test_item 可能有 "- " 前綴（例 "- Opens_PPS"），rawdata 無此前綴
      // TTLOG 的鍵值可能不包含 test_no，故需要嘗試多種匹配方式
      let saved_time_sec = 0;
      if (rawStation) {
        // 移除 test_item 前綴（"- " 或其他）
        const cleanedItem = test_item.replace(/^[-\s]+/, '').trim();
        
        // 嘗試多種鍵值組合（優先順序）
        const keysToTry = [
          `${test_no}_${test_item}`,           // 原始組合（含前綴）
          `${test_no}_${cleanedItem}`,         // 移除前綴
          `${cleanedItem}`,                     // 只用 test_item（TTLOG 可能沒有 test_no）
          test_item,                            // 原始 test_item
        ];
        
        let hit = null;
        for (const key of keysToTry) {
          if (rawStation.items[key]) {
            hit = rawStation.items[key];
            break;
          }
        }
        
        // 優先使用 time_sec（總時間，適用於 TTLOG），否則用 avg_time_sec（Rawdata 平均時間）
        if (hit) {
          saved_time_sec = hit.time_sec || hit.avg_time_sec || 0;
        }
        
        // 調試輸出（用於驗證匹配情況）
        if (!hit && Object.keys(rawStation.items).length > 0) {
          const firstItemKey = Object.keys(rawStation.items)[0];
          console.warn(
            `[DEBUG] 無法匹配 test_no=${test_no}, test_item="${test_item}" 到 TTLOG 資料。` +
            `嘗試過的鍵值：${keysToTry.join(', ')}。` +
            `rawStation 中的第一個鍵值示例：${firstItemKey}`
          );
        }
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

      if (cls.status === 'repair_item')                                           repair_items.push(out);
      else if (cls.status === 'never_occurred' || cls.status === 'very_low_risk') removable.push(out);
      else                                                                         not_removable.push(out);
    }

    // ── 去重：同站點內相同 (test_no, test_item) 只顯示一次，時間加總，CAT IDs 聯集 ──
    function _dedup(arr) {
      const map = new Map();
      for (const item of arr) {
        const key = `${item.test_no}||${item.test_item}`;
        if (map.has(key)) {
          const existing = map.get(key);
          // 時間加總
          existing.saved_time_sec += item.saved_time_sec;
          // CAT IDs 聯集去重
          const catSet = new Set([...existing.cat_ids, ...item.cat_ids]);
          existing.cat_ids = [...catSet];
          // PPM 取最大值（保守）
          if (item.worst_cat_avg_ppm > existing.worst_cat_avg_ppm)
            existing.worst_cat_avg_ppm = item.worst_cat_avg_ppm;
          if (item.worst_cat_max_ppm > existing.worst_cat_max_ppm)
            existing.worst_cat_max_ppm = item.worst_cat_max_ppm;
        } else {
          // 淺複製避免多站點共用參考
          map.set(key, Object.assign({}, item, { cat_ids: [...item.cat_ids] }));
        }
      }
      return [...map.values()];
    }

    const dedupRemovable    = _dedup(removable);
    const dedupRepair       = _dedup(repair_items);
    const dedupNotRemovable = _dedup(not_removable);

    result.stations[displayName] = {
      summary: {
        total_items:          mssItems.length,
        never_occurred_count: dedupRemovable.filter(i => i.status === 'never_occurred').length,
        very_low_risk_count:  dedupRemovable.filter(i => i.status === 'very_low_risk').length,
        low_risk_count:       dedupNotRemovable.filter(i => i.status === 'low_risk').length,
        repair_item_count:    dedupRepair.length,
        has_loss_count:       dedupNotRemovable.filter(i => i.status === 'has_loss').length,
        removable_count:      dedupRemovable.length,
        total_removable_time_sec: dedupRemovable.reduce((s, i) => s + i.saved_time_sec, 0)
      },
      removable:     dedupRemovable,
      repair_items:  dedupRepair,
      not_removable: dedupNotRemovable
    };
  }

  return result;
}
