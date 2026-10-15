# 對話稽核日誌

在多使用者社群環境中，完整的稽核日誌（Audit Logs）有助於事後回溯惡意行為、追查 Prompt 注入攻擊並確認合規性。

---

## 稽核日誌格式 (Session JSONL)

啟用 `audit.enabled` 後，每次對話工作階段會產生一份 JSONL（JSON Lines）稽核檔，路徑為 `data/audit/{platform}/{userId}/{sessionId}.jsonl`。

每筆紀錄為一行 JSON，包含三個欄位。

- `ts`：ISO 8601 時間戳記。
- `phase`：工作階段生命週期階段，例如 `trigger_received`、`session_start`、`skill_call`、`reply_sent`、`session_end`。
- `data`：該階段的內容，欄位隨階段而異，例如 `channelId`、`userId`、`model`、`skillName`、`skillParams`、`replyLength` 等。

---

## 內容雜湊 (Content Hashing)

`audit.hashContent`（預設 `true`）啟用時，使用者內容不以原文寫入日誌，而是改存 SHA-256 雜湊，例如 `promptContentHash`、`replyContentHash` 與 `messageContentHash`。日誌本身不建立防竄改雜湊鏈。

---

## 保留與輪替政策 (Retention Policy)

稽核日誌的設定位於 `config.yaml` 的 `audit` 區塊。

```yaml
audit:
  enabled: true
  retentionDays: 7        # 超過天數的日誌由保留排程自動清理（預設：7）
  hashContent: true       # 以 SHA-256 雜湊取代使用者原文（預設：true）
  includedPhases:         # 僅記錄指定階段，空陣列 = 全部
    - "trigger_received"
    - "skill_call"
    - "reply_sent"
    - "session_end"
```

---

## 儀表板檢視

稽核歷史可透過 Web 儀表板的 Sessions 頁籤檢視，點選歷史工作階段即可展開對應的稽核內容。詳見 [Web 儀表板](dashboard.md)。
