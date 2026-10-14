# 5. 破壞性操作與路徑邊界

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 6」。

本頁說明 OMP 受限模式所依賴的**共用安全基礎模組**。這些模組不是 OMP 專屬，但 OMP 的管制決策會直接呼叫它們，是 OMP 安全邊界不可分割的一部分。

> 設計原則：OMP 側（受限工具決策、執行強制）**不重新實作**任何路徑授權或破壞性操作判斷，而是逐字委派給這裡的共用模組，確保客戶端（ACP 權限閘門）與擴充模組走同一套判斷，不會出現兩套標準。

## 5.1 破壞性操作的完整性與授權

**白話說明**
刪除、搬移、批次修補這類「會破壞檔案」的操作最需要小心，因為它們可能一次影響多個檔案。這項功能會先把請求正規化成一份「完整且有序」的操作清單，接著逐一到同一個檔案系統決策去取得授權——**只要有一個目標不合法，整個請求就被拒絕**，不會只做一半。若解析出的語法不支援、缺少端點、目標不完整，或實際要執行的內容與檢查的內容不一致（綁定不符），一律失敗關閉。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/destructive-policy.ts:105` | `normalizeDestructiveIntent()` 正規化 |
| `src/acp/destructive-policy.ts:176` | `destructiveDenialReason()` 有界拒絕理由 |
| `src/acp/omp/destructive-validator.ts:15` | `validateDestructiveIntentContract()` 契約驗證 |
| `src/acp/omp/destructive-decision.ts:106` | `decideDestructiveIntent()` OMP 側決策（委派共用模組） |
| `src/acp/omp/destructive-decision.ts:181` | `replayConformanceFixtures()` 一致性重播 |

**測試位置**
- `tests/acp/destructive-policy.test.ts`
- `tests/acp/omp-approval-records-destructive.test.ts`
- 固定樣本：`tests/fixtures/omp-compatibility/destructive-operations.json`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Complete Destructive Operation Normalization`
- `All-Target Destructive Authorization Under The Common Policy`
- `Shared Client And Extension Destructive Decision Surface`
- `OMP Complete Destructive Intent Compatibility Contract`
- `Destructive-Intent Decision Consumed From The Shared Conformance Table`

**相關封存變更**：`2026-10-10-define-omp-restricted-tool-decisions`（消費端）

## 5.2 檔案系統邊界：候選根目錄與實體路徑

**白話說明**
要判斷「這個檔案路徑是否被允許」，不能只比對字串，必須看**實體路徑**（符號連結展開後的真實位置）。這組模組負責：解析 session 的權威根目錄身分、沿著路徑元件逐一追蹤（遇到符號連結就要確認沒有跳出根目錄）、區分「已存在」與「即將建立」的目標、以及在觀測失敗時一律失敗關閉，絕不退化成字串比對。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/filesystem-roots.ts:141` | `isValidSessionIdComponent()` session 識別碼驗證 |
| `src/acp/filesystem-roots.ts:687` | `tracePathUnderRoot()` 逐元件追蹤 |
| `src/acp/filesystem-access.ts:90` | `isValidRelativeComponentPath()` |
| `src/acp/filesystem-access.ts:314` | 相對路徑元件驗證與拒絕理由 |
| `src/acp/filesystem-policy.ts:129-151` | 拒絕理由對照表（編譯期窮盡檢查） |
| `src/acp/filesystem-access-linux.ts` | Linux 專屬安全存取後端（受限 open、描述符中繼資料） |

**測試位置**
- `tests/acp/filesystem-roots.test.ts`
- `tests/acp/filesystem-access.test.ts`
- `tests/acp/filesystem-access-linux.test.ts`
- `tests/acp/filesystem-policy.test.ts`
- `tests/acp/filesystem-authorization.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Contextual ACP Filesystem Path Resolution`
- `Canonical ACP Session Root Identity`
- `Canonical ACP Existing and Prospective Target Decisions`
- `Fail-Closed ACP Root Observation and Evidence Limits`
- `Secure ACP Canonical Observation Consumption`
- `Root-Relative No-Follow ACP Content Access`
- `Secure ACP Existing and New File Mutation Semantics`
- `ACP Filesystem Replacement and Resource Failure Behavior`
- `Explicit Secure ACP Filesystem Platform Policy`
- `Secure ACP Access Evidence and Consumer Handoff`
- `Independent Restricted ACP Filesystem Write Authorization`
- `Protected-IO-Only ACP Filesystem Callback Execution`
- `Read-Only Trusted Skills Access In ACP Callbacks`
- `Bounded Specific ACP Filesystem Denial Diagnostics`

## 5.3 工作區系統呼叫圍籬

**白話說明**
除了在邏輯層擋掉越界路徑，系統還會用 Linux 的 `bubblewrap` 把代理行程「關」進一個受限的檔案系統視圖：只掛載它真正需要的目錄，其餘一概不可見。這是縱深防禦的一層，即使前面的邏輯判斷有漏洞，實際 syscall 也碰不到不該碰的檔案。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/filesystem-confinement.ts:27 / 59` | `DEFAULT_CONFINEMENT_READONLY_PATHS` / `DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS` |
| `src/acp/filesystem-confinement.ts:120` | `buildBwrapConfinement()` |

