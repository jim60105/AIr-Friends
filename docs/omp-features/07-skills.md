# 7. 技能根目錄與技能交接

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 8」。

**白話說明（整體）**
代理（Agent）本身不直接回覆使用者，而是執行專案提供的「技能腳本」（例如 `send-reply`、`memory-save`）來做事。這些腳本放在一個「受信任的技能根目錄」下。OMP 因為會隔離狀態目錄，一開始找不到技能、也讀不到技能說明，這一組功能就是在解決「技能放在哪、怎麼被找到、怎麼被信任」的完整鏈路。

> 在 `cutover-omp-native-runtime` 之後，技能**讀取與探索交回原生實作**（原生 `read skill://...`）；§7.1–§7.3 描述的宣告產生、關鍵技能挑選、替換工具 URI 授權與所有權階梯均已刪除，改以下方 §7.4 的**單一共用根目錄解析**與原生探索承擔。

## 7.1 部署方宣告的技能根目錄設定

> **處置：保留（改為手寫 YAML）；啟動期宣告產生與關鍵技能挑選已移除。**

**現行做法**
技能根目錄不能由使用者或工作區決定，必須由部署方宣告為絕對路徑。現行做法是**手寫**在原生設定中：`agent-config/omp/restricted.yml` 與 `native-yolo.yml` 的 `skills.customDirectories`（出廠映像為 `["~/.agents/skills"]`），同時把 `agent.skillsDir` 設為同一個根目錄。原生 OMP 以 `expandTilde()` 解析 `~`；**沒有**插值器、產生器或一致性閘門，原生設定錯誤由原生回報。共用解析出的那一個根目錄見 §7.4。

**主要實作**

| 位置 | 說明 |
|---|---|
| `agent-config/omp/restricted.yml:25-30` | 受限模式 `skills.customDirectories`（手寫原生宣告） |
| `agent-config/omp/native-yolo.yml:11-14` | 原生 YOLO 模式 `skills.customDirectories` |
| `src/acp/agent-factory.ts:239-388` | 依模式選取單一原生設定文件，交由原生解析 |

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Handwritten Native OMP Configuration Consumption`
- `openspec/specs/configuration-and-deployment/spec.md` — `One Configured Skill Root For Every Agent Type`

**歷史說明（非現行行為）**
早期版本由程式在啟動時產生並寫出單鍵技能根目錄宣告（`src/acp/omp/skill-root-declaration.ts`、`OMP_DECLARED_SKILL_ROOT_ENV`），並在挑選「關鍵技能」前先排除工作區同名內容（`src/acp/omp/discovery-guard.ts` 的 `PINNED_CRITICAL_SKILLS`、`extension/critical-skills.ts`、`src/acp/omp/owned-skills.ts`）；上述模組與測試（`tests/acp/omp-skill-root-declaration.test.ts`、`tests/acp/omp-discovery-guard.test.ts`）皆已刪除。

**對應封存變更**：`openspec/changes/archive/2026-10-12-pin-omp-owned-skill-roots`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_SETTINGS.md`

## 7.2 自有技能的讀取與交接修復

> **處置：保留（交接鏈與原生 `skill://` 讀取）；替換工具 URI 授權已移除。**

**現行做法**
OMP 隔離了狀態目錄後，技能說明書裡寫的 `${HOME}/.agents/skills` 可能落空，代理因此找不到技能。現行做法是把「實際受信任的技能根目錄」以**字面值**注入所有會教技能用法的提示（含重試提示）：提示模板用 `{{ skillsDir }}` 與 `{{ skillScript(skillsDir, …) }}` 的完整絕對路徑形式，並由 `requireTrustedSkillsRoot()` / `assertSkillsRootDelivered()` 在交付前驗證這個被分類的邊界。技能的讀取本身交回**原生 `read skill://...`**（能力對照表對應 `read`），不再由專案的替換工具提供。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/core/skills-root.ts:210` | `requireTrustedSkillsRoot()`：交付前驗證被分類邊界的根目錄 |
| `src/core/skills-root.ts:243 / 252 / 266` | `quoteShellArgument()` / `skillScriptPath()` / `assertSkillsRootDelivered()` |
| `prompts/skills_root.md` | 技能根目錄注入片段（`{{ skillsDir }}`） |
| `prompts/system_reply.md` 等 | 各提示模板中的 `{{ skillScript(skillsDir, …) }}` 完整路徑形式 |
| `src/core/agent-core.ts:120` | `resolveTrustedSkillsRoot()` 注入模板變數 |
| `src/core/session-orchestrator.ts:229` | 受信任技能目錄快取與重試提示注入 |
| `src/acp/omp/tool-inventory.ts` | 原生 `read` 能力（供 `skill://...` 讀取） |

**測試位置**
- `tests/core/prompt-staging-literals.test.ts`
- `tests/skills/staging-compat.test.ts`
- `tests/skills/skill-docs-token-gate.test.ts`
- `tests/integration/omp-skill-handoff/handoff.integration.test.ts`

**證據邊界**：`handoff.integration.test.ts` 以真實的 SessionOrchestrator 配送路徑、真實 Skill API 伺服器（session 註冊表＋回覆／檔案／反應處理器）與真實技能腳本串起跨元件消費者鏈路，鏈路兩端（ACP 代理子行程、平台適配器）為模擬。它證明的是消費者授權與副作用：部署解析出的同一個技能根目錄下的技能說明讀取、暫存檔建立、字面絕對腳本呼叫與投遞、兄弟 session 的憑證／暫存路徑拒絕，以及回應閘門的重試結果。這**不是**原生 OMP 執行檔、映像或真實平台交付的證據（原生證據由原生驗證單元另行分別記錄）。跨元件套件即 `tests/integration/omp-skill-handoff/`。

