# 11. 測試套件與文件同步

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 11」。

**白話說明（整體）**
上面每一項功能都有自己的決策單元測試，但單元測試無法證明「真實元件串起來後還正確」。這頁收錄三項「整合驗證」「誠實記錄」類的功能。

## 11.1 模擬 ACP 生命週期整合測試

**白話說明**
這是一組**完全離線、不連網、不呼叫真實模型**的整合測試，用模擬的 ACP 子行程與連線，驅動真實的連接器、行程池與排程器，涵蓋生命週期、所有權、設定、處理器可用性與登記表新鮮度。它同時要求「誠實姿態」斷言：失敗關閉（fail-closed）的行為必須被實際驗證，而不是只驗證字串或轉呼叫。

**主要實作**

| 位置 | 說明 |
|---|---|
| `tests/integration/omp-lifecycle/lifecycle.integration.test.ts` | 生命週期整合案例 |
| `tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts` | 執行強制合成案例 |
| `tests/integration/omp-lifecycle/opencode-regression.integration.test.ts` | OpenCode 非回歸 |
| `tests/mocks/omp-mock-session.ts` | 共用模擬 session 建構器 |
| `tests/mocks/mock-acp-agent.ts` | 模擬 ACP 子行程 |

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Combined Mock-ACP Lifecycle Integration Suite`
- `Fail-Closed Honest Posture Assertions in the Lifecycle Suite`
- `Shared OMP Mock Session Builder Contract`
- `Lifecycle Suite Determinism and Execution Boundaries`
- `Non-Duplication and Justified Deletion Rule for the Lifecycle Suite`

**對應封存變更**：`openspec/changes/archive/2026-10-11-cover-omp-mocked-acp-lifecycle`

## 11.2 模擬技能交接整合測試

**白話說明**
這組整合測試把「提示渲染 → 技能 API 伺服器 → session 註冊表 → 回覆／檔案／反應處理器 → 平台投遞」整條路徑用真實元件串起來，只有 ACP 代理與平台適配器是模擬的。它驗證的是：正確的 session 識別與暫存路徑真的能一路傳到處理器，且最終只會送出「預期的那一次」回覆，不會出現重複或退回機制造成的二次投遞。

**主要實作**

| 位置 | 說明 |
|---|---|
| `tests/integration/omp-skill-handoff/handoff.integration.test.ts` | 技能交接整合案例 |
| `tests/integration/omp-skill-handoff/skill-credential-swap.ts` | 憑證交換輔助 |
| `tests/mocks/omp-mock-session.ts` | 共用模擬 session |
| `tests/skills/staging-compat.test.ts` | 暫存路徑相容性 |
| `tests/core/session-staging.test.ts` | session 暫存 |

**規格需求**
- `openspec/specs/skills-and-reply/spec.md` — `Combined Mocked Skill-Handoff Regression Suite`
- `openspec/specs/skills-and-reply/spec.md` — `Skill-Handoff Suite Honest Posture and Determinism`
- `openspec/specs/skills-and-reply/spec.md` — `Shell-Based Skill Execution`
- `openspec/specs/skills-and-reply/spec.md` — `Agent-Portable Staging And Session Identity`
- `openspec/specs/configuration-and-deployment/spec.md` — `Batch Configuration-Documentation Consistency Audit`
- `openspec/specs/configuration-and-deployment/spec.md` — `Single User-Runtime Verification Checklist Artifact`

**對應封存變更**：`openspec/changes/archive/2026-10-11-finish-omp-mocked-skill-handoff`
**相關文件**：`docs/USER-RUNTIME-VERIFICATION.md`

## 11.3 邊界修正的文件與決策同步

**白話說明**
批次作業進行到後期，有些文件仍在描述「尚未實作」的舊狀態，或把原始 TypeScript 說成是實際載入的擴充模組。這項功能把文件校正到現況：標明已封存的基準變更、區分「提案當時的證據」與「目前狀態」、把啟動／探索文件改為描述實際載入的產出 bundle，並補上所有權／相依／衝突對照表。

**主要實作**（文件）
- `docs/OMP_COMPATIBILITY.md`、`docs/OMP_DISCOVERY.md`、`docs/OMP_ENFORCEMENT.md`、`docs/OMP_NETWORK.md`、`docs/OMP_PACKAGING.md`、`docs/OMP_POOL_MODES.md`、`docs/OMP_RECOVERY.md`、`docs/OMP_SETTINGS.md`、`docs/OMP_SPAWN.md`、`docs/OMP_TOOL_POLICY.md`
- `AGENTS.md` 中的「Batch Configuration-Documentation Consistency Audit」對照表
- `openspec/changes/archive/` 內各變更的 `proposal.md` / `design.md` / `tasks.md`

**測試位置**
- `tests/utils/config-trio-sync.test.ts`（設定三檔案同步一致性，fail-closed）

**規格需求**（`openspec/specs/configuration-and-deployment/spec.md`）
- `Current OMP Batch Documentation Distinguishes Archived Baseline and Proposed Corrections`
- `OMP Launch Documentation Names the Generated Deployment Artifact`
- `OMP Boundary Documentation Preserves Evidence Limits`
- `Batch Documentation Final-Consistency Pass`
- `Final OMP Decision Register And Batch Synchronization`

**對應封存變更**：`openspec/changes/archive/2026-10-13-synchronize-omp-seam-correction-docs`
