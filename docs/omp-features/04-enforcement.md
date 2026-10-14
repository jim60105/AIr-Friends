# 4. 工具授權與執行強制

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 5」。

本頁收錄 OMP「受限模式」的安全核心：**哪些工具可以跑、來源是否可信、每個呼叫是否被逐次檢查**。這是整個 OMP 整合中份量最重的一塊。

> 大原則：OMP 的批准記錄（approval records）**不能**當作執行期授權。真正決定是否放行的是「執行期的預設拒絕決策」，再疊加來源（provenance）與資源世代（generation）的檢查。

## 4.1 載入前的可執行模組排除與關鍵技能所有權

**白話說明**
OMP 在工作區裡會尋找「自訂工具」與「外掛」模組並載入執行。這等於讓工作區內容有機會執行任意程式碼。這項功能建立一份「載入前」的排除決策：在任何不受信任的模組被匯入之前，先把工作區的自訂工具目錄、外掛目錄等探索路徑排除；同時對「關鍵技能」（例如記憶、回覆等必要技能）做嚴格的所有權挑選——只有來自受信任根目錄的版本才會被選中，工作區的同名檔案不能搶走。任何無法建立這道保證的情況，一律讓 session 設定失敗關閉（fail-closed）。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/discovery-guard.ts:222` | `computeDiscoveryDecision()` 純函式決策 |
| `src/acp/omp/discovery-guard.ts:62` | `AUDITED_DISCOVERY_SURFACES` 已稽核探索表面 |
| `src/acp/omp/discovery-guard.ts:437` | `evaluateOwnedModuleOwnership()` |
| `src/acp/omp/discovery-guard.ts:548 / 568` | `PINNED_CRITICAL_SKILLS` / `evaluateCriticalSkillSelection()` |
| `src/acp/omp/discovery-guard.ts:681` | `transitionSkillLifecycleState()`（new／load／refresh 皆一致） |
| `src/acp/omp/discovery-guard.ts:779 / 797` | `preImportExclusionGate()` / `criticalSkillSelectionGate()` 誠實閘門 |
| `src/acp/omp/extension/bootstrap.ts:59` | `bootstrapDiscoveryGuard()`：擴充載入時的第一道關卡 |

**測試位置**
- `tests/acp/omp-discovery-guard.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Trusted-Module Pre-Import Discovery Exclusion Bootstrap`
- `Fail-Closed Session Setup When Exclusion Cannot Be Established`
- `Exact Owned-Module Trust Scope`
- `Canonical Critical-Skill Ownership Across New, Load, and Refresh`
- `Discovery And Critical-Selection Compatibility Gates Remain Blocking`

**對應封存變更**：`openspec/changes/archive/2026-10-09-guard-omp-executable-discovery`
**相關文件**：`docs/OMP_DISCOVERY.md`

## 4.2 工作區可執行檔預檢

**白話說明**
接續上一項。由於上游無法在匯入前完全排除，這項功能改成以「部署控制 + 啟動前檢查」因應：以**只讀取中繼資料**的方式掃描 session 工作區與可達的可執行探索根目錄（例如 `.omp/tools`、`.omp/plugins`）。只要發現任何可匯入的可執行模組、斷掉的連結、缺少授權根目錄或讀取失敗，就立即拒絕，且不做任何修補。自 `simplify-omp-session-boundaries` 起，這項檢查**不再**由 daemon 在每次原生請求前執行；它唯一的正式消費者是擴充載入期的啟動檢查（`extension_load`），daemon 端已無獨立的掃描閘門或對應的復原中止原因。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/executable-sources.ts:856` | `checkOmpExecutableSources()`：同步中繼資料觀察 |
| `src/acp/omp/executable-sources.ts:103` | `ExecutableSourceRejectionError` |
| `src/acp/omp/executable-sources.ts:958` | `executableObservationForGuard()`：把觀察結果綁到探索決策與啟動工作目錄 |
| `src/acp/omp/extension/bootstrap.ts:122` | 擴充載入期的 `extension_load` 階段檢查 |

**測試位置**
- `tests/acp/omp-executable-sources.test.ts`
- `tests/acp/omp-discovery-guard.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Trusted-Module Pre-Import Discovery Exclusion Bootstrap`
- `Fail-Closed Session Setup When Exclusion Cannot Be Established`
- `Discovery And Critical-Selection Compatibility Gates Remain Blocking`

**對應封存變更**：`openspec/changes/archive/2026-10-12-check-omp-workspace-executables`
**相關文件**：`docs/OMP_DISCOVERY.md`

