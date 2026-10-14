# 4. 工具授權與執行強制

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 5」。

本頁收錄 OMP「受限模式」的安全核心。在 `cutover-omp-native-runtime` 之後，這塊已大幅簡化為：**一份最小的原生能力對照表 + 原生 `tool_call` 的分派前預設拒絕 + 既有的共用 ACP 政策閘門**。

> 大原則：OMP 受限模式只做一件額外的決策——原生 `tool_call` 的名稱若對應到允許的能力，就繼續交給原生分派（原生批准政策與共用 ACP 政策仍會各自決定）；其餘名稱在**分派之前**以有界的 `rejected_unknown_tool` 理由擋下。專案**不**再建構工具來源（provenance）、登記表世代（registry epoch）或批准記錄（approval records）等治理機制。

## 4.1 載入前的可執行模組排除與關鍵技能所有權

> **處置：已移除。** `src/acp/omp/discovery-guard.ts`、其擴充 bootstrap 呼叫端與測試檔皆已刪除，對應的規格需求亦已移除。

**歷史說明（非現行行為）**
早期版本在任何不受信任的模組被匯入之前，先排除工作區的自訂工具／外掛探索路徑，並對「關鍵技能」做所有權挑選，任何無法建立保證的情況就讓 session 設定失敗關閉。OpenCode 側沒有對等的專案端處理，因此這道機制在 `cutover-omp-native-runtime` 被取消；剩餘證據見 `openspec/changes/archive/2026-10-09-guard-omp-executable-discovery`。

## 4.2 工作區可執行檔預檢

> **處置：已移除。** `src/acp/omp/executable-sources.ts` 與其測試檔皆已刪除，對應的規格需求亦已移除。

**歷史說明（非現行行為）**
早期版本以只讀取中繼資料的方式，掃描 session 工作區與可達的可執行探索根目錄（例如 `.omp/tools`、`.omp/plugins`），發現任何可匯入的可執行模組、斷掉的連結或讀取失敗就拒絕。這道掃描與其生命週期接線在 `cutover-omp-native-runtime` 被取消；剩餘證據見 `openspec/changes/archive/2026-10-12-check-omp-workspace-executables`。

## 4.3 受限工具清單決策

> **處置：保留（簡化為能力對照表 + 預設拒絕）。**

**白話說明**
受限模式需要一份「哪些原生工具可以繼續」的最小對照。這張表是一份凍結（frozen）的不可變對照表：把原生工具名稱一對一映射到它們代表的 OpenCode 能力——讀取（本機／URL／技能指示讀取）、本機搜尋（grep／glob／find）、待辦（todo）、網頁搜尋、執行（bash）、修改（edit／write）與破壞性修改（delete／move）。查表用 **own-property** 判定，因此 `toString`、`constructor`、`__proto__` 等原型形狀名稱永不匹配。表中沒有臆造的 `skill` 工具——技能能力由原生技能探索與 `read skill://...` 提供。沒有列在表中的名稱，一律以有界的 `rejected_unknown_tool` 理由拒絕。fulfilled 的對應名稱不再被專案的第二次授權覆蓋：**原生 ACP 與既有共用政策仍會各自決定**該呼叫。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/tool-inventory.ts:32` | `OMP_TOOL_CAPABILITY_MAP`：凍結的能力對照表（11 個名稱） |
| `src/acp/omp/tool-inventory.ts:23-30` | `OmpToolCapability`：能力詞彙（read／search／todo／network／execute／modify／destructive） |
| `src/acp/omp/tool-inventory.ts:54-59` | `decideOmpToolCapability()`：單一工具決策（continue／block） |

**測試位置**
- `tests/acp/omp-restricted-tool-decisions.test.ts`（含原型形狀名稱與凍結性）
- `tests/acp/omp-native-registration.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `OMP Native Capability Policy Parity`
- `Native OMP Capability Admission Before Tool Dispatch`

**對應封存變更**：`openspec/changes/archive/2026-10-10-define-omp-restricted-tool-decisions`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_TOOL_POLICY.md`、`docs/OMP_ENFORCEMENT.md`

## 4.4 工具呼叫的執行期強制

> **處置：保留（簡化為原生 callback 預設拒絕 + 共用 ACP 閘門）。**

**白話說明**
能力對照表本身不會攔下任何東西，必須真的接到 OMP 的每次工具呼叫上。受限模式透過官方 `api.on("tool_call", handler)` 註冊一個**同步的分派前**處理器：名稱對應到允許能力時繼續（回傳 `undefined`），否則回傳 `{block: true, reason}` 在執行前擋下。受限啟動是唯一載入此擴充的啟動；原生 YOLO 模式不載入擴充，其唯一的 LSP 拒絕由原生 YAML 表達。專案**不**再為每次呼叫讀取來源、登記表世代或資源世代，也不再維護接線閘門、縫隙清單或替換工具完成決策。既有的共用 ACP 政策（權限請求判定、命令路徑閘門、破壞性操作授權、檔案回寫）仍為第二層。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/extension/native-registration.ts:46-52` | `createOmpCapabilityToolCallHandler()` 單次呼叫決策 |
| `src/acp/omp/extension/native-registration.ts:55-57` | `registerOmpCapabilityCallback()`：官方 `api.on("tool_call", …)` |
| `src/acp/omp/extension/index.ts` | 擴充入口（同步註冊，無 bootstrap／registry／replacement／readiness） |
| `src/acp/client.ts:562-563` | 共用 ACP 閘門（含 OMP 破壞性入口正規化） |

