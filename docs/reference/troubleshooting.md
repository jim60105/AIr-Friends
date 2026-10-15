# 疑難排解指南

本文件整理了 AIr-Friends 在部署與運作中常見的異常狀況與排除建議。

---

## 常見問題與排解方法

### 1. 機器人啟動後未能在平台上線
- **可能原因**：Token 填寫錯誤、未開啟 Privileged Gateway Intents，或主機網路連線受阻。
- **排除方式**：
  - 檢視啟動日誌中是否有 `401 Unauthorized` 或 Gateway 連線失敗訊息。
  - 前往 Discord Developer Portal 確認已開啟「Message Content Intent」與「Server Members Intent」。
  - 在主機上測試對 Discord 或 Misskey API 的連線狀態。

### 2. 機器人收到標記但沒有回覆
- **可能原因**：回覆政策限制、觸發頻率限制，或外部 LLM API 金鑰無效。
- **排除方式**：
  - 檢查 `config.yaml` 的 `replyPolicy` 與 `channels` 清單，確認該頻道或帳號已啟用。
  - 檢視日誌是否出現頻率限制拒絕訊息。
  - 確認模型供應商帳戶餘額正常且 API Key 具備呼叫權限。

### 3. OMP 引擎啟動時發出版本警告 (`BELOW_MINIMUM`)
- **可能原因**：安裝的 OMP 二進位檔版本低於已知相容基準（`18.6.1`）。
- **排除方式**：
  - 升級主機上的 OMP 執行檔至相容版本。
  - 若已確認當前版本相容，可透過環境變數 `AGENT_OMP_MIN_VERSION` 覆寫警告標準。此檢查僅為警示，不會阻擋啟動。

### 4. 記憶搜尋未回傳預期結果
- **可能原因**：查詢詞過於模糊，或相關記憶尚未寫入。
- **排除方式**：
  - 在提問時加入更精確的關鍵詞（如特定的活動名稱或專有名詞）。
  - 登入 Web 儀表板，於 Channel Memory 頁籤查看頻道記憶，或於 Workspace 頁籤查看全域知識筆記。

### 5. Web 儀表板無法連線
- **可能原因**：儀表板未啟用、密碼未設定，或連接埠未對外發布。
- **排除方式**：
  - 確認 `dashboard.enabled` 為 `true`，且 `dashboard.passphrase` 長度至少 16 字元。
  - 若使用 `compose.yml`，預設不對外發布連接埠，請自行加入連接埠對應。
  - 確認 `dashboard.host` 與反向代理設定一致。