## 4.3 受限工具清單決策

**白話說明**
受限模式的問題不只是「清單上列了哪些工具」，還包括工具的隱含副作用、來源真偽，以及同一功能是否有「替代執行入口」繞過管制。這項功能建立一份純函式決策模組，針對上游完整工具清單（含隱含副作用表面）逐一決策：讀取／列出／搜尋類工具受到既有檔案系統邊界管制；未知工具與內部 scheme 預設拒絕；就算看到同一把工具名稱，也要看它的**實際來源**（原生、自家擴充、維運者 MCP、不受信任）才決定。MCP（外部工具伺服器）的導入也有獨立決策與誠實的機制分級。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/tool-inventory.ts:213` | `RESTRICTED_TOOL_INVENTORY_TABLE` 工具清單表 |
| `src/acp/omp/tool-inventory.ts:702` | `decideRestrictedTool()` 單一工具決策 |
| `src/acp/omp/tool-inventory.ts:498` | `ALTERNATE_ROUTE_BLOCKING_TABLE` 替代入口封鎖表 |
| `src/acp/omp/tool-inventory.ts:863` | `decideMcpAdmission()` MCP 導入決策 |
| `src/acp/omp/tool-provenance.ts:187` | `evaluateToolProvenance()` 來源判定 |
| `src/acp/omp/approval-records.ts:113` | `interpretApprovalRecords()` 批准記錄解讀（不授予執行權） |
| `src/acp/omp/record-evaluator.ts:31` | `evaluateApprovalRecordAuthority()` |

**測試位置**
- `tests/acp/omp-restricted-tool-decisions.test.ts`
- `tests/acp/omp-approval-records-destructive.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Restricted Tool-Inventory Default-Deny Decision`
- `Live-Provenance Admission Decision`
- `Alternate-Execution-Entrypoint Blocking Decision`
- `Exact-Key Approval-Record Interpretation With No Inherited Grants`
- `Destructive-Intent Decision Consumed From The Shared Conformance Table`
- `MCP Admission Decision With Honest Mechanism Tiers`
- `Restricted Tool Decision Verdicts Retain Decided Dispositions`

**對應封存變更**：`openspec/changes/archive/2026-10-10-define-omp-restricted-tool-decisions`
**相關文件**：`docs/OMP_TOOL_POLICY.md`、`docs/OMP_ENFORCEMENT.md`

## 4.4 工具呼叫的執行期強制

**白話說明**
決策模組本身不會攔下任何東西，必須真的接到 OMP 的每次工具呼叫上。這項功能把強制處理器同步掛上工具呼叫縫隙，讓**每一次受限呼叫**都被檢查（包含 session中途才動態註冊的工具）。檢查內容包括當下的來源、登記表世代與資源世代；上游若回報錯誤或逾時，一律讓呼叫失敗關閉（fail-closed），並回傳有界、可讀的錯誤。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/tool-enforcement-wiring.ts:283` | `enforcementWiringGates()` 接線閘門 |
| `src/acp/omp/tool-enforcement-wiring.ts:156` | `ENFORCEMENT_SEAMS` 縫隙定義 |
| `src/acp/omp/extension/enforcement.ts:160` | `registerRestrictedEnforcement()` |
| `src/acp/omp/extension/enforcement.ts:508` | `composeRestrictedToolCall()` 單次呼叫合成決策 |
| `src/acp/omp/extension/enforcement.ts:692` | `createRestrictedToolCallHandler()` |
| `src/acp/omp/extension/enforcement-error.ts:92` | `EnforcementError`：有界錯誤詞彙 |

**測試位置**
- `tests/acp/omp-tool-enforcement-wiring.test.ts`
- `tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Trusted-Extension Tool-Call Enforcement Wiring`
- `Per-Call Consultation With Live Origin Observation`
- `Bounded Fail-Closed Enforcement Errors`
- `Post-Start MCP Registry Refresh Re-Admission`
- `Restricted-Only Enforcement Registration`
- `Fail-Closed Behavior At Unresolved Inherited Seams`
- `Enforcement Wiring Evidence Limited To Wiring Decisions`

**對應封存變更**：`openspec/changes/archive/2026-10-10-wire-omp-restricted-tool-enforcement`
**相關文件**：`docs/OMP_ENFORCEMENT.md`

## 4.5 原生擴充 API 接線

