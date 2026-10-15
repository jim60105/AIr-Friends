# 結構化日誌記錄

AIr-Friends 具備企業級的日誌子系統（實作於 `src/utils/logger.ts`），支援結構化輸出與外部收集平台整合。

---

## 結構化 JSON 與訊息範本 (Message Template)

系統採用現代化訊息範本（Message Template）慣例，日誌中的動態參數均保留為獨立欄位，而非混入非結構化的字串中：

```json
{
  "timestamp": "2026-10-15T08:30:00.123Z",
  "level": "INFO",
  "messageTemplate": "Processed incoming message from user {userId} on platform {platform}",
  "properties": {
    "userId": "560842157351763989",
    "platform": "discord",
    "channelId": "112233445566778899",
    "latencyMs": 142
  }
}
```

- **標準日誌等級**：`DEBUG`、`INFO`、`WARN`、`ERROR`。
- **終端色彩美化**：在本地開發時，若標準輸出為 TTY，日誌會自動格式化為帶色彩的易讀格式；在生產環境或容器管線中則自動切換為一單行 JSON 格式。

---

## GELF HTTP 外部傳輸整合

若需要將日誌集中傳送至 Graylog、Logstash 或 Seq 等集中式日誌分析系統，可啟用 GELF（Graylog Extended Log Format）HTTP 傳輸：

```yaml
logging:
  level: "INFO"
  gelf:
    enabled: true
    url: "http://graylog.internal:12201/gelf"
    batchSize: 50
    flushIntervalMs: 5000
```
