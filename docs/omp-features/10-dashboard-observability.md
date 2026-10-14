# 10. 儀表板與觀測性

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 10」。

## 10.1 儀表板可選擇 OMP 代理

**白話說明**
網頁儀表板提供一個聊天介面，可以選擇要用哪一種代理。這項功能在既有的代理下拉選單中加入 OMP 選項，並把使用者選的值原樣送到連線請求（不再硬寫死 OpenCode）。模型輸入、驗證、身分驗證與生命週期行為都維持不變。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/dashboard/public/index.html:552-553` | 代理下拉選單的 `opencode` / `omp` 選項 |
| `src/dashboard/public/js/chat.js:43,55` | 送出時帶上使用者選取的 `agentType` |
| `src/dashboard/server.ts:654-658` | 後端驗證 `agentType`（`isSupportedAgentType`） |

**測試位置**
- `tests/dashboard/server.test.ts`
- `tests/dashboard/config.test.ts`

**規格需求**（`openspec/specs/web-dashboard-chat/spec.md`）
- `Dashboard Chat Offers Both Supported Agent Types`
- `Chat Session Connection`

**對應封存變更**：`openspec/changes/archive/2026-10-12-expose-omp-dashboard-agent-selection`

## 10.2 代理思考過程的完整記錄

**白話說明**
代理在回覆前會有一段「思考」串流，原本只是一小塊一小塊地記在 debug 記錄裡，難以閱讀。這項功能把這些片段緩衝起來，在切換到下一個事件或整輪結束時，合成一筆完整的「代理完整思考」記錄（INFO 等級），並寫入稽核軌跡，讓事後檢視推理鏈變得容易。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/client.ts:248-249` | `messageBuffer` / `thoughtBuffer` |
| `src/acp/client.ts:1347-1349` | 收集非空的思考片段 |
| `src/acp/client.ts:1645-1673` | `flushAccumulatedBuffer()`：合成並記錄 "Agent complete thought" |
| `src/acp/client.ts:1742` | `flushThoughtBuffer()` |
| `src/core/audit-logger.ts` | 對應的稽核階段寫入 |

**測試位置**
- `tests/acp/client.test.ts`
- `tests/core/audit-logger.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Agent Thought Chunk Buffering`
- `openspec/specs/session-audit-log/spec.md` — `Audit Phases`
- `openspec/specs/session-audit-log/spec.md` — `Agent Complete Thought Audit Phase`
- `openspec/specs/session-audit-log/spec.md` — `Non-Blocking Audit Logging and Synchronous Timestamps`

**對應封存變更**：`openspec/changes/archive/2026-07-10-agent-complete-thought`
