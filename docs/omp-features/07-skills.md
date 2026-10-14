# 7. 技能根目錄與技能交接

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 8」。

**白話說明（整體）**
代理（Agent）本身不直接回覆使用者，而是執行專案提供的「技能腳本」（例如 `send-reply`、`memory-save`）來做事。這些腳本放在一個「受信任的技能根目錄」下。OMP 因為會隔離家目錄，一開始找不到技能、也讀不到技能說明，這一組功能就是在解決「技能放在哪、怎麼被找到、怎麼被信任」的完整鏈路。

## 7.1 部署方宣告的技能根目錄設定

**白話說明**
技能根目錄不能由使用者或工作區決定，必須由部署方（設定檔）宣告為絕對路徑。這項功能在兩種模式的 OMP 設定中，都只宣告部署方擁有的技能根目錄，並且把這些根目錄餵給關鍵技能挑選邏輯；工作區內的同名內容會在挑選「關鍵技能」之前就被排除，確保關鍵技能不會被工作區檔案假冒。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp-settings.ts:624` | `OMP_DECLARED_SKILL_ROOT_ENV` 宣告用環境變數名 |
| `src/acp/omp-settings.ts:822 / 949` | 兩份 overlay 中的技能根目錄設定 |
| `src/acp/omp/owned-skills.ts:138` | `observeOwnedSkills()` 自有技能觀察 |
| `src/acp/omp/skill-root-declaration.ts:61` | `writeOmpSkillRootDeclaration()` 單鍵宣告寫出 |
| `src/acp/omp/discovery-guard.ts:548 / 568` | `PINNED_CRITICAL_SKILLS` / `evaluateCriticalSkillSelection()` |
| `src/acp/omp/extension/critical-skills.ts:53` | `observeDeclaredSkillRoots()`：擴充端唯一信任來源 |

**測試位置**
- `tests/acp/omp-skill-root-declaration.test.ts`
- `tests/acp/omp-discovery-guard.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Deployment-Owned OMP Skill Root Settings`
- `Canonical Critical-Skill Ownership Across New, Load, and Refresh`

**對應封存變更**：`openspec/changes/archive/2026-10-12-pin-omp-owned-skill-roots`
**相關文件**：`docs/OMP_SETTINGS.md`

## 7.2 自有技能的讀取與交接修復

**白話說明**
OMP 隔離了家目錄後，技能說明書裡寫的 `${HOME}/.agents/skills` 變成空目錄，代理因此找不到技能；而讀取替換工具又會拒絕 `skill://` 這種 URI，等於把技能說明切斷。這項功能做兩件事：把「實際受信任的技能根目錄」以字面值注入所有會教技能用法的提示（含重試提示），並讓受控讀取支援自有 `skill://` 的讀取。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/extension/read-replacement.ts:249` | `createOwnedSkillUriAuthorization()` 自有技能 URI 授權 |
| `src/acp/omp/extension/read-replacement.ts:152` | `SkillUriSourceReader` 技能內容讀取 |
| `prompts/skills_root.md` | 技能根目錄注入片段（`{{ skillsDir }}`） |
| `prompts/system_reply.md` 等 | 各提示模板中的 `{{ skillScript(skillsDir, …) }}` 完整路徑形式 |
| `src/core/agent-core.ts:120` | `resolveTrustedSkillsRoot()` 注入模板變數 |
| `src/core/session-orchestrator.ts:251` | 受信任技能目錄快取與重試提示注入 |

**測試位置**
- `tests/acp/omp-skill-uri-authorization.test.ts`
- `tests/core/prompt-staging-literals.test.ts`
- `tests/integration/omp-skill-handoff/handoff.integration.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Owned Skill URIs Remain Readable Through Native Read`
- `openspec/specs/acp-integration/spec.md` — `Owned Replacement Admission Preserves Separate Completion`
- `openspec/specs/prompt-template-system/spec.md` — `Skill-Instructing Templates Receive the Trusted Script Root`
- `openspec/specs/skills-and-reply/spec.md` — `Shell-Based Skill Execution`
- `openspec/specs/skills-and-reply/spec.md` — `Agent-Portable Staging And Session Identity`

**對應封存變更**：`openspec/changes/archive/2026-10-12-repair-omp-owned-skill-handoff`
**相關文件**：`docs/OMP_DISCOVERY.md`、`docs/SKILLS_IMPLEMENTATION.md`

## 7.3 技能信任對齊共用根目錄

