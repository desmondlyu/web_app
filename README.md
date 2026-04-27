<!-- ================================================================
  🤖 AI SESSION CONTEXT — 給下一個 AI Session 看的專案記憶
  最後更新：2026-04-27，Session b57db4f5-9bf9-49c7
  ================================================================ -->

## 🤖 AI 快速喚醒區（給 Copilot / AI 看）
> 下次回到此專案，請先讀本節，再閱讀其他說明文件，即可還原完整開發背景。

### 專案定位
**TTO Analysis Web App** — NOR Flash CP 測試時間優化分析工具

**Pipeline 架構**：
```
用戶上傳 CP_Summary + MSS Excel
           ↓
   js/parsers.js (格式自動偵測)
           ↓
   ┌─ 新格式 (2026+)：單頁 + Process 欄分組
   │ 
   └─ 舊格式 (相容)：多頁 (Sheet = 站點)
           ↓
   分析引擎：CAT 分類 → PPM 計算 → 風險評估
           ↓
   Tailwind + Chart.js 儀表板呈現
           ↓
   Excel 匯出報告（5 個工作表）
```

### 重要技術決策（2026-04-27 更新）

| 決策項 | 做法 | 理由 |
|--------|------|------|
| **格式支援** | 雙格式自動偵測 (新 + 舊相容) | 減少使用者轉檔成本，提高易用性 |
| **CAT 解析** | Process 欄後尋找 Wf. Yld.，再往後找 Bin Code | 語義定位比位置定位更穩定 |
| **Pass CAT 定義** | {01, 02, 03, 04, 05, 07} (固定集合) | 與 MSS 標準一致 |
| **PPM 公式** | (失效%) × 10000 | 業界標準單位 |
| **風險分級** | 4 檔 (0 ppm / 50 ppm / 500 ppm / 有失效) | 符合半導體良率管制門檻 |
| **資料隱私** | 瀏覽器端解析，無伺服器上傳 | 滿足公司資料安全政策 |

### 格式偵測邏輯（核心）

**新格式判定**：`1 個 Sheet + 有 Process 欄 + 有 Wf. Yld. 欄 → 新格式`  
**Bin Code 定位**：`Wf. Yld. 欄後的所有欄位 → Bin Code 集合`  
**站點分組**：`Process 欄值 (DS00/S1P1/DS05/SFIN/SPRE/DS03)`

實作位置：
- **Python 後端**：`C:\D_BACKUP\AI_Project\TTO_Agent\analysis_code\analyze_cp_yield.py`，函式 `_detectNewCPFormat()` (L210-225)
- **Web App JS**：`C:\D_BACKUP\AI_Project\TTO_Agent\web_app\js\parsers.js`，函式 `_detectNewCPFormat()` (L210-225)

### 已安裝 Skills

- ✅ `cp-summary-analysis` (C:\Users\yplu\.copilot\skills\cp-summary-analysis)
- ✅ `cp-yield-optimizer` (C:\D_BACKUP\AI_Project\TTO_Agent\.copilot\skills\cp-yield-optimizer)

### 常見錯誤與解法

| 錯誤 | 原因 | 解法 |
|------|------|------|
| `Cannot read property 'sheet_names' of undefined` | Excel 檔不存在或已損壞 | 檢查檔案路徑、重新匯出 Excel |
| 站點數錯誤（多出 Sheet0 / Sheet1） | 舊格式偵測失敗（被認成新格式） | 確認 CP_Summary 只有一個 Sheet + 有 Process 欄 |
| PPM 計算為 0 (全部通過) | 正常現象 | 若整個站點無失效，結果就是 0 ppm |
| Rawdata 上傳無反應 | 檔案超過 10 MB 或格式非 TXT | 分割 Rawdata；檢查副檔名 |
| 匯出 Excel 無法開啟 | SheetJS 與舊版 Excel 相容問題 | 用 Excel 2016+ 或 LibreOffice 開啟 |

### 尚未完成的功能

- [ ] **Split 欄位支援**：新格式缺少 DOE/Process Condition 資訊，需手動或上傳 DOE 對應表
- [ ] **儀表板暗黑模式**：目前只有亮色 Tailwind，可加深夜間工作適用性
- [ ] **多語言支援**：目前繁中，可加英文 / 簡中
- [ ] **離線模式強化**：考慮 Service Worker 快取，網路斷線時仍可查詢歷史分析

---

# TTO Analysis Web App

NOR Flash CP Test 時間優化分析工具 — 純靜態網頁版，直接用瀏覽器開啟即可使用。

