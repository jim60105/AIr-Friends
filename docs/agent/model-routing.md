# 模型路由規則

在對話場景中，單一模型往往難以兼顧回應速度、思考深度與運算成本。AIr-Friends 支援靈活的情境式模型路由（Model Routing）。

---

## 路由評估機制 (First-Match Wins)

模型路由評估模組在建立對話工作階段時啟動，依序檢驗組態中定義的規則清單：

- **由上而下比對**：系統由上至下依序比對每條規則的條件。
- **首項符合即採用 (First-Match)**：一旦找到第一條完全符合目前條件的規則，便立即選用該規則定義的模型與思考強度，後續規則不再重複評估。
- **預設回退**：若所有自訂規則皆未命中，則回退至全域預設模型（`agent.model`）與推理強度（`agent.reasoningEffort`）。

---

## 路由條件維度 (`match`)

一條路由規則的 `match` 物件可結合多個欄位（欄位間為 AND 邏輯）：

- `channel`：特定頻道或帳號條目，格式為 `{platform}/account/{id}` 或 `{platform}/channel/{id}`。
- `sessionType`：工作階段類型，可選值：
  - `message`：一般使用者對話訊息。
  - `spontaneous`：自發貼文工作階段。
  - `self-research`：自主研究工作階段。
  - `memory-maintenance`：記憶維護工作階段。
  - `reminder`：定時提醒推播工作階段。
  - `channelLurk`：頻道潛水回覆工作階段。
- `contentKeywords`：比對觸發訊息內容是否包含陣列中任一關鍵字（大小寫不敏感，陣列內為 OR 邏輯；僅對 `sessionType: "message"` 生效）。

---

## 推理思考層級 (`reasoningEffort`)

針對支援思考鏈（Reasoning / Extended Thinking）的模型，可以在規則中個別指定思考強度：
- 選項：`default`、`off`、`low`、`medium`、`high`、`xhigh`、`max`。
- 若省略未設定，則自動回退至全域 `agent.reasoningEffort` 設定值。

---

## 組態範例

在 `config.yaml` 中配置 `agent.modelRouting`：

```yaml
agent:
  model: "openrouter/anthropic/claude-3.7-sonnet"
  reasoningEffort: "medium"

  modelRouting:
    enabled: true
    rules:
      # 規則 1：自主研究工作階段使用高推理思考強度
      - match:
          sessionType: "self-research"
        model: "openrouter/anthropic/claude-3.7-sonnet"
        reasoningEffort: "high"

      # 規則 2：定時提醒推播僅需輕量模型且關閉思考
      - match:
          sessionType: "reminder"
        model: "openrouter/openai/gpt-4o-mini"
        reasoningEffort: "off"

      # 規則 3：在指定技術頻道且訊息包含程式開發關鍵字時選用專屬模型
      - match:
          channel: "discord/channel/999888777666"
          sessionType: "message"
          contentKeywords: ["debug", "refactor", "bug", "架構"]
        model: "openrouter/deepseek/deepseek-chat"
        reasoningEffort: "high"
```
