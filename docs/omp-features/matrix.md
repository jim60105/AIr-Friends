# 總表：一覽全部功能

> **本表描述 OMP 整合在 `cutover-omp-native-runtime`（2026-10-15）之後的現行行為。**
> 「主要實作／測試／規格需求檔」三欄只列**目前樹狀結構中實際存在**的檔案；連同 `已移除`
> 的項目在內，編號 1–37 一列都沒有省略。
>
> - 現行的啟動、設定、工具政策、強制執行、封裝與復原說明，以 [OMP 啟動與模式](../OMP_SPAWN.md)、
>   [OMP 設定](../OMP_SETTINGS.md)、[OMP 工具政策](../OMP_TOOL_POLICY.md)、
>   [OMP 強制執行](../OMP_ENFORCEMENT.md)、[OMP 封裝](../OMP_PACKAGING.md)、
>   [OMP 復原](../OMP_RECOVERY.md) 為準。
> - `src/acp/omp-settings.ts`、`src/acp/omp/{compatibility-contracts,settings-sources,executable-sources,discovery-guard,deployment-module,owned-module-evidence,owned-skills,tool-provenance,tool-enforcement-wiring,approval-records,record-evaluator,destructive-decision,skill-root-declaration}.ts`、
>   `src/acp/omp/fetch-*`、`src/acp/omp/search-*` 與其測試檔**均已刪除**（見下方「已移除的機制」）。
> - 原 37 項設計處置表（含 migration 前的臆測機制）為**歷史設計材料**，保留於
>   `docs/superpowers/specs/2026-10-14-omp-opencode-parity-simplification-design.md`、
>   `docs/omp-features/` 各頁的「歷史」段落與 `openspec/changes/archive/`；不得視為現行行為。

下表把本文件所有功能列在一起，方便快速查找。分類頁連結見左側選單。「處置」欄說明該項在 `cutover-omp-native-runtime` 之後的狀態。

> 每一項的 **OpenCode 側做法與差異** 見 [12. OpenCode 對照](12-opencode-comparison.md)。

