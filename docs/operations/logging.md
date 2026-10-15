# 結構化日誌記錄

AIr-Friends 具備結構化日誌子系統（實作於 `src/utils/logger.ts`），支援結構化輸出與外部收集平台整合。

---

## 結構化 JSON 與訊息範本 (Message Template)

系統採用訊息範本慣例，動態參數保留為獨立欄位，而非混入非結構化字串。日誌項目的型別定義於 `src/types/logger.ts`。

```json
{
  "timestamp": "2026-10-15T08:30:00.123Z",
  "level": "INFO",
  "module": "SkillAPIServer",
  "message": "Skill API server started on 127.0.0.1:3001",
  "messageTemplate": "Skill API server started on {hostname}:{port}",
  "context": {
    "hostname": "127.0.0.1",
    "port": 3001
  }
}
```

系統使用 `DEBUG`、`INFO`、`WARN`、`ERROR` 與 `FATAL` 五個標準日誌等級。本地開發且標準輸出為 TTY 時，日誌格式化為帶色彩的易讀格式；在生產環境或容器管線中則輸出單行 JSON。

---

## GELF HTTP 外部傳輸整合

若需要將日誌集中傳送至 Graylog 等集中式日誌分析系統，可啟用 GELF（Graylog Extended Log Format）傳輸。

```yaml
logging:
  level: "INFO"
  gelf:
    enabled: true
    endpoint: "http://graylog.internal:12202/gelf"
    hostname: "air-friends"
    protocol: "http"   # http、tcp 或 udp（預設 http）
    # compress: true   # UDP 傳輸時的 GZIP 壓縮（預設 true）
```
