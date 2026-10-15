# 模型與金鑰設定

AIr-Friends 支援透過 ACP 代理人引擎呼叫各大主力大型語言模型（LLM）。你可以靈活配置多家供應商的 API 金鑰與預設模型。

---

## 支援的模型供應商

系統原生支援並常態搭配以下供應商與模型：

| 供應商 | 常用模型代號範例 | 特點 |
| :--- | :--- | :--- |
| **Anthropic** | `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku` | 邏輯推理優異、提示詞遵循度高、支援思考模式 |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini` | 多語言能力強、回應速度快、支援結構化輸出 |
| **Google** | `gemini-2.0-flash`, `gemini-1.5-pro` | 長脈絡視窗、經濟實惠 |
| **DeepSeek** | `deepseek-chat`, `deepseek-reasoner` | 開源架構推論強、成本極低 |
| **自建 / 本地端** | 相容 OpenAI API 的任何模型（如 vLLM, Ollama, LiteLLM） | 隱私自主、無外部 API 成本 |

---

## API 金鑰組態設定

你可以在 `.env` 檔案中設定全域環境變數，或在 `config.yaml` 的 `providers` 區段集中管理：

```yaml
# config.yaml 範例
providers:
  anthropic:
    apiKey: "${ANTHROPIC_API_KEY}"
  openai:
    apiKey: "${OPENAI_API_KEY}"
    baseUrl: "https://api.openai.com/v1"  # 選填：可指向相容代理端點
  deepseek:
    apiKey: "${DEEPSEEK_API_KEY}"
    baseUrl: "https://api.deepseek.com/v1"
```

對應的 `.env` 設定範例：

```bash
# 模型供應商金鑰
ANTHROPIC_API_KEY="sk-ant-..."
OPENAI_API_KEY="sk-proj-..."
DEEPSEEK_API_KEY="sk-..."
```

---

## 預設模型與代理人推論設定

在 `config.yaml` 中的 `agent` 區塊，可以指定代理人預設使用的主要模型、備用模型以及推論思考層級（Reasoning Effort）：

```yaml
agent:
  type: "opencode"             # 代理人引擎類型：opencode 或 omp
  defaultModel: "anthropic/claude-3-7-sonnet"
  fallbackModel: "openai/gpt-4o-mini"
  thoughtLevel: "medium"       # 思考層級：off, low, medium, high
  timeout: 120000              # 推論逾時時間 (毫秒)
```

- **備用模型 (Fallback)**：當主要模型發生供應商逾時（Timeout）或速率受限（Rate Limit 429）時，系統會自動切換至備用模型重新發送請求，確保機器人服務不中斷。
- **動態情境模型路由**：若需針對不同頻道、使用者群體或指令類型指定特定模型，請參閱 [模型路由規則](../agent/model-routing.md)。