| # | 功能名稱 | 分類頁 | 處置 | 主要實作 | 測試 | 規格需求檔 |
|---|---|---|---|---|---|---|
| 1 | 可選的第二種代理：OMP | [1](01-agent-config.md) | 保留（不變） | `src/acp/types.ts`、`src/acp/agent-factory.ts`、`src/acp/sandbox-manager.ts`、`src/core/config-loader.ts` | `tests/acp/agent-factory-omp.test.ts`、`tests/core/config-loader.test.ts`、`tests/utils/env.test.ts`、`tests/acp/sandbox-manager.test.ts` | `acp-integration` — `Supported Agent Types`、`Agent Common Environment`；`configuration-and-deployment` — `Deployment Agent Type Value Domain And Synchronization`；`web-dashboard-chat` — `Chat Session Connection`、`Dashboard Chat Offers Both Supported Agent Types` |
| 2 | 上游相容性契約與稽核 | [2](02-settings.md) | 已移除（僅存歷史證據） | 無（治理帳本已刪除） | 無 | 無現行需求（歷史：`openspec/changes/archive/2026-10-08-establish-omp-compatibility-contracts`、設計文件 §2） |
| 3 | 模式分離的自有設定內容 | [2](02-settings.md) | 保留（簡化為手寫原生 YAML） | `agent-config/omp/restricted.yml`、`agent-config/omp/native-yolo.yml`、`agent-config/omp/models.yml`、`prompts/system_prompt_override.md`、`src/acp/agent-factory.ts` | `tests/acp/agent-factory-omp.test.ts`、`tests/acp/omp-native-runtime-smoke.test.ts` | `acp-integration` — `Handwritten Native OMP Configuration Consumption`、`Authored Native OMP Provider Configuration And Identity`、`Authored Native OMP Compaction Update And Prompt Behavior` |
| 4 | 自有設定探索來源隔離 | [2](02-settings.md) | 保留（簡化：移除身分／預檢閘門） | `src/acp/sandbox-manager.ts`、`src/acp/agent-factory.ts` | `tests/acp/sandbox-manager.test.ts`、`tests/acp/agent-connector-env-isolation.test.ts` | `acp-integration` — `Shared Agent Environment Filtering With Native OMP Discovery` |
| 5 | 兩種模式都停用 LSP | [2](02-settings.md) | 保留（簡化為原生工具拒絕） | `agent-config/omp/restricted.yml`、`agent-config/omp/native-yolo.yml`（`tools.approval.lsp: deny`） | `tests/acp/agent-factory-omp.test.ts`、`tests/integration/omp-native-runtime/native-runtime.integration.test.ts`、`tests/acp/omp-native-runtime-smoke.test.ts`（僅 init／catalog／load／mount 證據） | `acp-integration` — `OMP Native Capability Policy Parity`、`Permissive Native OMP ACP Launch With Explicit LSP Denial`、`OpenCode Both Agents Explicitly Deny The LSP Tool` |
| 6 | 依模式啟動 OMP 代理行程 | [3](03-spawn-pool.md) | 保留（簡化狀態路徑） | `src/acp/agent-factory.ts`、`src/utils/omp-paths.ts`、`src/acp/filesystem-confinement.ts`、`src/acp/sandbox-manager.ts` | `tests/acp/agent-factory-omp.test.ts`、`tests/acp/omp-native-runtime-smoke.test.ts` | `acp-integration` — `Native OMP Approval Mode Selection At Process Launch`、`Restricted Native OMP ACP Launch`、`Permissive Native OMP ACP Launch With Explicit LSP Denial`、`Native OMP Mode Data And Session Staging Separation`、`Native OMP Generated Extension Asset Selection`、`Native OMP Shared Environment And Egress Behavior`、`OpenCode Launch Non-Regression` |
| 7 | 依模式隔離的共享行程池 | [3](03-spawn-pool.md) | 保留（不變） | `src/core/agent-process-pool.ts`、`src/acp/recovery-ownership.ts` | `tests/core/omp-pool-modes.test.ts`、`tests/core/agent-process-pool.test.ts` | `acp-integration` — `Per-Spawn OMP Mode Distinctness And Shared-Process Skill Identity Invariants`、`OpenCode Acquisition Ownership Bookkeeping`；`shared-acp-process-pool` — `Global Session Serialization`、`Effective Permission Mode Resolution Before Acquisition`、`Mode-Split Pools Preserve Global Lease Serialization`、`OpenCode Pool Reuse Unchanged By Mode Splitting`、`OMP Mode Pools Recover Through Their Existing Connector`、`Shared ACP Pool Entry Lease And Native Data Identity` |
| 8 | 載入前可執行模組排除與關鍵技能所有權 | [4](04-enforcement.md) | 已移除 | 無（`discovery-guard` 已刪除） | 無 | 無現行需求（歷史：`openspec/changes/archive/2026-10-09-guard-omp-executable-discovery`） |
| 9 | 工作區可執行檔預檢 | [4](04-enforcement.md) | 已移除 | 無（`executable-sources` 已刪除） | 無 | 無現行需求（歷史：`openspec/changes/archive/2026-10-12-check-omp-workspace-executables`） |
| 10 | 受限工具清單決策 | [4](04-enforcement.md) | 保留（簡化為能力對照表 + 預設拒絕） | `src/acp/omp/tool-inventory.ts` | `tests/acp/omp-restricted-tool-decisions.test.ts`、`tests/acp/omp-native-registration.test.ts` | `acp-integration` — `OMP Native Capability Policy Parity`、`Native OMP Capability Admission Before Tool Dispatch` |
| 11 | 工具呼叫的執行期強制 | [4](04-enforcement.md) | 保留（簡化為原生 callback 預設拒絕 + 共用 ACP 閘門） | `src/acp/omp/extension/native-registration.ts`、`src/acp/omp/extension/index.ts`、`src/acp/omp/tool-inventory.ts`、`src/acp/client.ts` | `tests/acp/omp-native-registration.test.ts`、`tests/acp/permission-gate-generic.test.ts`、`tests/acp/client.test.ts` | `acp-integration` — `Native OMP Capability Admission Before Tool Dispatch`、`Permission Handling — Restricted Mode` |
| 12 | 原生擴充 API 接線 | [4](04-enforcement.md) | 保留（官方 `on("tool_call")`） | `src/acp/omp/extension/native-registration.ts`、`src/acp/omp/extension/index.ts` | `tests/acp/omp-native-registration.test.ts` | `acp-integration` — `Native OMP Capability Admission Before Tool Dispatch`、`Restricted Native OMP ACP Launch` |
| 13 | 承認受信任的原生內建工具 | [4](04-enforcement.md) | 已移除（來源 tuple 認證）；改按能力政策 | `src/acp/omp/tool-inventory.ts` | `tests/acp/omp-restricted-tool-decisions.test.ts` | `acp-integration` — `OMP Native Capability Policy Parity`、`Native OMP Local Read And Search Behavior` |
| 14 | 自有模組的實體部署證據 | [4](04-enforcement.md) | 已移除；改用一般安裝慣例 | `Containerfile`、`src/utils/omp-paths.ts`（僅 dev→image 路徑解析） | `tests/acp/omp-owned-module-bundle-smoke.test.ts`、`tests/utils/omp-packaging.test.ts` | `container-packaging` — `OMP Artifact Installation Uses Existing Project Conventions`、`Development-Path to Image-Path Resolution Contract` |
| 15 | 破壞性操作的完整性與授權 | [5](05-destructive.md) | 保留（共用解碼器 + 新增 OMP 入口正規化） | `src/acp/destructive-policy.ts`、`src/acp/omp/destructive-ingress.ts`、`src/acp/client.ts` | `tests/acp/destructive-policy.test.ts`、`tests/acp/client.test.ts` | `acp-integration` — `Parser-Bounded Shared Destructive Operation Normalization`、`All-Target Destructive Authorization Under The Common Policy`、`OMP Destructive Permission Input Normalization`、`OMP Destructive Binding And Diagnostic Integrity` |
| 16 | 檔案系統邊界：候選根目錄與實體路徑 | [5](05-destructive.md) | 保留（不變） | `src/acp/filesystem-roots.ts`、`src/acp/filesystem-access*.ts`、`src/acp/filesystem-policy.ts` | `tests/acp/filesystem-roots.test.ts`、`tests/acp/filesystem-access.test.ts`、`tests/acp/filesystem-access-linux.test.ts`、`tests/acp/filesystem-policy.test.ts`、`tests/acp/filesystem-authorization.test.ts` | `acp-integration` — `Contextual ACP Filesystem Path Resolution`、`Canonical ACP Session Root Identity`、`Canonical ACP Existing and Prospective Target Decisions`、`Secure ACP Canonical Observation Consumption` 等系列 |
| 17 | 工作區系統呼叫圍籬 | [5](05-destructive.md) | 保留（不變）；新增所選原生資產／資料輸入 | `src/acp/filesystem-confinement.ts`、`src/acp/sandbox-manager.ts` | `tests/acp/filesystem-confinement.test.ts` | `acp-integration` — `Native OMP Assets And Data Reachability Under Shared Confinement`；`agent-sandbox-hardening` — `Agent Filesystem Confinement`、`Shared Resolved Skill Tree Has Read-Only Runtime Visibility` |
| 18 | 一般命令的路徑參數閘門 | [5](05-destructive.md) | 保留（不變） | `src/acp/command-path-policy.ts`、`src/acp/command-syntax.ts` | `tests/acp/command-path-canonical.test.ts`、`tests/acp/permission-gate-generic.test.ts` | `acp-integration` — `Canonical Generic-Command Path Argument Decision`、`Generic-Command Policy Parity Under Canonicalization`；`agent-sandbox-hardening` — `Generic-Command Workspace Confinement` |
| 19 | 技能腳本清單與自動批准 | [5](05-destructive.md) | 保留（不變） | `src/acp/skill-inventory.ts` | `tests/acp/skill-inventory.test.ts` | `acp-integration` — `Skill Auto-Approve List Construction Over the Single Resolved Root`、`Root-Exact Script Entrypoint Approval`、`Inventory Denial Invariants Survive The Ownership Relaxation` |
| 20 | 受控 URL 讀取傳輸 | [6](06-network.md) | 已移除；改用原生讀取 | 無（`fetch-*`／`read-replacement` 已刪除）；能力由 `src/acp/omp/tool-inventory.ts`（`read`）對應 | `tests/integration/omp-native-runtime/native-runtime.integration.test.ts`、`tests/acp/omp-native-runtime-smoke.test.ts`（僅 init／catalog／load／mount 證據） | `acp-integration` — `Native OMP Local Read And Search Behavior`、`OMP Native Capability Policy Parity` |
| 21 | 受控網頁搜尋 | [6](06-network.md) | 已移除；改用原生搜尋 | 無（`search-*`／`search-replacement` 已刪除）；能力由 `src/acp/omp/tool-inventory.ts`（`web_search`）對應 | `tests/integration/omp-native-runtime/native-runtime.integration.test.ts`、`tests/acp/omp-native-runtime-smoke.test.ts`（僅 init／catalog／load／mount 證據） | `acp-integration` — `Native OMP Local Read And Search Behavior`、`OMP Native Capability Policy Parity` |
| 22 | 網路替換工具的放行閘門 | [6](06-network.md) | 已移除 | 無 | 無 | 無現行需求 |
| 23 | 替換工具的原生介面契約 | [6](06-network.md) | 已移除 | 無 | 無 | 無現行需求 |
| 24 | 公開程式碼搜尋（移除） | [6](06-network.md) | 不重建 | 無 | 無 | 無現行需求（歷史：`openspec/changes/archive/2026-10-10-adapt-omp-public-code-search`、`2026-10-12-remove-omp-public-code-search`） |
| 25 | 部署方宣告的技能根目錄設定 | [7](07-skills.md) | 保留（改為手寫 YAML，刪除啟動期宣告產生） | `agent-config/omp/restricted.yml`、`agent-config/omp/native-yolo.yml`（`skills.customDirectories`）、`src/acp/agent-factory.ts` | `tests/acp/agent-factory-omp.test.ts` | `acp-integration` — `Handwritten Native OMP Configuration Consumption` |
| 26 | 自有技能的讀取與交接修復 | [7](07-skills.md) | 保留（原生 `skill://` 讀取；共用腳本根／提示／交接不變） | `src/core/skills-root.ts`、`src/acp/skill-inventory.ts`、`prompts/skills_root.md`、`src/acp/agent-factory.ts` | `tests/integration/omp-skill-handoff/handoff.integration.test.ts`、`tests/core/skills-root.test.ts`、`tests/core/skill-root-wiring.test.ts` | `skills-and-reply` — `Agent-Portable Staging And Session Identity`、`Deployment-Resolved Skill Script Root Identity for Both Agent Types`；`prompt-template-system` — `Skill-Instructing Templates Receive the Trusted Script Root` |
| 27 | 技能信任對齊共用根目錄 | [7](07-skills.md) | 已移除（信任階梯）；由共用根目錄解析承擔 | `src/core/skills-root.ts`（共用，非 OMP 專屬） | `tests/core/skills-root.test.ts`、`tests/core/skill-root-wiring.test.ts` | `acp-integration` — `Shared Deployment Skills Root In ACP Callbacks` |
| 28 | 統一技能根目錄解析 | [7](07-skills.md) | 保留（不變） | `src/core/skills-root.ts`、`src/acp/skill-inventory.ts`、`src/acp/sandbox-manager.ts`、`Containerfile` | `tests/core/skills-root.test.ts`、`tests/core/skill-root-wiring.test.ts`、`tests/core/skill-installer.test.ts`、`tests/core/external-skill-publication-parity.test.ts` | `configuration-and-deployment` — `One Configured Skill Root For Every Agent Type`、`Stock Image Declares the Shared Skill Install Root`、`External Skill Auto-Installation Into the Single Skill Root`；`container-packaging` — `Single Authored Skill Tree Shared By Every Agent`；`skills-and-reply` — `Deployment-Resolved Skill Script Root Identity for Both Agent Types` |
| 29 | 固定版本的 OMP 執行檔與封裝 | [8](08-extension-packaging.md) | 保留（釘選＋checksum＋版本健康） | `Containerfile`、`src/utils/omp-version.ts`、`src/bootstrap.ts` | `tests/utils/omp-packaging.test.ts`、`tests/utils/omp-version.test.ts` | `agent-version-compatibility` — `Bootstrap OMP Version Compatibility Check`、`OMP Version Minimum Environment Override`、`OMP Version Health Acceptance Is Mock-Only`；`container-packaging` — `Pinned Official OMP Executable With Fail-Closed Checksum Verification`、`Official License and Third-Party Notices Installed and Verified`、`OMP Artifact Installation Uses Existing Project Conventions` |
| 30 | 可被原生載入的擴充套件綑綁 | [8](08-extension-packaging.md) | 保留（單一 ESM；移除信任證據／宣告） | `scripts/omp/bundle-extension.ts`、`scripts/omp/bundle-audit.ts`、`scripts/omp/bundle-omp-extension.sh`、`src/utils/omp-paths.ts` | `tests/acp/omp-owned-module-bundle-smoke.test.ts`、`tests/mocks/omp-bundle-smoke-driver.ts` | `container-packaging` — `Native OMP Single ESM Code Artifact`、`Development-Path to Image-Path Resolution Contract`、`OMP Artifact Installation Uses Existing Project Conventions`；`configuration-and-deployment` — `Current Native OMP Artifact And Configuration Documentation` |
| 31 | 受信任擴充模組（整體架構） | [8](08-extension-packaging.md) | 保留（替換治理核心為原生能力差異） | `src/acp/omp/extension/index.ts`、`src/acp/omp/extension/native-registration.ts`、`src/acp/omp/tool-inventory.ts`、`src/acp/omp/destructive-ingress.ts` | `tests/acp/omp-native-registration.test.ts`、`tests/integration/omp-lifecycle/lifecycle.integration.test.ts` | `acp-integration` — `Native OMP Capability Admission Before Tool Dispatch`、`OMP Native Capability Policy Parity` |
| 32 | 逐啟動復原情境的完整串接 | [9](09-recovery.md) | 保留（共用復原；移除 OMP 強制閘門，OpenCode 可選檢查不變） | `src/acp/recovery-ownership.ts`、`src/acp/agent-connector.ts` | `tests/acp/recovery-ownership.test.ts`、`tests/acp/agent-connector.test.ts` | `acp-integration` — `Shared Agent Recovery With OpenCode Context Checks`、`Shared Session Gate Restoration After Native Load`、`Session Runner Recovery Context And Response Fences` |
| 33 | 儀表板可選擇 OMP 代理 | [10](10-dashboard-observability.md) | 保留（不變，不改 UI） | `src/dashboard/server.ts`、`src/dashboard/public/` | `tests/dashboard/server.test.ts`、`tests/dashboard/config.test.ts` | `web-dashboard-chat` — `Chat Session Connection`、`Dashboard Chat Offers Both Supported Agent Types` |
| 34 | 代理思考過程的完整記錄 | [10](10-dashboard-observability.md) | 保留（不變，不改稽核 payload） | `src/acp/client.ts`、`src/core/audit-logger.ts` | `tests/acp/client.test.ts`、`tests/core/audit-logger.test.ts` | `acp-integration` — `Agent Thought Chunk Buffering`、`Agent Thought Chunk Logging with Dual-Format Text Extraction`；`session-audit-log` — `Audit Phases`、`Agent Complete Thought Audit Phase`、`Non-Blocking Audit Logging and Synchronous Timestamps` |
| 35 | 模擬 ACP 生命週期整合測試 | [11](11-testing-docs.md) | 保留（消費者行為；刪除治理姿態斷言） | `tests/integration/omp-lifecycle/**` | 同左 | `acp-integration` — `Lifecycle Suite Determinism and Execution Boundaries`、`Consumer ACP Lifecycle And Mode Recovery Regression Suite` |
| 36 | 模擬技能交接整合測試 | [11](11-testing-docs.md) | 保留（真實元件鏈路 + 工作階段隔離） | `tests/integration/omp-skill-handoff/**`、`tests/mocks/omp-mock-session.ts` | 同左 | `skills-and-reply` — `Consumer Skill Handoff Regression Suite`、`Skill Handoff Evidence And Deterministic Native Fixtures`；`acp-integration` — `Shared Native-Shaped OMP Mock Session Composition` |
| 37 | 邊界修正的文件與決策同步 | [11](11-testing-docs.md) | 保留（更新現行文件／規格） | `docs/omp-features/**`、`docs/OMP_*.md`、`openspec/specs/**` | `tests/utils/config-trio-sync.test.ts` | `configuration-and-deployment` — `Current OMP Parity Documentation And Evidence`、`Batch Configuration-Documentation Consistency Audit`、`Single User-Runtime Verification Checklist Artifact`、`Batch Documentation Final-Consistency Pass`、`Current Native OMP Artifact And Configuration Documentation` |

