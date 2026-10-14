# 11. 測試套件與文件同步

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 11」。

**白話說明（整體）**
上面每一項功能都有自己的決策單元測試，但單元測試無法證明「真實元件串起來後還正確」。這頁收錄三項「整合驗證」「誠實記錄」類的功能。

## 11.1 模擬 ACP 生命週期整合測試

> **處置：保留（消費者行為）；治理姿態斷言已刪除。**

**白話說明**
這是一組**完全離線、不連網、不呼叫真實模型**的整合測試，用模擬的 ACP 子行程與連線，驅動真實的連接器、行程池與排程器，涵蓋正常生命週期、共用復原、模式共存與租約序列化、回呼拒絕，以及 OpenCode 的非回歸流程。證據一律與真實原生執行檔與映像驗收分開標示，不得由本套件推論原生或映像層級的結論。

**主要實作**

| 位置 | 說明 |
|---|---|
| `tests/integration/omp-lifecycle/lifecycle.integration.test.ts` | 生命週期整合案例 |
| `tests/integration/omp-lifecycle/opencode-regression.integration.test.ts` | OpenCode 非回歸 |
| `tests/mocks/omp-mock-session.ts` | 共用模擬 session 建構器 |
| `tests/mocks/mock-acp-agent.ts` | 模擬 ACP 子行程 |
| `tests/mocks/mock-acp-connection.ts` | 模擬 ACP 連線 |

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Consumer ACP Lifecycle And Mode Recovery Regression Suite`
- `Lifecycle Suite Determinism and Execution Boundaries`
- `Shared Native-Shaped OMP Mock Session Composition`

**對應封存變更**：`openspec/changes/archive/2026-10-11-cover-omp-mocked-acp-lifecycle`

## 11.2 消費者技能交接整合測試

> **處置：保留（真實元件鏈路 + 工作階段隔離）。**

**白話說明**
這組整合測試把「提示渲染 → 技能 API 伺服器 → session 註冊表 → 回覆／檔案／反應處理器 → 平台投遞」整條路徑用真實元件串起來，只有 ACP 代理子行程與平台適配器是模擬的。它驗證的是：部署解析出的同一個技能根目錄下的技能說明讀取、暫存檔建立與字面絕對腳本呼叫都通過真實授權；正確的 session 識別與暫存路徑真的能一路傳到處理器；最終只會送出「預期的那一次」回覆，不會出現重複投遞；兄弟 session 的憑證／暫存路徑由共用規則拒絕；缺少回應時只依現行規則重試一次。兩種行程形狀（per-spawn 與 pooled）都涵蓋。

**證據邊界**：此套件實際執行的是真實排程、真實 Skill API 與處理器、真實技能腳本，加上模擬的 ACP 代理與模擬平台適配器。原生 OMP 執行檔、映像與真實平台交付**不在**此套件範圍內，其證據由原生驗證單元另行分別記錄，不得由本套件推論。跨元件套件即 `tests/integration/omp-skill-handoff/`。

**主要實作**

| 位置 | 說明 |
|---|---|
| `tests/integration/omp-skill-handoff/handoff.integration.test.ts` | 技能交接整合案例 |
| `tests/integration/omp-skill-handoff/skill-credential-swap.ts` | 憑證交換輔助 |
| `tests/mocks/omp-mock-session.ts` | 共用模擬 session |
| `tests/skills/staging-compat.test.ts` | 暫存路徑相容性 |
| `tests/core/session-staging.test.ts` | session 暫存 |

**規格需求**
- `openspec/specs/skills-and-reply/spec.md` — `Consumer Skill Handoff Regression Suite`
- `openspec/specs/skills-and-reply/spec.md` — `Skill Handoff Evidence And Deterministic Native Fixtures`
- `openspec/specs/skills-and-reply/spec.md` — `Shell-Based Skill Execution`
- `openspec/specs/skills-and-reply/spec.md` — `Agent-Portable Staging And Session Identity`

**對應封存變更**：`openspec/changes/archive/2026-10-11-finish-omp-mocked-skill-handoff`
**相關文件**：`docs/USER-RUNTIME-VERIFICATION.md`

## 11.3 邊界修正的文件與決策同步

> **處置：保留（更新現行文件／規格）。**

**白話說明**
批次作業進行到後期，有些文件仍在描述「尚未實作」的舊狀態，或把原始 TypeScript 說成是實際載入的擴充模組。這項功能把文件校正到現況：把已封存的基準變更與提案當時的證據明確標為**歷史**、把啟動與封裝文件改為描述實際載入的產出 bundle，並修正前次對 OpenCode 工作區探索的錯誤結論。

**主要實作**（文件）
- `docs/OMP_SPAWN.md`、`docs/OMP_SETTINGS.md`、`docs/OMP_TOOL_POLICY.md`、`docs/OMP_ENFORCEMENT.md`、`docs/OMP_PACKAGING.md`、`docs/OMP_RECOVERY.md`、`docs/OMP_POOL_MODES.md`
- `docs/OMP_DISCOVERY.md`、`docs/OMP_NETWORK.md`、`docs/OMP_COMPATIBILITY.md`（現記錄已移除機制的歷史）
- `AGENTS.md` 中的「Batch Configuration-Documentation Consistency Audit」對照表
- `openspec/changes/archive/` 內各變更的 `proposal.md` / `design.md` / `tasks.md`

**測試位置**
- `tests/utils/config-trio-sync.test.ts`（設定三檔案同步一致性，fail-closed）

**規格需求**（`openspec/specs/configuration-and-deployment/spec.md`）
- `Current OMP Parity Documentation And Evidence`
- `Batch Configuration-Documentation Consistency Audit`
- `Single User-Runtime Verification Checklist Artifact`
- `Batch Documentation Final-Consistency Pass`
- `Current Native OMP Artifact And Configuration Documentation`

**對應封存變更**：`openspec/changes/archive/2026-10-13-synchronize-omp-seam-correction-docs`