**白話說明**
原本 OMP 對技能根目錄有一套非常嚴格的「所有權」要求（必須 root 擁有、不可被代理寫入等），但專案後來決定兩種代理共用同一個技能根目錄，而該根目錄是可被代理寫入的。這項功能把這些所有權限制在根目錄、目標與每個路徑元件上全部移除，讓 OMP 願意接受共用的技能根目錄——這是一次**刻意的安全放寬**，並已明確記錄。放寬的同時，清單層級的拒絕不變式（例如來源判定、關鍵技能挑選）仍然保留。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/owned-skills.ts:61-87` | 自有技能導入階梯（移除所有權條款） |
| `src/acp/omp/extension/read-replacement.ts` | 讀取替換中重複的同款條款（同步移除） |
| `src/acp/filesystem-roots.ts:599-603` | 共用根目錄觀察：所有權與權限位不再是准入輸入 |

**測試位置**
- `tests/acp/omp-discovery-guard.test.ts`
- `tests/acp/omp-skill-uri-authorization.test.ts`
- `tests/acp/filesystem-roots.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Trusted Read-Only ACP Skills Root Identity`
- `Read-Only Trusted Skills Access In ACP Callbacks`
- `Mode-Separated Owned OMP Settings Content`
- `Deployment-Owned OMP Skill Root Settings`
- `Owned Replacement Admission Preserves Separate Completion`
- `Canonical Critical-Skill Ownership Across New, Load, and Refresh`
- `Owned Skill URIs Remain Readable Through Native Read`
- `OMP Owned Skill Read And Execution Over The Shared Root`
- `Inventory Denial Invariants Survive The Ownership Relaxation`

**對應封存變更**：`openspec/changes/archive/2026-10-13-align-omp-skill-trust-to-shared-root`
**相關文件**：`docs/OMP_DISCOVERY.md`

## 7.4 統一技能根目錄解析

**白話說明**
先前不同地方各自推導技能根目錄（提示用一個、自動批准用另一個、容器掛載又一個），容易出現不一致。這項功能收斂成**單一解析器**：依代理類型與設定值產出唯一可信的技能根目錄，並把這個輸出同時餵給腳本清單、ACP 權限比對、健康檢查與唯讀掛載。同時，自動批准從「後綴比對」改為「精確的絕對腳本入口」，避免被同後綴的偽造腳本騙過。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/core/skills-root.ts:101` | `resolveTrustedSkillsRoot()` 單一解析器 |
| `src/core/skills-root.ts:114` | `observeTrustedSkillsRoot()` 觀察版 |
| `src/acp/skill-inventory.ts:135 / 446` | 腳本清單建構與精確入口比對 |
| `src/acp/filesystem-confinement.ts:27` | `DEFAULT_CONFINEMENT_READONLY_PATHS`（唯讀技能樹掛載） |
| `src/acp/client.ts` | ACP 回呼中的唯讀技能存取 |
| `Containerfile:346-349` | 映像宣告 OpenCode 安裝根目錄 |
| `src/core/skill-installer.ts` | 外部技能安裝至同一解析根目錄 |

**測試位置**
- `tests/core/skill-root-wiring.test.ts`
- `tests/core/skills-root.test.ts`
- `tests/acp/skill-inventory.test.ts`
- `tests/core/external-skill-publication-parity.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Skill Auto-Approve List Construction Over the Single Resolved Root`
- `openspec/specs/acp-integration/spec.md` — `Root-Exact Script Entrypoint Approval`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Filesystem-Touching Bash Tools Route Through the ACP Gate`
- `openspec/specs/agent-sandbox-hardening/spec.md` — `Shared Resolved Skill Tree Has Read-Only Runtime Visibility`
- `openspec/specs/configuration-and-deployment/spec.md` — `External Skill Auto-Installation Into the Single Skill Root`
- `openspec/specs/configuration-and-deployment/spec.md` — `Container Health and Skill Readiness Endpoints`
- `openspec/specs/configuration-and-deployment/spec.md` — `Stock Image Declares the Shared Skill Install Root`
- `openspec/specs/configuration-and-deployment/spec.md` — `One Configured Skill Root For Every Agent Type`
- `openspec/specs/container-packaging/spec.md` — `Single Packaged Skill Tree For Every Agent Type`
- `openspec/specs/skills-and-reply/spec.md` — `Deployment-Resolved Skill Script Root Identity for Both Agent Types`

**對應封存變更**：`openspec/changes/archive/2026-10-13-unify-omp-skill-root-resolution`
**相關文件**：`docs/SKILLS_IMPLEMENTATION.md`、`docs/DEVELOPMENT.md`
