# 1. 代理類型與設定

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 1」。

本頁收錄「讓 OMP 成為可選代理類型」的功能。

> **處置：保留（不變）。** 代理類型、預設值與載入驗證在 `cutover-omp-native-runtime` 之後維持原本行為。

## 1.1 可選的第二種代理：OMP

**白話說明**
系統原本只認得一種 AI 代理（OpenCode）。這項功能讓維運人員可以透過設定檔或環境變數，改選 OMP 作為執行 AI 推理的代理；若什麼都不設定，仍預設使用 OpenCode。設定值打錯時，系統會在啟動載入階段就明確報錯，而不是拖到執行階段才出現難以理解的失敗。同時，OMP 專用的雲端服務憑證（Gemini、OpenRouter）也被加入允許傳遞給子行程的清單，避免啟動 OMP 時拿不到憑證。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/types.ts:177` | `AgentType = "opencode" \| "omp"` 型別定義 |
| `src/acp/types.ts:183` | `SUPPORTED_AGENT_TYPES` 支援清單 |
| `src/acp/types.ts:193` | `isSupportedAgentType()` 單一判定函式（所有驗證共用） |
| `src/acp/agent-factory.ts:413` | `getDefaultAgentType()`：未設定時回傳 `"opencode"` |
| `src/core/config-loader.ts:459-471` | 載入期驗證，非法值丟出 `ConfigError` 並列出 `opencode, omp` |
| `src/acp/sandbox-manager.ts:66-79` | `AGENT_TYPE_ENV`：OMP 僅允許 `GEMINI_API_KEY`、`OPENROUTER_API_KEY` |

**測試位置**
- `tests/acp/agent-factory-omp.test.ts`
- `tests/core/config-loader.test.ts`
- `tests/utils/env.test.ts`
- `tests/acp/sandbox-manager.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Supported Agent Types`
- `openspec/specs/acp-integration/spec.md` — `Agent Common Environment`
- `openspec/specs/acp-integration/spec.md` — `Shared Agent Environment Filtering With Native OMP Discovery`
- `openspec/specs/configuration-and-deployment/spec.md` — `Deployment Agent Type Value Domain And Synchronization`
- `openspec/specs/web-dashboard-chat/spec.md` — `Chat Session Connection`
- `openspec/specs/web-dashboard-chat/spec.md` — `Dashboard Chat Offers Both Supported Agent Types`

**對應封存變更**：`openspec/changes/archive/2026-10-08-add-omp-agent-configuration`

**相關文件**：`docs/OMP_SETTINGS.md`
