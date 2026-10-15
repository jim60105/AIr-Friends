# 模型與金鑰設定

AIr-Friends 透過 ACP 代理人引擎呼叫大型語言模型（LLM）。你可以配置 API 金鑰、預設模型與推理思考強度。

---

## 支援的模型供應商與金鑰

系統在 `agent` 區塊（或對應環境變數）中支援下列金鑰。

| 供應商 / 類型 | 組態欄位（`agent.*`） | 環境變數 | 說明 |
| :--- | :--- | :--- | :--- |
| OpenRouter | `openRouterApiKey` | `OPENROUTER_API_KEY` | 以 `openrouter/<provider>/<model>` 形式選用模型 |
| Google Gemini | `geminiApiKey` | `GEMINI_API_KEY` | 供 OpenCode 的 Gemini 供應商使用 |
| OpenCode CLI | `opencodeApiKey` | `OPENCODE_API_KEY` | 供 OpenCode 專屬服務驗證使用 |

若使用自建或相容 OpenAI API 的端點，可透過 OpenCode 或 OMP 本身的模型清單（例如 `agent-config/omp/models.yml`）設定。

---

## 代理人預設模型設定

在 `config.yaml` 的 `agent` 區塊中指定機器人使用的預設模型。

```yaml
agent:
  # 預設對話模型識別碼
  model: "openrouter/deepseek/deepseek-v4-pro"

  # ACP 工作階段全域推理思考強度 (Reasoning Effort)
  # 選項：default, none, low, medium, high, xhigh, max
  reasoningEffort: "default"

  # 代理人引擎類型：opencode (預設) 或 omp
  defaultAgentType: "opencode"

  # 對話脈絡 Token 上限
  tokenLimit: 20000
```

對應的環境變數設定範例。

```bash
OPENROUTER_API_KEY="sk-or-v1-..."
GEMINI_API_KEY="AIzaSy..."
AGENT_MODEL="openrouter/deepseek/deepseek-v4-pro"
AGENT_REASONING_EFFORT="medium"
AGENT_DEFAULT_TYPE="opencode"
```

---

## 動態情境模型路由

若需針對特定頻道、特定工作階段類型（例如自發貼文、自主研究、定時提醒）或特定訊息關鍵詞指派不同的模型，可啟用模型路由模組。詳細規則與語法請參閱 [模型路由規則](../agent/model-routing.md)。
