# 指標與健康檢查

為了方便與 Prometheus、Grafana 或 Kubernetes 叢集整合，AIr-Friends 提供標準的監控指標與健康檢查端點。

---

## 健康檢查探針端點

系統內建 HTTP 健康檢查探針（預設監聽於 8080 連接埠或儀表板介面）：

| 端點路徑 | 檢查類型 | 說明 | 回應狀態碼 |
| :--- | :--- | :--- | :--- |
| `/health` | 一般健康狀態 | 檢查程序主迴圈是否正常運作 | 200 OK |
| `/ready` | 就緒狀態 | 檢查聊天平台（Discord / Misskey）是否已成功登入並保持連線 | 200 OK 或 503 Service Unavailable |
| `/readyz` | Kubernetes 相容探針 | 與 `/ready` 相同，供 K8s readinessProbe 呼叫 | 200 OK 或 503 Service Unavailable |

---

## Prometheus 監控指標 (`/metrics`)

造訪 `/metrics` 端點可取得標準 Prometheus 格式的度量資料，包括：

- `airfriends_sessions_total`：累積啟動的代理人工作階段總數（包含成功與失敗計數）。
- `airfriends_session_duration_seconds`：工作階段執行耗時直方圖。
- `airfriends_tokens_consumed_total`：模型輸入與輸出權杖累積消耗量。
- `airfriends_rate_limit_hits_total`：觸發頻率限制的使用者次數統計。
- `airfriends_memory_items_total`：系統目前儲存的記憶條目總數。

---

## 模擬除錯模式 (`--dry-run`)

在開發提示詞或驗證工作階段組裝流程時，可使用 `--dry-run` 旗標啟動：

```bash
deno run --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi src/main.ts --dry-run
```

- **零 API 成本**：系統會完整執行工作區準備、記憶檢索、提示詞組裝與 Vento 樣板渲染，但**不會**真正呼叫外部付費 LLM。
- **提示詞落盤除錯**：組裝後的完整 Prompt 會被儲存至 `data/dry-run/` 目錄中供審閱。
- **測試回覆**：若設定了 `mockReply`，系統會直接發送測試文字至平台，方便驗證連線與排版。