**測試位置**
- `tests/acp/filesystem-confinement.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `SandboxManager Network Isolation`（相關的沙箱政策）
- `Contextual ACP Filesystem Path Resolution`

**相關文件**：`docs/AGENT_PERMISSIONS.md`

## 5.4 一般命令的路徑參數閘門

**白話說明**
`rg`、`cat`、`ls` 這類被允許的唯讀命令，會被檢查每個路徑參數（包含輸出目標）是否落在允許的根目錄內。這項功能把判斷從「字串包含」升級為「實體路徑成員判定」，並處理家目錄縮寫（`~`、`$HOME` 等）的展開；無法展開的形式直接拒絕。原則是「表示法改變、判定不變」——不讓任何原本會被放行的命令因此被擋，或反之。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/command-path-policy.ts` | 路徑參數的成員判定與拒絕理由 |
| `src/acp/command-syntax.ts` | 命令語法解析（串接、重導向、危險旗標） |

**測試位置**
- `tests/acp/permission-gate-generic.test.ts`
- `tests/acp/command-path-canonical.test.ts`
- `tests/acp/command-test-fixture.ts`（測試樣本）

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Canonical Generic-Command Path Argument Decision`
- `Generic-Command Policy Parity Under Canonicalization`

## 5.5 技能腳本清單與自動批准

**白話說明**
代理要呼叫技能時，會執行 `deno run <技能腳本>`。這項功能會建立一份「可自動批准」的技能腳本清單：只承認實際存在於受信任技能根目錄下的絕對腳本路徑，加上少數沒有腳本的技能的精確命令前綴。它不會因為名稱相似就放行，也不掃描使用者家目錄。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/skill-inventory.ts:135` | `buildSkillAutoApproveList()` |
| `src/acp/skill-inventory.ts:258` | `isUnderRoot()` 根目錄成員判定 |
| `src/acp/skill-inventory.ts:346` | `decodeLiteralToken()` 字面 token 展開 |
| `src/acp/skill-inventory.ts:446` | `matchesScriptEntrypoint()` 精確入口比對 |

**測試位置**
- `tests/acp/skill-inventory.test.ts`
- `tests/acp/skill-inventory-fixture.ts`（測試樣本）

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Skill Auto-Approve List Construction Over the Single Resolved Root`
- `Root-Exact Script Entrypoint Approval`

**相關封存變更**：`2026-10-13-unify-omp-skill-root-resolution`（收斂為單一根目錄解析）
**相關文件**：`docs/AGENT_PERMISSIONS.md`