**測試位置**
- `tests/acp/omp-native-registration.test.ts`（分派前擋下、映射名稱通過、零操作）
- `tests/acp/permission-gate-generic.test.ts`
- `tests/acp/client.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Native OMP Capability Admission Before Tool Dispatch`
- `Permission Handling — Restricted Mode`

**對應封存變更**：`openspec/changes/archive/2026-10-10-wire-omp-restricted-tool-enforcement`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_ENFORCEMENT.md`

## 4.5 原生擴充 API 接線

> **處置：保留（官方 `on("tool_call")`）。**

**白話說明**
上游載入擴充模組時，會把一個 `ExtensionAPI` 物件傳給工廠函式並忽略其回傳值。因此能力處理器改成在這個工廠函式被評估時，**同步**透過 `api.on("tool_call", handler)` 掛上，除此之外不依賴任何東西：不回傳註冊結果、不消費任何登記表介面（`getAllTools`、`registerTool`）、不取得 session、不註冊替換工具、也不建立 schema facade。事件形狀只用到 `event.toolName`；回傳 `{block: true, reason}` 即可在執行前停止呼叫。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/extension/native-registration.ts:22-39` | `NativeToolCallEvent` / `NativeToolCallEventResult` / `NativeExtensionApi` 契約子集 |
| `src/acp/omp/extension/native-registration.ts:55-57` | `registerOmpCapabilityCallback()`：唯一註冊動作 |
| `src/acp/omp/extension/index.ts` | `export default registerOmpCapabilityCallback` |

**測試位置**
- `tests/acp/omp-native-registration.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Native OMP Capability Admission Before Tool Dispatch`
- `Restricted Native OMP ACP Launch`

**對應封存變更**：`openspec/changes/archive/2026-10-12-wire-omp-native-extension-api`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_ENFORCEMENT.md`

## 4.6 承認受信任的原生內建工具

> **處置：已移除（來源 tuple 認證）；改按能力政策。**

**歷史說明（非現行行為）**
早期版本以工具「實際來源」（native-builtin／owned-extension／operator-MCP／未知）決定是否放行，並為此新增原生內建來源類別。`src/acp/omp/tool-provenance.ts` 與相關判定在 `cutover-omp-native-runtime` 已刪除。現行的等效效果改由**能力政策**達成：原生讀取與本機搜尋在對照表中對應到 `read`／`search` 能力而繼續，命令、寫檔與破壞性操作仍由原生批准政策與共用 ACP 政策管制。

**現行做法（能力政策）**
- `src/acp/omp/tool-inventory.ts`（`read`／`grep`／`glob`／`find` 對應 `read`／`search`）

**測試位置**
- `tests/acp/omp-restricted-tool-decisions.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `OMP Native Capability Policy Parity`
- `Native OMP Local Read And Search Behavior`

**對應封存變更**：`openspec/changes/archive/2026-10-13-admit-trusted-omp-native-builtins`（歷史）、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_TOOL_POLICY.md`

## 4.7 自有模組的實體部署證據

> **處置：已移除；改用一般安裝慣例。** `src/acp/omp/deployment-module.ts`、`owned-module-evidence.ts` 與其蒐集器、測試檔皆已刪除。

**歷史說明（非現行行為）**
早期版本以原生檔案中繼資料 API 產生並複驗「已部署模組」的實體部署證據，確保被承認的模組確實是映像裡那一份。`cutover-omp-native-runtime` 起，部署位置只是**路徑**，不再是實體信任權威：受信任擴充以一般安裝慣例安裝，檔案擁有權或替換證據**不**是整合授權的前提。剩餘的路徑契約（dev→image 解析）由 `src/utils/omp-paths.ts` 承擔；證據見 `openspec/changes/archive/2026-10-13-bind-omp-owned-module-evidence`。

**規格需求**
- `openspec/specs/container-packaging/spec.md` — `OMP Artifact Installation Uses Existing Project Conventions`
- `openspec/specs/container-packaging/spec.md` — `Development-Path to Image-Path Resolution Contract`

**相關文件**：`docs/OMP_PACKAGING.md`
