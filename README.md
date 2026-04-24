# TTO Analysis Web App

NOR Flash CP Test 時間優化分析工具 — 純靜態網頁版，支援 GitHub Pages 部署。

## 🚀 快速部署到 GitHub Pages

1. 將整個 `web_app/` 目錄推送至 GitHub Repository
2. 進入 **Settings → Pages**，來源選擇 `main` branch，目錄選 `/web_app`（或 root）
3. 等待部署完成，即可透過公開 URL 分享給他人使用

## 📁 支援的輸入檔案

| 檔案類型 | 格式 | 說明 |
|----------|------|------|
| **CP Summary Excel** | `*_CP_Summary.xlsx` | 各站點良率資料（必填）|
| **MSS Excel** | `*_CP_MSS.xlsx` | 測試項目定義（必填）|
| **Rawdata TXT** | `*_DATALOG_*.TXT` | 執行頻率 + 時間資料（選填，可多選）|

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

每個測試項目依 CAT ID 對應的失效 PPM 分類：

| 狀態 | 條件 | 建議 |
|------|------|------|
| 🟢 從未失效 | 所有 CAT 的 avg PPM = 0 | 可考慮移除 |
| 🔵 低風險可移除 | avg PPM < 50 ppm | 低風險，可評估移除 |
| 🟡 建議觀察 | avg PPM < 500 ppm | 建議持續監控 |
| 🟣 Repair 保護 | test_item 含 "repair" | 即使 0 fail 仍應保留 |
| 🔴 有 Yield Loss | avg PPM ≥ 500 ppm | 不建議移除 |

## 🛠 本地開發

直接用瀏覽器開啟 `index.html` 即可（**不需要**本地伺服器）。

所有依賴均透過 CDN 載入：
- Tailwind CSS 4 (UI 框架)
- Chart.js 4.4 (甜甜圈圖)
- SheetJS 0.20.2 (Excel 讀寫)

## 📝 注意事項

- 所有分析在**瀏覽器端進行**，檔案不會上傳至任何伺服器，資料完全私密
- 大型 Rawdata TXT（>10 MB）解析可能需要 5–15 秒，請耐心等待
- 500 列以上的表格使用虛擬捲動以確保效能
