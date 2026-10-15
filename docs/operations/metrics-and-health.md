# 指標與健康檢查

為了方便與 Prometheus、Grafana 或 Kubernetes 叢集整合，AIr-Friends 提供監控指標與健康檢查端點。

---

## 健康檢查探針端點

健康檢查與指標由獨立伺服器提供（`src/healthcheck.ts`），預設監聽 `health.port`（8080），與 Web 儀表板各自獨立。

| 端點路徑 | 檢查類型 | 說明 | 回應狀態碼 |
| :--- | :--- | :--- | :--- |
| `/health`、`/healthz` | 一般健康狀態 | 檢查各平台連線狀態並彙總 | 200 或 503 |
| `/ready`、`/readyz` | 就緒狀態 | 檢查平台連線與技能相依項目（腳本、二進位檔、Skill API 連線、工作區可寫） | 200 或 503 |
| `/metrics` | Prometheus 指標 | 需設定 `metrics.enabled`，路徑由 `metrics.path` 決定 | 200 |

`/readyz` 與 `/ready` 內容相同，供 Kubernetes readinessProbe 呼叫。

---

## Prometheus 監控指標 (`/metrics`)

造訪 `/metrics` 端點可取得標準 Prometheus 格式的度量資料，主要指標如下。

- `airfriends_sessions_total`：累積處理的代理人工作階段總數。
- `airfriends_session_duration_seconds`：工作階段執行耗時直方圖。
- `airfriends_active_sessions`：目前活躍的工作階段數量。
- `airfriends_rate_limit_rejections_total`：被頻率限制器拒絕的請求次數。
- `airfriends_memory_operations_total`：記憶操作次數。
- `airfriends_skill_readiness`：各技能相依項目的就緒狀態（1 = 就緒）。

完整指標清單以 `src/utils/metrics.ts` 為準。

---

## 模擬除錯模式 (`--dry-run`)

在開發提示詞或驗證工作階段組裝流程時，可使用 `--dry-run` 旗標啟動。

```bash
deno run --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi src/main.ts --dry-run
```

這個模式會完整執行工作區準備、記憶檢索、提示詞組裝與 Vento 樣板渲染，但不呼叫外部付費 LLM，因此沒有 API 成本。組裝後的完整 Prompt 會儲存至 `agent.dryRun.outputPath`（預設 `./data/dry-run/`）供審閱，若同時設定了 `agent.dryRun.mockReply`，系統會直接發送測試文字至平台，方便驗證連線與排版。
