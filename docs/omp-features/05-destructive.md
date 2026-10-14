# 5. 破壞性操作與路徑邊界

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 6」。

本頁說明 OMP 受限模式所依賴的**共用安全基礎模組**。這些模組不是 OMP 專屬；當 ACP 客戶端處理經 OMP 委派的檔案與破壞性請求時會用到它們，它們是 OMP 安全邊界不可分割的一部分。

> 設計原則：OMP 側的擴充 callback **只做能力對照表的成員判定**（原生 `tool_call` 的名稱是否在表內），**不**執行任何路徑或破壞性操作授權；共用路徑／破壞性授權只發生在**適用的 ACP 客戶端回呼**中（`src/acp/client.ts`），因此客戶端與擴充之間不存在第二套授權政策。原生本機讀取／搜尋則保留其**原生作業系統環境邊界**（ambient OS boundary）——此為已接受的殘留風險，**不**由 ACP 客戶端政策界定。

## 5.1 破壞性操作的完整性與授權

> **處置：保留（共用解碼器 + 新增 OMP 入口正規化）。**

**白話說明**
刪除、搬移、批次修補這類「會破壞檔案」的操作最需要小心，因為它們可能一次影響多個檔案。這項功能會先把請求正規化成一份「完整且有序」的操作清單，接著逐一到同一個檔案系統決策去取得授權——**只要有一個目標不合法，整個請求就被拒絕**，不會只做一半。若解析出的語法不支援、缺少端點、目標不完整，或實際要執行的內容與檢查的內容不一致（綁定不符），一律失敗關閉。

OMP 的原生權限橋接可能省略工具種類，搬移參數也不同於共用解碼器。因此 `src/acp/omp/destructive-ingress.ts` 在 ACP 客戶端的請求入口做形狀正規化：刪除以原生 `Delete <path>` 標題及完整 `rawInput.path` 辨識；搬移以原生 `Move <from> to <to>` 標題及完整起點／終點辨識（起點依序讀 `oldPath`、`path`、`from`，終點依序讀 `newPath`、`to`、`destination`），正規化為共用的 `source`、`destination`。代理類型來自連接器設定，**不接受請求自行宣稱代理類型或解析器來源**。正規化後仍由同一份 `decodeDestructiveIntent()`、`normalizeDestructiveIntent()` 及全目標授權決定結果；原生 `kind`／標題只用來辨識操作種類，絕不用來尋找目標。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/destructive-policy.ts:82` | `decodeDestructiveIntent()` 解碼為完整有序的操作 |
| `src/acp/destructive-policy.ts:146` | `normalizeDestructiveIntent()` 正規化 |
| `src/acp/destructive-policy.ts:173` | `authorizeDestructiveTargets()` 全目標授權 |
| `src/acp/destructive-policy.ts:215` | `destructiveDenialReason()` 有界拒絕理由 |
| `src/acp/omp/destructive-ingress.ts:86` | `normalizeOmpDestructivePermissionInput()` OMP 入口正規化 |
| `src/acp/client.ts:562-563` | 依 `agentType === "omp"` 選用 OMP 正規化器 |

**測試位置**
- `tests/acp/destructive-policy.test.ts`
- `tests/acp/client.test.ts`（OMP 破壞性入口表：原生 delete／move、別名與各種拒絕；含請求中介資料無法選擇解碼器的案例）

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Parser-Bounded Shared Destructive Operation Normalization`
- `All-Target Destructive Authorization Under The Common Policy`
- `OMP Destructive Permission Input Normalization`
- `OMP Destructive Binding And Diagnostic Integrity`

**相關封存變更**：`openspec/changes/archive/2026-10-14-normalize-omp-destructive-acp-ingress`

## 5.2 檔案系統邊界：候選根目錄與實體路徑

> **處置：保留（不變）。**

