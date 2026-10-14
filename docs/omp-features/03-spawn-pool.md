# 3. 啟動與行程池

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 4」。

本頁收錄「OMP 行程怎麼被啟動」以及「不同權限模式的行程如何被隔離」的相關功能。

## 3.1 依模式啟動 OMP 代理行程

> **處置：保留（簡化狀態路徑）。** 原生啟動政策不變；設定產生、重驗與多餘狀態路徑已移除。

**白話說明**
同一種代理，在「受限模式」與「YOLO 模式」下需要完全不同的啟動方式。這項功能讓 OMP 的啟動指令依模式分別組裝：受限模式載入受限模式的原生設定並帶上受限能力擴充；原生 YOLO 模式載入自己的設定、**不**載入能力擴充，並且**不透過全行程開關**切換模式（`getSessionModeOverride()` 對 OMP 恆為 `null`）。可變的原生狀態只在原生確實需要時才依模式區分：原生資料目錄（session／database／auth 附帶檔）走 `$XDG_DATA_HOME/omp`，而該 `XDG_DATA_HOME` 由 `ompXdgDataHome()` 依模式產生（`{baseRoot}/omp-agent/{mode}/xdg-data`），必須在 spawn 前先建立。行程工作目錄（cwd）與 `TMPDIR` 沿用一般啟動慣例、**不**依模式區分；設定 HOME 維持正常繼承的部署 HOME，原生 OMP 自 `~/.omp/agent/models.yml` 讀取模型設定。受信任擴充模組的路徑以 `resolveOmpExtensionPath()` 接線，並以唯讀掛載暴露；受限模式下缺少必要的產出檔會直接讓啟動失敗並提示建置指令，而不是猜測放行。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/agent-factory.ts:239-388` | OMP 啟動分支（`createAgentConfig`） |
| `src/acp/agent-factory.ts:403` | `getSessionModeOverride()`：OMP 恆為 `null`（不用 OpenCode 式模式切換） |
| `src/utils/omp-paths.ts:80-137` | `resolveOmpConfigPath()` / `resolveOmpExtensionPath()` / `resolveOmpSystemPromptPath()` dev→image 路徑解析 |
| `src/utils/omp-paths.ts:158` | `ompXdgDataHome()`：模式專屬原生 `XDG_DATA_HOME` |
| `src/acp/filesystem-confinement.ts` | 唯讀／可寫掛載清單（所選原生設定、提示、擴充、模型檔；原生資料子目錄） |

**測試位置**
- `tests/acp/agent-factory-omp.test.ts`
- `tests/acp/omp-native-runtime-smoke.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Native OMP Approval Mode Selection At Process Launch`
- `Restricted Native OMP ACP Launch`
- `Permissive Native OMP ACP Launch With Explicit LSP Denial`
- `Native OMP Mode Data And Session Staging Separation`
- `Native OMP Generated Extension Asset Selection`
- `Native OMP Shared Environment And Egress Behavior`
- `Canonical Payload Staging Independent of OMP Process State`
- `OpenCode Launch Non-Regression`

**對應封存變更**：`openspec/changes/archive/2026-10-09-spawn-mode-scoped-omp-agents`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_SPAWN.md`

## 3.2 依模式隔離的共享行程池

> **處置：保留（不變）。**

**白話說明**
為了效能，系統會讓同一個對話重複使用同一支代理行程（行程池）。但「受限」與「YOLO」是兩種安全等級，混用會出問題。這項功能把行程池的鍵值加上「代理類型 + 實際權限模式」，讓不同模式的請求一定拿到不同的行程；而且權限模式必須在「取得行程之前」就先解析完成，不允許事後才決定。OpenCode 的既有池共用行為完全不受影響（其池鍵維持原樣、不含模式維度），全域的租約序列化也維持不變。OpenCode 的取得所有權記錄與其唯讀的復原消費維持不變；OMP 則保留其解析後的路徑模式與稽核觀察，**不再**為復原額外要求所有權記錄。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/core/agent-process-pool.ts:60` | `poolEntryKey()`：僅 OMP 才把模式併入鍵值（`${poolKey}:${permissionMode}`） |
| `src/core/agent-process-pool.ts:71-102` | `PoolRunOptions.agentType` / `permissionMode` 與池內條目結構 |
| `src/acp/recovery-ownership.ts` | `SessionRecoveryOwnership` 與所有權驗證（供 OpenCode 復原使用） |
| `src/acp/agent-connector.ts:1167-1197` | OMP 復原不呼叫 `verifyRecoveryOwnership`；OpenCode 仍驗證 |
| `src/core/session-orchestrator.ts` | 各流程在 `createAgentConfig` / `pool.run` 之前先解析 `permissionMode` |

**測試位置**
- `tests/core/omp-pool-modes.test.ts`
- `tests/core/agent-process-pool.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Per-Spawn OMP Mode Distinctness And Shared-Process Skill Identity Invariants`
- `openspec/specs/acp-integration/spec.md` — `OpenCode Acquisition Ownership Bookkeeping`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Global Session Serialization`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Effective Permission Mode Resolution Before Acquisition`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Mode-Split Pools Preserve Global Lease Serialization`
- `openspec/specs/shared-acp-process-pool/spec.md` — `OpenCode Pool Reuse Unchanged By Mode Splitting`
- `openspec/specs/shared-acp-process-pool/spec.md` — `OMP Mode Pools Recover Through Their Existing Connector`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Shared ACP Pool Entry Lease And Native Data Identity`

**對應封存變更**：`openspec/changes/archive/2026-10-09-isolate-omp-process-pools-by-mode`、`openspec/changes/archive/2026-10-15-simplify-omp-recovery-context`
**相關文件**：`docs/OMP_POOL_MODES.md`、`docs/OMP_SPAWN.md`
