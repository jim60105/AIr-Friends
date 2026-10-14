# 9. 復原與所有權

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 10」。

## 9.1 復原：共用復原，OMP 不再強制所有權閘門

> **處置：保留（共用復原）；移除 OMP 強制閘門，OpenCode 可選檢查維持不變。**

**白話說明**
當代理行程意外死亡，系統會嘗試「復原」——重新連線並載入同一個 session，使用既有的能力偵測與失敗回報。這項功能現在由共用復原流程承擔：連接器依它自己的選項（cwd、MCP 定義、當前閘門情境、解析後的 effort）重新啟動並 `session/load`。

**OpenCode** 既有的可選所有權／閘門情境檢查維持不變：當呼叫端提供所有權或閘門情境時，連接器會在拆除與重連前後驗證所有權，不符即丟出有界錯誤且不做任何動作。**OMP** 則不再強制要求額外的所有權記錄或完整脈絡前置驗證：OMP 走共用 `session/load` 路徑復原，`verifyRecoveryOwnership()` **不**對 OMP 執行（由連接器以 `agentType === "omp"` 判定跳過），保留了取得時的解析模式與稽核觀察，但不以所有權記錄作為復原前提。閘門情境在工作階段載入後仍會正確重新綁定。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/agent-connector.ts:1167-1197` | 復原進入點：OMP 不呼叫所有權驗證，提供情境時仍走共用載入 |
| `src/acp/agent-connector.ts:1318-1340` | `verifyRecoveryOwnership()` 私有方法（供 OpenCode 檢查） |
| `src/acp/recovery-ownership.ts:112` | `verifyRecoveryOwnership()` 純函式驗證 |
| `src/acp/recovery-ownership.ts:79` | `deriveActualRecoveryTarget()` 由啟動環境推導實際目標 |
| `src/core/session-orchestrator.ts` | 各流程把取得的脈絡傳入可復原路徑 |

**測試位置**
- `tests/acp/recovery-ownership.test.ts`
- `tests/acp/agent-connector.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Shared Agent Recovery With OpenCode Context Checks`
- `openspec/specs/acp-integration/spec.md` — `Shared Session Gate Restoration After Native Load`
- `openspec/specs/acp-integration/spec.md` — `Session Runner Recovery Context And Response Fences`
- `openspec/specs/shared-acp-process-pool/spec.md` — `OMP Mode Pools Recover Through Their Existing Connector`

**對應封存變更**：`openspec/changes/archive/2026-10-15-simplify-omp-recovery-context`
**相關文件**：`docs/OMP_RECOVERY.md`