**規格需求**
- `openspec/specs/prompt-template-system/spec.md` — `Skill-Instructing Templates Receive the Trusted Script Root`
- `openspec/specs/skills-and-reply/spec.md` — `Shell-Based Skill Execution`
- `openspec/specs/skills-and-reply/spec.md` — `Agent-Portable Staging And Session Identity`
- `openspec/specs/skills-and-reply/spec.md` — `Deployment-Resolved Skill Script Root Identity for Both Agent Types`
- `openspec/specs/acp-integration/spec.md` — `Native OMP Local Read And Search Behavior`

**歷史說明（非現行行為）**
早期版本由專案的受信任替換讀取工具提供自有技能 URI 授權（`src/acp/omp/extension/read-replacement.ts` 的 `createOwnedSkillUriAuthorization()`、`SkillUriSourceReader`）與「自有替換放行保留獨立完成」的判定；該模組與其測試（`tests/acp/omp-skill-uri-authorization.test.ts`）皆已刪除，相關需求亦已移除。

**對應封存變更**：`openspec/changes/archive/2026-10-12-repair-omp-owned-skill-handoff`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/SKILLS_IMPLEMENTATION.md`

## 7.3 技能信任對齊共用根目錄

> **處置：已移除（信任階梯）。** 這項機制的模組與測試已刪除，相關需求亦已移除。

**歷史說明（非現行行為）**
早期版本對技能根目錄有一套嚴格的「所有權」要求（必須 root 擁有、不可被代理寫入等），後來專案決定兩種代理共用同一個（可被代理寫入的）技能根目錄，便把這些限制移除——這是一次**刻意的安全放寬**。承載它的模組（`src/acp/omp/owned-skills.ts`、替換讀取中的同款條款）與測試（`tests/acp/omp-discovery-guard.test.ts`、`tests/acp/omp-skill-uri-authorization.test.ts`）皆已刪除。放寬後改由共用根目錄的**清單層級拒絕不變式**承擔，見下方規格需求。

**現行承擔者**
- `src/core/skills-root.ts`（共用根目錄解析與身分觀察）
- `src/acp/skill-inventory.ts`（清單建構後才出現／身分變更的拒絕）
- `src/acp/filesystem-roots.ts`（共用根目錄觀察：所有權與權限位不再是准入輸入）

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Read-Only Trusted Skills Access In ACP Callbacks`
- `openspec/specs/acp-integration/spec.md` — `Shared Deployment Skills Root In ACP Callbacks`
- `openspec/specs/acp-integration/spec.md` — `Inventory Denial Invariants Survive The Ownership Relaxation`

**對應封存變更**：`openspec/changes/archive/2026-10-13-align-omp-skill-trust-to-shared-root`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/SKILLS_IMPLEMENTATION.md`

## 7.4 統一技能根目錄解析

> **處置：保留（不變）。**

**白話說明**
先前不同地方各自推導技能根目錄（提示用一個、自動批准用另一個、容器掛載又一個），容易出現不一致。這項功能收斂成**單一解析器**：依設定值產出唯一可信的技能根目錄，並把這個輸出同時餵給腳本清單、ACP 權限比對、健康檢查與唯讀掛載。同時，自動批准從「後綴比對」改為「精確的絕對腳本入口」，避免被同後綴的偽造腳本騙過。`agentType` 只用於支援型別驗證與錯誤情境，**不**用來選根目錄。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/core/skills-root.ts:101` | `resolveTrustedSkillsRoot()` 單一解析器 |
| `src/core/skills-root.ts:114` | `observeTrustedSkillsRoot()` 觀察版（含實體身分） |
| `src/acp/skill-inventory.ts:135 / 446` | 腳本清單建構與精確入口比對 |
| `src/acp/filesystem-confinement.ts:27` | `DEFAULT_CONFINEMENT_READONLY_PATHS`（唯讀技能樹掛載） |
| `src/acp/client.ts` | ACP 回呼中的唯讀技能存取 |
| `src/core/skill-installer.ts` | 外部技能安裝至同一解析根目錄 |

**測試位置**
- `tests/core/skill-root-wiring.test.ts`
- `tests/core/skills-root.test.ts`
- `tests/acp/skill-inventory.test.ts`
- `tests/core/external-skill-publication-parity.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Skill Auto-Approve List Construction Over the Single Resolved Root`
- `openspec/specs/acp-integration/spec.md` — `Root-Exact Script Entrypoint Approval`
- `openspec/specs/acp-integration/spec.md` — `Shared Deployment Skills Root In ACP Callbacks`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Filesystem-Touching Bash Tools Route Through the ACP Gate`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Shared Resolved Skill Tree Has Read-Only Runtime Visibility`
- `openspec/specs/configuration-and-deployment/spec.md` — `One Configured Skill Root For Every Agent Type`
- `openspec/specs/configuration-and-deployment/spec.md` — `Stock Image Declares the Shared Skill Install Root`
- `openspec/specs/configuration-and-deployment/spec.md` — `External Skill Auto-Installation Into the Single Skill Root`
- `openspec/specs/configuration-and-deployment/spec.md` — `Container Health and Skill Readiness Endpoints`
- `openspec/specs/container-packaging/spec.md` — `Single Authored Skill Tree Shared By Every Agent`
- `openspec/specs/skills-and-reply/spec.md` — `Deployment-Resolved Skill Script Root Identity for Both Agent Types`

**對應封存變更**：`openspec/changes/archive/2026-10-13-unify-omp-skill-root-resolution`
**相關文件**：`docs/SKILLS_IMPLEMENTATION.md`、`docs/DEVELOPMENT.md`