## 已移除的機制（歷史，非現行行為）

下列治理機制在 `cutover-omp-native-runtime` 中被**刪除**；相關程式模組、測試與 fixtures 均不再存在，對應的規格需求亦已移除。它們只保留為歷史設計證據：

| 機制 | 原承載位置（皆已刪除） | 歷史依據 |
|---|---|---|
| 上游相容性稽核帳本與固定姿態 | `src/acp/omp/compatibility-contracts.ts` 及驗證器 | `openspec/changes/archive/2026-10-08-establish-omp-compatibility-contracts` |
| 自有設定探索來源隔離與身分預檢 | `src/acp/omp/settings-sources.ts` | `openspec/changes/archive/2026-10-11-isolate-omp-settings-discovery` |
| 載入前排除與關鍵技能所有權 | `src/acp/omp/discovery-guard.ts` | `openspec/changes/archive/2026-10-09-guard-omp-executable-discovery` |
| 工作區可執行檔預檢與生命週期接線 | `src/acp/omp/executable-sources.ts` | `openspec/changes/archive/2026-10-12-check-omp-workspace-executables` |
| 工具來源認證、登記表世代與批准記錄 | `src/acp/omp/{tool-provenance,approval-records,record-evaluator}.ts` | `openspec/changes/archive/2026-10-10-define-omp-restricted-tool-decisions` |
| 執行期接線閘門與縫隙 | `src/acp/omp/tool-enforcement-wiring.ts`、`extension/enforcement*.ts` | `openspec/changes/archive/2026-10-10-wire-omp-restricted-tool-enforcement` |
| 實體部署證據與部署模組 | `src/acp/omp/{deployment-module,owned-module-evidence}.ts` | `openspec/changes/archive/2026-10-13-bind-omp-owned-module-evidence` |
| 受控 URL 讀取／網頁搜尋替換傳輸與路由 | `src/acp/omp/fetch-*`、`search-*`、`extension/{read,search}-replacement.ts` | `openspec/changes/archive/2026-10-10-control-omp-url-fetch-transport`、`2026-10-10-adapt-omp-web-search` |
| 網路替換工具完成標記與放行閘門 | `fetch-routes.ts`、`search-routes.ts` | `openspec/changes/archive/2026-10-12-admit-completed-omp-network-adapters` |
| 技能根目錄啟動期宣告產生與唯一來源閘門 | `src/acp/omp/skill-root-declaration.ts` | `openspec/changes/archive/2026-10-13-unify-omp-skill-root-resolution` |
| 關鍵技能身分與技能信任階梯 | `src/acp/omp/owned-skills.ts`、`extension/critical-skills.ts` | `openspec/changes/archive/2026-10-13-align-omp-skill-trust-to-shared-root` |
| 摘要清單 `PACKAGE-MANIFEST.sha256` 與產物摘要政策 | `scripts/omp/generate-omp-manifest.sh` | `openspec/changes/archive/2026-10-15-simplify-omp-container-installation` |
| 專用公開程式碼搜尋 | `src/acp/omp/` 下 public-code-search 執行器與路由 | `openspec/changes/archive/2026-10-12-remove-omp-public-code-search` |

## 規格需求檔對照

現行 `openspec/specs/` 中，實際仍擁有下列能力的需求檔：

| 規格檔 | 相關功能（編號） |
|---|---|
| `openspec/specs/acp-integration/spec.md` | 1、3、4、5、6、7、10、11、12、13、15、16、17、18、19、20、21、25、26、27、31、32、34、35、36 |
| `openspec/specs/configuration-and-deployment/spec.md` | 1、26、28、30、37 |
| `openspec/specs/shared-acp-process-pool/spec.md` | 7 |
| `openspec/specs/container-packaging/spec.md` | 14、28、29、30 |
| `openspec/specs/agent-version-compatibility/spec.md` | 29 |
| `openspec/specs/skills-and-reply/spec.md` | 26、28、36 |
| `openspec/specs/prompt-template-system/spec.md` | 26 |
| `openspec/specs/agent-sandbox-hardening/spec.md` | 17、18、28 |
| `openspec/specs/session-audit-log/spec.md` | 34 |
| `openspec/specs/web-dashboard-chat/spec.md` | 1、33 |

編號 2、8、9、22、23、24 為已移除的機制，現行規格已不再擁有對應需求；其中僅有歷史證據保留於 `openspec/changes/archive/` 與設計文件。