**白話說明**
要判斷「這個檔案路徑是否被允許」，不能只比對字串，必須看**實體路徑**（符號連結展開後的真實位置）。這組模組負責：解析 session 的權威根目錄身分、沿著路徑元件逐一追蹤（遇到符號連結就要確認沒有跳出根目錄）、區分「已存在」與「即將建立」的目標、以及在觀測失敗時一律失敗關閉，絕不退化成字串比對。檔案內容的讀寫只在授權選定的單一根目錄角色下，透過受保護的 root-relative 存取操作執行。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/filesystem-roots.ts:139` | `validateSessionContext()` session 情境驗證 |
| `src/acp/filesystem-roots.ts:212` | `isWithinRoot()` 成員判定 |
| `src/acp/filesystem-roots.ts:223` | `resolveSessionPath()` 逐元件追蹤與情境展開 |
| `src/acp/filesystem-access.ts:90` | `isValidRelativeComponentPath()` |
| `src/acp/filesystem-access.ts:113` | `validateAccessAdmission()` 存取准入 |
| `src/acp/filesystem-access.ts:335 / 363` | `readCanonicalTextFile()` / `writeCanonicalTextFile()` 受保護讀寫 |
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
- `Shared ACP Canonical Observation And Evidence Scope`
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

> **處置：保留（不變）；新增所選原生資產／資料輸入。**

**白話說明**
除了在邏輯層擋掉越界路徑，系統還會用 Linux 的 `bubblewrap` 把代理行程「關」進一個受限的檔案系統視圖：只掛載它真正需要的目錄，其餘一概不可見。這是縱深防禦的一層，即使前面的邏輯判斷有漏洞，實際 syscall 也碰不到不該碰的檔案。對 OMP，共用掛載機制會額外把**所選的手寫原生設定檔、提示與受限能力擴充**以唯讀暴露、把**所選的原生模式資料子目錄**以可寫暴露，且**不**授予父層的部署／池／HOME 樹或兄弟資料根目錄；共用技能樹的唯讀掛載維持不變。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/filesystem-confinement.ts:27 / 59` | `DEFAULT_CONFINEMENT_READONLY_PATHS` / `DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS` |
| `src/acp/filesystem-confinement.ts:142` | `buildBwrapConfinement()` |
| `src/acp/sandbox-manager.ts:150-156` | OMP 專屬額外掛載（唯讀／可寫／遮蔽）合併 |

**測試位置**
- `tests/acp/filesystem-confinement.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Native OMP Assets And Data Reachability Under Shared Confinement`
- `openspec/specs/acp-integration/spec.md` — `Contextual ACP Filesystem Path Resolution`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Agent Filesystem Confinement`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Shared Resolved Skill Tree Has Read-Only Runtime Visibility`

**相關文件**：`docs/AGENT_PERMISSIONS.md`

## 5.4 一般命令的路徑參數閘門

> **處置：保留（不變）。**

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

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Canonical Generic-Command Path Argument Decision`
- `openspec/specs/acp-integration/spec.md` — `Generic-Command Policy Parity Under Canonicalization`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Generic-Command Workspace Confinement`

## 5.5 技能腳本清單與自動批准

> **處置：保留（不變）。**

**白話說明**
代理要呼叫技能時，會執行 `deno run <技能腳本>`（`<技能腳本>` 即 `{root}/{skill}/scripts/{skill}.ts`）。這項功能會建立一份「可自動批准」的技能腳本清單：只承認實際存在於**單一部署解析出的技能根目錄**下的絕對腳本路徑，加上少數沒有腳本的技能的精確命令前綴。它不會因為名稱相似就放行，也不掃描使用者家目錄；清單建構後才出現的腳本不會被該清單批准，而實際路徑身分在決策時改變的腳本會被拒絕。

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
- `Inventory Denial Invariants Survive The Ownership Relaxation`

**相關封存變更**：`openspec/changes/archive/2026-10-13-unify-omp-skill-root-resolution`（收斂為單一根目錄解析）
**相關文件**：`docs/AGENT_PERMISSIONS.md`
