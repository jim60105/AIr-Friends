# 模型與金鑰設定

AIr-Friends 支援透過 ACP 代理人引擎呼叫各大主力大型語言模型（LLM）。你可以靈活配置 API 金鑰、預設模型與推理思考強度。

---

## 支援的模型供應商與金鑰

系統在 `agent` 區塊（或環境變數）中支援設定以下金鑰：

| 供應商 / 類型 | 組態欄位 (`agent.*`) | 環境變數名稱 | 常用模型代號範例 |
| :--- | :--- | :--- | :--- |
| **OpenRouter** | `openRouterApiKey` | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-3.7-sonnet`, `openrouter/deepseek/deepseek-chat` |
| **Google Gemini** | `geminiApiKey` | `GEMINI_API_KEY` | `gemini-2.0-flash`, `gemini-1.5-pro` |
| **OpenCode CLI** | `opencodeApiKey` | `OPENCODE_API_KEY` | 供 OpenCode 專屬服務驗證使用 |

若使用自建或相容 OpenAI API 的端點，亦可透過 OpenCode 或 OMP 本身的模型清單（如 `models.yml`）直接設定。

---

## 代理人預設模型設定

在 `config.yaml` 的 `agent` 區塊中指定機器人使用的預設模型：

```yaml
agent:
  # 預設對話模型識別碼
  model: "openrouter/anthropic/claude-3.7-sonnet"

  # ACP 工作階段全域推理思考強度 (Reasoning Effort)
  # 選項：default, off, low, medium, high, xhigh, max
  reasoningEffort: "medium"

  # 代理人引擎類型：opencode (預設) 或 omp
  defaultAgentType: "opencode"

  # 對話脈絡 Token 上限
  tokenLimit: 32000
```

對應的環境變數設定範例：

```bash
OPENROUTER_API_KEY="sk-or-v1-..."
GEMINI_API_KEY="AIzaSy..."
AGENT_MODEL="openrouter/anthropic/claude-3.7-sonnet"
AGENT_REASONING_EFFORT="medium"
AGENT_DEFAULT_TYPE="opencode"
```

---

## 動態情境模型路由

若需針對特定頻道、特定工作階段類型（例如自發發文、自主研究、定時提醒）或特定訊息關鍵字指派不同的模型，可啟用模型路由模組。詳細規則與語法請參閱 [模型路由規則](../agent/model-routing.md)。
