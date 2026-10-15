# 頻率限制防護

為了避免惡意使用者以高頻率標記對機器人發動阻斷服務攻擊（DoS），或瞬間耗盡外部 API 額度，AIr-Friends 內建以滑動視窗為基礎的頻率限制器（Rate Limiter）。

---

## 實作架構與演算法

頻率限制邏輯實作於 `src/core/rate-limiter.ts`，以每使用者的滑動視窗時間戳記佇列（Sliding-Window Timestamp Queue）搭配冷卻懲罰機制運作。

1. **滑動時間視窗（Window）**：系統為每個使用者維護請求時間戳記陣列，新請求到達時先剔除視窗時間外的過期時間戳記。
2. **最大請求容量（Capacity / Burst）**：剔除後剩餘時間戳記數量超過 `maxRequestsPerWindow` 時，判定觸發頻率限制。
3. **冷卻懲罰期（Cooldown Period）**：使用者一旦超標即進入冷卻狀態（`cooldownUntil`），冷卻期結束前的任何新請求皆被直接拒絕，且不計入佇列。

---

## 組態參數設定

在 `config.yaml` 中配置 `rateLimit` 區塊。

```yaml
rateLimit:
  enabled: false               # 是否啟用頻率限制（預設：false）
  maxRequestsPerWindow: 10     # 單一視窗每使用者允許的最大請求次數（預設：10）
  windowMs: 600000             # 滑動視窗時間，毫秒（預設：600000，即 10 分鐘）
  cooldownMs: 600000           # 觸發超標後的冷卻時間，毫秒（預設：600000，即 10 分鐘）
```

---

## 防護行為與使用者回饋

- **拒絕超標請求**：超標使用者的訊息事件會被拒絕，不進入代理人工作階段。
- **頻道與帳號豁免**：`channels` 清單中的條目可設定 `rateLimitBypass: true`，略過頻率限制評估。
- **自動記憶體回收**：長時間未活動的使用者記錄會在背景定期清理，避免記憶體無止盡增長。
