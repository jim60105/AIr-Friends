# 9. 復原與所有權

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 10」。

## 9.1 逐啟動復原情境的完整串接

**白話說明**
當代理行程意外死亡，系統會嘗試「復原」——重新連線並載入同一個 session。但復原有個關鍵前提：**必須是同一個權限模式、同一個行程命名空間**，否則就可能發生「受限的 session 被復原成 YOLO 行程」這類嚴重越權。這項功能把「取得行程當下記錄下來的權限模式與命名空間」一路傳到每一個可復原的執行路徑（包含研究修正的重試），並在連接器真正開始拆除／重啟／`session/load` **之前**先驗證所有權；不符或缺資料就丟出明確錯誤並**不做任何動作**。復原後也會重新綁定該 session 自己的完整閘門情境（工作目錄、技能 session、權限旗標），不會拿別人的快取或行程凍結的設定來頂替。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/recovery-ownership.ts:25` | `SessionRecoveryOwnership`：取得時記錄的模式與命名空間 |
| `src/acp/recovery-ownership.ts:79` | `deriveActualRecoveryTarget()`：由啟動環境推導實際目標 |
| `src/acp/recovery-ownership.ts:110` | `verifyRecoveryOwnership()` 所有權驗證 |
| `src/acp/recovery-ownership.ts:146` | `RecoveryOwnershipError` |
| `src/acp/agent-connector.ts:1582-1587` | 以實際 OMP 目標比對（未知類型一律失敗關閉） |
| `src/acp/agent-connector.ts:83 / 99` | `GateContextRestoreError` / `RecoveryHookError` |
| `src/core/session-orchestrator.ts` | 各流程把取得時記錄的脈絡傳入可復原路徑 |

**測試位置**
- `tests/acp/recovery-ownership.test.ts`
- `tests/acp/agent-connector.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Connector Recovery Ownership Verification Before Teardown`
- `Gate-Context Restoration And Recovery Hook In Connector Recovery`
- `Recovery Context Threading And Failure Classification In Session Runs`
- `OMP Recovery Cannot Select a Context-Free Legacy Path`

**對應封存變更**：`openspec/changes/archive/2026-10-13-thread-per-spawn-omp-recovery-context`
**相關文件**：`docs/OMP_RECOVERY.md`
