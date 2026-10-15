# 模型路由規則

在複雜的對話場景中，單一模型往往難以同時兼顧回應速度、思考深度與運算成本。AIr-Friends 支援靈活的情境式模型路由（Contextual Model Routing）。

---

## 路由評估機制 (First-Match Wins)

模型路由評估模組在建立對話工作階段時啟動，依序檢驗組態中定義的規則清單。

- **由上而下比對**：系統由上至下依序比對每條規則的條件。
- **首項符合即採用 (First-Match)**：一旦找到第一條完全符合目前脈絡條件的規則，便立即選用該規則定義的模型與參數，後續規則不再重複評估。
- **預設回退**：若所有自訂規則皆未命中，則回退至全域預設模型（`agent.defaultModel`）。

---

## 路由條件維度

一條路由規則可結合多種維度進行複合過濾：

- `platform`：平台程式碼（例如 `discord` 或 `misskey`）。
- `channelId`：特定頻道或討論串 ID。
- `userId`：特定使用者 ID。
- `sessionType`：工作階段類型（例如一般回覆 `reply`、自發貼文 `spontaneous`、自主研究 `self_research`、定時提醒 `reminder`、記憶維護 `memory_maintenance`）。
- `pattern`：觸發訊息內含的正規表達式（例如比對特定指令關鍵字）。

---

## 推理思考層級 (`thought_level`)

針對支援思考鏈（Reasoning / Extended Thinking）的模型（例如 Claude 3.7 Sonnet 或 o-series 模型），可以在路由規則中設定推理思考強度：

| 設定值 (`thought_level`) | 說明 | 適用情境 |
| :--- | :--- | :--- |
| `off` | 完全關閉深度思考模式 | 簡單閒聊、快速打招呼、基礎問答 |
| `low` | 低強度推理 | 短篇摘要、輕量級查詢 |
| `medium` | 中等強度推理（預設值） | 一般程式碼編寫、技術概念解釋、記憶整理 |
| `high` | 滿額深度思考 | 複雜架構設計、演算法推導、深度自主研究流程 |

---

## 組態範例

在 `config.yaml` 中配置 `agent.routes`：

```yaml
agent:
  defaultModel: "anthropic/claude-3-7-sonnet"
  thoughtLevel: "medium"

  routes:
    # 規則 1：自主研究工作階段使用滿額思考模型
    - match:
        sessionType: "self_research"
      model: "anthropic/claude-3-7-sonnet"
      thoughtLevel: "high"

    # 規則 2：定時提醒推播僅需快速便宜的小模型
    - match:
        sessionType: "reminder"
      model: "openai/gpt-4o-mini"
      thoughtLevel: "off"

    # 規則 3：特定高強度程式技術頻道啟用 DeepSeek 推理模型
    - match:
        channelId: "discord/channel/999888777666"
      model: "deepseek/deepseek-reasoner"
      thoughtLevel: "high"
```