**白話說明**
上游載入擴充模組時，是把一個 API 物件傳給工廠函式，並忽略其回傳值。這項功能因此改成在工廠執行時，直接透過該 API 註冊工具呼叫處理器與替代工具定義，並把原生事件／情境解碼成既有的政策輸入（不信任模型自行宣稱的來源）。每次呼叫都重新讀取當下的工具登記表，換算成標準化的來源與資源世代，讓政策真正連結到原生事件。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/extension/native-registration.ts:795` | `createNativeExtensionFactory()` |
| `src/acp/omp/extension/native-registration.ts:647` | `registerNativeEnforcement()` |
| `src/acp/omp/extension/native-registration.ts:398` | `createNativeRegistrySurface()` |
| `src/acp/omp/extension/native-events.ts:524` | `decodeNativeToolCallEvent()` |
| `src/acp/omp/extension/index.ts:36` | `loadTimeDiscoveryDecision()` 模組載入入口 |

**測試位置**
- `tests/acp/omp-native-registration.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Restricted Enforcement Registers Through the Native Extension Contract`
- `Native Events Use Trusted Session and Origin Context`

**對應封存變更**：`openspec/changes/archive/2026-10-12-wire-omp-native-extension-api`
**相關文件**：`docs/OMP_ENFORCEMENT.md`

## 4.6 承認受信任的原生內建工具

**白話說明**
早期版本把 OMP 真正的原生內建工具（例如 bash、寫檔、原生讀取與搜尋）誤判為不受信任的外部工具，導致它們全被擋下，連正常本機讀寫都做不到。這項功能新增一種「原生內建」來源類別，只承認來自官方執行期登記表的工具；來自 SDK／RPC 注入、工作區或未知來源的仍然拒絕。於是受限模式下仍能使用原生的本機讀取與搜尋，同時命令、寫檔與破壞性操作的邊界維持不變。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/tool-provenance.ts:24-47` | `ToolOrigin`、`NATIVE_BUILTIN_SOURCE_SCOPE`／`ORIGIN`、`nativeBuiltinSourcePath()` |
| `src/acp/omp/tool-provenance.ts:187` | `evaluateToolProvenance()` 納入原生內建來源 |
| `src/acp/omp/tool-inventory.ts:702` | `decideRestrictedTool()` 對原生內建的放行規則 |
| `src/acp/omp/extension/native-registration.ts:479` | `createNativeLiveObserver()` 官方登記表觀察 |

**測試位置**
- `tests/acp/omp-restricted-tool-decisions.test.ts`
- `tests/acp/omp-native-registration.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Live-Provenance Admission Decision`
- `Restricted Tool-Inventory Default-Deny Decision`
- `Native Local Read and Search Remain Usable Under Supported Approval`
- `Native Local Admission Does Not Admit Remote or Device Search Routes`
- `Authorized Ambient Native Mutation`
- `Native Registry Observation Uses the Supported Runtime Surface`

**對應封存變更**：`openspec/changes/archive/2026-10-13-admit-trusted-omp-native-builtins`
**相關文件**：`docs/OMP_TOOL_POLICY.md`

## 4.7 自有模組的實體部署證據

**白話說明**
我們自己的擴充模組被安裝在映像的固定位置，但系統過去用「工作區／行程池狀態根目錄」當作所有權依據，兩者其實不同。這項功能把「已部署模組的實際路徑與根目錄」獨立出來，並用原生檔案中繼資料 API 產生並複驗部署證據，確保被承認的模組確實是映像裡那一份，而不是被替換過的版本。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/deployment-module.ts:59-125` | 部署模組宣告（映像面／開發面） |
| `src/acp/omp/deployment-module.ts:322` | `verifyOwnedModuleObservation()` |
| `src/acp/omp/deployment-module.ts:273` | `acceptOwnedModuleAnchor()` |
| `src/acp/omp/owned-module-evidence.ts:230` | `createOwnedModuleEvidenceSource()` |
| `src/acp/omp/owned-module-evidence.ts:143` | `selectLoadedDeploymentModule()` |

**測試位置**
- `tests/acp/omp-owned-module-evidence.test.ts`
- `tests/acp/omp-owned-module-bundle-smoke.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Exact Owned-Module Trust Scope`
- `openspec/specs/acp-integration/spec.md` — `Native Events Use Trusted Session and Origin Context`
- `openspec/specs/acp-integration/spec.md` — `Owned Replacement Admission Preserves Separate Completion`
- `openspec/specs/container-packaging/spec.md` — `Generated OMP Bundle Carries Its Owned Deployment Declaration`

**對應封存變更**：`openspec/changes/archive/2026-10-13-bind-omp-owned-module-evidence`
**相關文件**：`docs/OMP_PACKAGING.md`
