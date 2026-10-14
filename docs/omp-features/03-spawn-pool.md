# 3. 啟動與行程池

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 4」。

本頁收錄「OMP 行程怎麼被啟動」以及「不同權限模式的行程如何被隔離」的相關功能。

## 3.1 依模式啟動 OMP 代理行程

**白話說明**
同一種代理，在「受限模式」與「YOLO 模式」下需要完全不同的啟動方式。這項功能讓 OMP 的啟動指令依模式分別組裝：受限模式載入受限設定、固定非 YOLO 的原生批准模式；YOLO 模式載入自己的設定、不套用任何受限夾具，而且**不透過全行程開關**切換，避免同一支行程狀態被汙染。兩種模式的可變狀態（家目錄、暫存目錄、資料目錄、啟動工作目錄）都放在各自專屬的命名空間下。同時，受信任擴充模組的路徑以固定方式接線，任何無法確保的情況都直接讓啟動失敗，而不是猜測放行。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/agent-factory.ts:45` | `createAgentConfig()`：OMP 啟動分支 |
| `src/acp/agent-factory.ts:142` | `finalizeOmpSpawnEnvironment()`：啟動環境最終化 |
| `src/acp/agent-factory.ts:548` | `getSessionModeOverride()`：OMP 恆為 `null`（不用 OpenCode 式模式切換） |
| `src/utils/omp-paths.ts:162-204` | `ompProcessStateRoot` / `ompAgentDir` / `ompProcessTmpDir` / `ompLaunchCwd` / `ompXdgDataHome` / `ompOwnedHome`（模式專屬路徑） |
| `src/acp/omp/deployment-module.ts:162` | `selectLaunchDeploymentModule()`：由模組 URL 綁定部署身分 |
| `src/acp/omp/skill-root-declaration.ts:61` | `writeOmpSkillRootDeclaration()`：寫出單鍵技能根目錄宣告 |

**測試位置**
- `tests/acp/agent-factory-omp.test.ts`
- `tests/acp/omp-skill-root-declaration.test.ts`
- `tests/acp/omp-native-registration.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Mode-Scoped OMP Spawn Resolution`
- `Restricted OMP Launch Argument Assembly`
- `Native-YOLO OMP Launch Assembly Without Restricted Clamps`
- `Mode-Distinct OMP Process State Ownership`
- `Canonical Payload Staging Independent of OMP Process State`
- `Immutable Trusted-Extension Path Wiring With Fail-Closed Launch`
- `OMP Environment and Egress Pass-Through Without New Rules`
- `OpenCode Launch Non-Regression`

**對應封存變更**：`openspec/changes/archive/2026-10-09-spawn-mode-scoped-omp-agents`
**相關文件**：`docs/OMP_SPAWN.md`

## 3.2 依模式隔離的共享行程池

**白話說明**
為了效能，系統會讓同一個對話重複使用同一支代理行程（行程池）。但「受限」與「YOLO」是兩種安全等級，混用會出問題。這項功能把行程池的鍵值加上「代理類型 + 實際權限模式」，讓不同模式的請求一定拿到不同的行程；而且權限模式必須在「取得行程之前」就先解析完成，不允許事後才決定。OpenCode 的既有池共用行為完全不受影響，全域的租約序列化也維持不變。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/core/agent-process-pool.ts:61` | `composePoolEntryKey()`：OMP 才把模式併入鍵值 |
| `src/core/agent-process-pool.ts:74-95` | `PoolRunOptions.agentType` / `permissionMode` 與池內條目結構 |
| `src/acp/recovery-ownership.ts:25` | `SessionRecoveryOwnership`：取得時寫入的所有權記錄 |
| `src/core/session-orchestrator.ts` | 各流程在 `createAgentConfig` / `pool.run` 之前先解析 `permissionMode` |

**測試位置**
- `tests/core/omp-pool-modes.test.ts`
- `tests/core/agent-process-pool.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Per-Spawn OMP Mode Distinctness And Shared-Process Skill Identity Invariants`
- `openspec/specs/acp-integration/spec.md` — `Session Ownership Record Written At Acquisition`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Per-Channel Shared ACP Process Pool`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Effective Permission Mode Resolution Before Acquisition`
- `openspec/specs/shared-acp-process-pool/spec.md` — `Mode-Split Pools Preserve Global Lease Serialization`
- `openspec/specs/shared-acp-process-pool/spec.md` — `OpenCode Pool Reuse Unchanged By Mode Splitting`

**對應封存變更**：`openspec/changes/archive/2026-10-09-isolate-omp-process-pools-by-mode`
**相關文件**：`docs/OMP_POOL_MODES.md`、`docs/OMP_SPAWN.md`
