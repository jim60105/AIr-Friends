# 對話稽核日誌

在多使用者社群環境中，完整的稽核日誌（Audit Logs）有助於事後回溯惡意行為、追查 Prompt 注入攻擊並確保合規性。

---

## 稽核日誌格式 (Session JSONL)

AIr-Friends 將每次對話工作階段的完整歷程以 JSONL（JSON Lines）格式寫入稽核儲存庫（預設位於 `data/audit/sessions/{YYYY-MM-DD}.jsonl`）。

每筆 JSONL 紀錄均包含：
- `sessionId`：工作階段識別碼。
- `timestamp`：ISO 8601 時間戳記。
- `platform`、`channelId`、`userId`：訊息來源中繼資料。
- `inputPrompt`：完整組裝後的初始提示詞（包含注入的記憶與頻道歷史）。
- `toolCalls`：代理人呼叫各項技能的輸入參數與執行結果。
- `finalReply`：最終發布給使用者的文字內容。

---

## SHA-256 完整性雜湊 (Integrity Hashing)

為了防止日誌在磁碟上被竄改，每筆稽核紀錄在寫入時均會計算其內容的 SHA-256 雜湊值，並串聯上一筆紀錄的雜湊形成不可逆的防偽鏈（Tamper-evident Hash Chain）。任何對歷史紀錄的手動編輯皆會導致校驗失敗。

---

## 保留與輪替政策 (Retention Policy)

可以在 `config.yaml` 中配置稽核日誌的保留天數：

```yaml
audit:
  enabled: true
  retentionDays: 30       # 超過 30 天的日誌會由背景排程自動清理
  hashVerification: true  # 啟動時校驗歷史稽核鏈完整性
```