**✨ 新增功能**：支援新格式 CP Summary Excel（單頁 + Process 欄）；舊格式自動相容！

## 📁 支援的輸入檔案

| 檔案類型 | 格式 | 說明 | 來源格式 |
|----------|------|------|----------|
| **CP Summary Excel** | `*_CP_Summary.xlsx` | 各站點良率資料（必填）| **新格式**：單頁 + Process 欄 / **舊格式**：多頁（Sheet = 站點）|
| **MSS Excel** | `*_CP_MSS.xlsx` | 測試項目定義（必填）| 標準多頁格式（無變更）|
| **Rawdata TXT** | `*_DATALOG_*.TXT` | 執行頻率 + 時間資料（選填，可多選）| 無變更 |

## 📊 功能說明

### 上傳畫面
- 拖曳或點擊上傳三種檔案
- 可調整 PPM 閾值（極低風險：50 ppm、低風險：500 ppm）
- 上傳 CP Summary + MSS 後即可開始分析

### 儀表板
- **全局 KPI**：總測試項目 / 可移除數量 / Repair 保護項 / 估計節省時間
- **站點分頁**：DS00 / DS05 / S1P1 / SPRE / SFIN / DS03（依資料自動顯示）
- **每站點視圖**：
  - 迷你 KPI 卡片
  - 狀態分佈環形圖
  - ✂ 可移除項目表（可排序/搜尋）
  - 🔧 Repair 保護項表
  - ⛔ 不建議移除表

### 匯出
點擊右上角 **📤 匯出 Excel** 可下載 5 個工作表的分析報告：
1. `KPI_總覽` — 各站點統計摘要
2. `CP_可移除` — 所有可移除測試項目
3. `CP_不建議移除` — 有 Yield Loss 的項目
4. `CP_Repair保護` — Repair 保護項
5. `Rawdata_執行` — 測試執行頻率（有上傳 Rawdata 時才有此工作表）

## 🔍 分析邏輯

### CAT（失效代碼）識別規則

**Pass CAT**（不計入 Fail）：`01`, `02`, `03`, `04`, `05`, `07`  
**Fail CAT**：其他所有 CAT 代碼（如 `0A`, `0F`, `1K`, `2N`, `5V`...）

### 測試項目分類

每個測試項目依 CAT ID 對應的失效 PPM 分類：

| 狀態 | 條件 | 建議 |
|------|------|------|
| 🟢 從未失效 | 所有 CAT 的 avg PPM = 0 | 可考慮移除 |
| 🔵 低風險可移除 | avg PPM < 50 ppm | 低風險，可評估移除 |
| 🟡 建議觀察 | avg PPM < 500 ppm | 建議持續監控 |
| 🟣 Repair 保護 | test_item 含 "repair" | 即使 0 fail 仍應保留 |
| 🔴 有 Yield Loss | avg PPM ≥ 500 ppm | 不建議移除 |

### PPM 計算公式

```
avg_ppm = (所有 wafer 的失效% 平均) × 10000
max_ppm = (最高失效%) × 10000
```
> 例：失效 0.05% → 500 ppm

## 🛠 本地開發

直接用瀏覽器開啟 `index.html` 即可（**不需要**本地伺服器）。

所有依賴均透過 CDN 載入：
- Tailwind CSS 4 (UI 框架)
- Chart.js 4.4 (甜甜圈圖)
- SheetJS 0.20.2 (Excel 讀寫)

## 📝 注意事項

### CP Summary Excel 格式支援

Web App 自動偵測並支援**兩種格式**：

#### ✅ 新格式（2026+）
```
單一工作表 "工作表1"
├─ 欄位：Lot No, Wafer, Process (站點), Layer, Die Cnt., Wf. Yld., ...
├─ Bin Code：2N, 0F, 0A, 5V... （Wf. Yld. 欄之後）
└─ 每列一筆測試，Process 欄決定站點分組
```

#### ✅ 舊格式（相容）
```
多個工作表（DS00, S1P1, DS05, SFIN, SPRE...）
├─ 各 Sheet = 一個站點
└─ 每 Sheet 內有 Bin Code 欄位
```

**優勢**：
- ✅ 無需手動切換，自動偵測
- ✅ 新舊格式混用無問題
- ✅ 所有分析邏輯保持一致

### 其他注意事項

- 所有分析在**瀏覽器端進行**，檔案不會上傳至任何伺服器，資料完全私密
- 大型 Rawdata TXT（>10 MB）解析可能需要 5–15 秒，請耐心等待
- 500 列以上的表格使用虛擬捲動以確保效能
