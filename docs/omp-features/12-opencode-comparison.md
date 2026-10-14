# 12. OpenCode 對照

本頁逐項對照：**同一個功能，OpenCode 側在本專案裡是怎麼做的**（實作與規格），以及它與 OMP 的關係。對照以 `cutover-omp-native-runtime`（2026-10-15）之後的現行為準。

## 對照方法

| 對照來源 | 位置 |
|---|---|
| OpenCode 部署設定 | `agent-config/opencode.json`（`build`／`yolo` 兩個 agent 區塊） |
| OpenCode 啟動組裝 | `src/acp/agent-factory.ts`（OpenCode 分支） |
| 兩者共用的 ACP 權限閘門 | `src/acp/client.ts`、`src/acp/destructive-policy.ts`、`src/acp/filesystem-*.ts`、`src/acp/command-path-policy.ts`、`src/acp/skill-inventory.ts` |
| OpenCode 專屬啟動期產出 | `src/utils/opencode-paths.ts`（生成技能探索宣告）、`src/utils/opencode-version.ts` |
| 規格 | `openspec/specs/**/spec.md` 中含 OpenCode 的需求 |
| 現行權威對照文件 | `docs/AGENT_PERMISSIONS.md`、`docs/OMP_SPAWN.md`、`docs/OMP_POOL_MODES.md`、`docs/OMP_SETTINGS.md` |

關係標記：

| 標記 | 意義 |
|---|---|
| **共用** | 同一份程式碼或同一條規格同時服務兩種代理，行為相同 |
| **同目標不同機制** | 想達成的結果一樣，但機制完全不同 |
| **OMP 專屬** | OpenCode 側沒有等價機制（也不需要） |

## 一句話總結

| 面向 | OpenCode | OMP |
|---|---|---|
| 權限政策來源 | 單一 JSON 的 `permission` 表（`"*": "deny"` + 逐工具 `allow`/`ask`/`deny`），由 OpenCode 自己的權限引擎在呼叫點執行 | 手寫原生 YAML 的 `tools.approvalMode` + 逐工具 `tools.approval.<name>`，加上受限能力擴充在**分派前**擋下未對應的名稱 |
| 模式切換 | 同一支行程上用 ACP `setSessionMode("yolo")` 切到 `yolo` agent | 兩種模式**各自啟動獨立行程**；`getSessionModeOverride("omp", …)` 恆為 `null` |
| 設定檔所有權 | `$HOME/.config/opencode/opencode.json`，`$UID:0` / `775`，且啟動時會被程式寫入技能探索宣告 | `/opt/air/omp/config/{mode}.yml`，同為 `$UID:0` / `775`（一般安裝慣例）；應用程式不寫入、不產生 OMP YAML |
| 工作區工具／外掛探索 | **會**探索工作區工具與外掛（見下方六、附註） | 原生探索；專案不再做載入前排除或啟動前預檢 |
| 網路 | `webfetch` / `websearch` 直接 `allow`，走原生全域 fetch | 同樣改回原生讀取／搜尋，不再自建受控替換傳輸 |
| 復原 | 規格明示維持既有的 context-free recovery 與可選所有權檢查 | 共用復原；不再強制額外的所有權記錄或完整脈絡前置驗證 |
| LSP | 兩個 agent 各自 `"lsp": "deny"` | 兩種模式各自 `tools.approval.lsp: deny` |

## 對照 1：代理類型與設定

| 項目 | OpenCode | OMP |
|---|---|---|
| 支援清單 | 同一份 `SUPPORTED_AGENT_TYPES`（`src/acp/types.ts:183`） | 同左 |
| 預設值 | `getDefaultAgentType()` 未設定時回傳 `"opencode"`（`src/acp/agent-factory.ts:413`） | 需明確設定才會被選用 |
| 憑證 | `src/acp/sandbox-manager.ts:67-72`：`GEMINI_API_KEY`、`OPENROUTER_API_KEY`、`OPENCODE_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY` | `:75-78`：僅 `GEMINI_API_KEY`、`OPENROUTER_API_KEY` |
| 規格 | `Supported Agent Types`、`Deployment Agent Type Value Domain And Synchronization` | 同一條 |

**關係：共用**（同一份型別、驗證與選單；只有憑證集合不同）。

## 對照 2：自有設定

| 項目 | OpenCode | OMP |
|---|---|---|
| 政策載體 | `agent-config/opencode.json` 的兩個 agent 區塊：`build`（受限）與 `yolo` | 兩份獨立手寫原生 YAML：`agent-config/omp/restricted.yml`、`native-yolo.yml` |
| 疊加方式 | `build` 為 `default_agent`；YOLO 是「切換 agent」不是「換設定檔」 | 啟動時以 `--config <mode>.yml` 載入單一模式文件，由原生 OMP 解析 |
| 設定探索 | 依賴 `$HOME/.config/opencode/`（且由程式寫入技能探索宣告） | 原生設定探索；共用沙箱環境過濾清除外來設定選擇器（已無 OMP 專屬清理或身分閘門） |
| 模型設定 | 於 `opencode.json` 內 | 原生 OMP 自 `~/.omp/agent/models.yml` 讀取（手寫，非 overlay） |
| 規格 | `Generated OpenCode Skill Discovery Declaration` | `Handwritten Native OMP Configuration Consumption`、`Authored Native OMP Provider Configuration And Identity` |

**關係：同目標不同機制**（OpenCode 為「單一 JSON + 兩個 agent」；OMP 為「手寫原生 YAML + 原生解析」）。

> 早期版本另有「7 邊界稽核帳本」（`src/acp/omp/compatibility-contracts.ts`）作為 parity 基準。該治理帳本在 `cutover-omp-native-runtime` 已刪除；本頁不再以它作為對照依據。

## 對照 3：LSP 停用

| 項目 | OpenCode | OMP |
|---|---|---|
| 載體 | `build` 與 `yolo` 各自 `"lsp": "deny"`（`agent-config/opencode.json`） | 兩種模式各自 `tools.approval.lsp: deny`（`agent-config/omp/restricted.yml`、`native-yolo.yml`） |
| 全域抑制 | 不引入全域 clamp | 不引入 `--no-lsp` 或全域 `lsp.enabled: false` |
| 規格 | `OpenCode Both Agents Explicitly Deny The LSP Tool` | `OMP Native Capability Policy Parity`、`Permissive Native OMP ACP Launch With Explicit LSP Denial` |

**關係：同目標不同機制**。兩者都只證明「lsp 工具被拒絕」，**不**斷言「語言伺服器絕不啟動」（`docs/AGENT_PERMISSIONS.md`）。

## 對照 4：啟動與行程池

| 項目 | OpenCode | OMP |
|---|---|---|
| 指令 | `opencode` + `acp`，**不帶模式 CLI 旗標** | `omp acp` + `--config <mode>.yml` + `--system-prompt <path>`（受限模式另加 `--trusted-extension <path>`） |
| 模式切換 | `getSessionModeOverride("opencode", true) === "yolo"` → ACP `setSessionMode` | 恆為 `null`；模式只在 spawn 決定 |
| 可變狀態 | 池模式：`XDG_DATA_HOME`、`TMPDIR` 依 poolKey；單次模式：`{workingDir}/tmp` + `SESSION_ID` | 僅原生資料目錄依模式區分（`{baseRoot}/omp-agent/{mode}/xdg-data` → `$XDG_DATA_HOME/omp`）；cwd 與 `TMPDIR` 沿用一般慣例；config HOME 為正常繼承的部署 HOME |
| 行程池鍵 | 只含對話識別（`{platform}:{channelId}` 等）→ 同池跨模式重用 | 併入 `agentType` + `permissionMode` |
| 規格 | `OpenCode YOLO Mode Switching`、`OpenCode Launch Non-Regression`、`OpenCode Pool Reuse Unchanged By Mode Splitting` | `Native OMP Approval Mode Selection At Process Launch` 系列、`Per-Spawn OMP Mode Distinctness …` |

**關係：同目標不同機制**（OpenCode 靠「同行程換 agent」，OMP 靠「不同行程換設定」）。

## 對照 5：工具授權與執行強制

| 項目 | OpenCode | OMP |
|---|---|---|
| 清單定義 | `permission` 表：`"*": "deny"` 開頭，逐工具允許 `read`/`list`/`glob`/`grep`/…，`edit: "ask"` | 凍結能力對照表 `OMP_TOOL_CAPABILITY_MAP`（`src/acp/omp/tool-inventory.ts:32`） |
| 執行位置 | OpenCode 行程內引擎 → 需要時發 ACP `requestPermission` → 本專案閘門決定 | 原生 callback（`api.on("tool_call")`）在分派前擋下未對應名稱；ACP 閘門仍為第二層 |
| 未知工具 | `permission["*"] = "deny"` 的明確拒絕 | 未在對照表內的名稱以 `rejected_unknown_tool` 擋下 |
| 破壞性入口 | 共用解碼器（`requestDestructivePermission`） | 共用解碼器 + OMP 原生形狀正規化（`src/acp/omp/destructive-ingress.ts`） |
| 規格 | `Permission Handling — Restricted Mode`、`Generic-Command Policy Parity Under Canonicalization` | `OMP Native Capability Policy Parity`、`Native OMP Capability Admission Before Tool Dispatch` |

**關係：同目標不同機制**（政策載體不同；共用授權判定）。

> 早期版本的「工具來源／登記表世代／批准記錄」與「自有模組實體部署證據」屬 **OMP 專屬**治理機制，皆已在 `cutover-omp-native-runtime` 刪除。

## 對照 6：破壞性操作與路徑邊界

| 模組 | OpenCode | OMP | 關係 |
|---|---|---|---|
| `src/acp/destructive-policy.ts` | 經 `client.ts` 的破壞性權限分支使用 | 先經 `src/acp/omp/destructive-ingress.ts` 正規化原生形狀，再走同一份解碼／授權 | **共用** |
| `src/acp/filesystem-*.ts` | 讀寫授權、實體路徑成員判定 | 同一批模組 | **共用** |
| `src/acp/filesystem-confinement.ts` | bubblewrap 唯讀／可寫掛載 | 同一份（另加所選原生資產／資料掛載） | **共用** |
| `src/acp/command-path-policy.ts` | `bash` 的 `ask` 項次送進閘門後由此判定 | 同一份 | **共用** |
| `src/acp/skill-inventory.ts` | 同一份清單建構 | 同一份 | **共用** |

**規格要求兩條路徑共用同一份決策**：`All-Target Destructive Authorization Under The Common Policy`、`Generic-Command Policy Parity Under Canonicalization`（明言「不得讓任何 OpenCode 命令因此增減批准」）。

## 對照 7：網路

| 項目 | OpenCode | OMP |
|---|---|---|
| 讀取網址 | `webfetch: "allow"` → 原生實作，走全域 fetch | 原生讀取工具（能力對照表對應 `read`） |
| 網頁搜尋 | `websearch: "allow"` → 原生全域 fetch | 原生搜尋工具（能力對照表對應 `web_search`） |
| 結果差異 | 原生行為 | 原生行為；重導向、搜尋後端與結果格式差異為**上游所有** |
| 規格 | `Native OMP Local Read And Search Behavior` | 同一條 + `OMP Native Capability Policy Parity` |

**關係：共用（皆為原生）**。早期 OMP 側的「受控替換傳輸／後端分級／完成閘門」皆已刪除。

## 對照 8：技能

| 項目 | OpenCode | OMP |
|---|---|---|
| 根目錄 | 同一個 `resolveTrustedSkillsRoot()` 輸出（`src/core/skills-root.ts:101`）；`agentType` **不用於選擇** | 同左 |
| 探索宣告 | 啟動時把技能根目錄寫入 `$HOME/.config/opencode/opencode.json`（`src/utils/opencode-paths.ts`） | 由部署者手寫於原生 YAML 的 `skills.customDirectories`（無插值器／產生器／一致性閘門） |
| 技能讀取 | 原生 `read` 為 `allow`，技能路徑透過外部目錄白名單 | 原生 `read skill://...`；共用根目錄為授權來源 |
| 信任階梯 | 無此概念 | 無（信任階梯已移除，改由共用根目錄解析承擔） |
| 容器打包 | 技能樹 `COPY` 到 `/home/deno/.agents/skills`（`$UID:0` 775） | 同一個樹（映像不再另有 OMP 專屬技能樹） |
| 規格 | `Generated OpenCode Skill Discovery Declaration`、`One Configured Skill Root For Every Agent Type`、`Stock Image Declares the Shared Skill Install Root` | `Handwritten Native OMP Configuration Consumption`、`One Configured Skill Root For Every Agent Type` |

**關係**：根目錄解析屬 **共用**；探索宣告的載體屬 **同目標不同機制**。

## 對照 9：封裝與版本

| 項目 | OpenCode | OMP |
|---|---|---|
| 釘選 | `Containerfile` 的 `opencode-unpacker`，`OPENCODE_VERSION` + 每架構 SHA-256 | `omp-unpacker`，`OMP_VERSION` + 每架構 SHA-256（另有 LICENSE／NOTICES 兩個 digest） |
| 執行檔安裝 | `$UID:0` / `775` | 同為 `$UID:0` / `775`（一般安裝慣例） |
| 設定檔安裝 | `/home/deno/.config/opencode/opencode.json`，`$UID:0` / `775` | `/opt/air/omp/**`，同為 `$UID:0` / `775` |
| 版本檢查 | `verifyOpenCodeVersion()`，最低 `1.17.13`，`AGENT_OPENCODE_MIN_VERSION` | `verifyOmpVersion()`，最低 `18.6.1`，`AGENT_OMP_MIN_VERSION` |
| 內部產物摘要清單 | 無 | 無（`PACKAGE-MANIFEST.sha256` 政策已移除；下載檔的 SHA-256 校驗保留） |
| 擴充 bundle | 無（自帶 binary + JSON） | 需產生原生可載入的單一 ESM bundle |
| 規格 | `Pinned OpenCode Version in Container Build` | `Pinned Official OMP Executable With Fail-Closed Checksum Verification` 系列、`OMP Artifact Installation Uses Existing Project Conventions` |

**關係**：釘選＋checksum 的模式屬 **共用**；自有產物 bundle 屬 **OMP 加項**。

## 對照 10：復原、儀表板與觀測

| 項目 | OpenCode | OMP |
|---|---|---|
| 復原 | 規格明示維持既有的 context-free recovery 與可選所有權檢查（`Shared Agent Recovery With OpenCode Context Checks`） | 共用復原；不強制額外所有權記錄或完整脈絡前置驗證 |
| 儀表板代理選單 | 同一份選單（`src/dashboard/public/index.html:552-553`）、同一份 `isSupportedAgentType` 驗證 | 同左 |
| 思考／訊息緩衝 | 同一份 `ChatbotClient`（`src/acp/client.ts:249-250`） | 同左 |

**關係**：儀表板與觀測屬 **共用**；復原的進入前提不同（OpenCode 保留可選檢查，OMP 免強制記錄）。

## 對照 11：測試與文件

| 項目 | OpenCode | OMP |
|---|---|---|
| 生命週期整合測試 | `tests/integration/omp-lifecycle/opencode-regression.integration.test.ts`（非回歸） | 同套件其餘案例（`lifecycle.integration.test.ts`） |
| 技能交接整合測試 | 同一套真實元件鏈路 | 同左（`tests/integration/omp-skill-handoff/`） |
| 設定三檔案同步 | `tests/utils/config-trio-sync.test.ts` | 同左 |
| 生成宣告測試 | `tests/utils/opencode-skill-discovery-declaration.test.ts` | 無（OMP 無生成宣告） |
| 原生 runtime 探測 | 無 | `tests/acp/omp-native-runtime-smoke.test.ts`（真實原生二進位；需 `OMP_NATIVE_ACCEPTANCE=1`） |
| 規格 | `Lifecycle Suite Determinism and Execution Boundaries`、`Consumer ACP Lifecycle And Mode Recovery Regression Suite` | 同左 |

**關係：共用**。

## 逐項對照表

| # | 功能 | OpenCode 側 | OMP 側 | 關係 |
|---|---|---|---|---|
| 1 | 可選的第二種代理：OMP | 預設代理；`src/acp/types.ts` | 第二種；同型別與驗證 | 共用 |
| 2 | 上游相容性契約與稽核 | 無此概念 | 已移除（治理帳本刪除） | — |
| 3 | 模式分離的自有設定內容 | `opencode.json` 的 `build`／`yolo` 區塊 | 兩份手寫原生 YAML | 同目標不同機制 |
| 4 | 自有設定探索來源隔離 | 依賴 `$HOME/.config`（並寫入宣告） | 共用環境過濾（已無 OMP 專屬清理） | 共用 |
| 5 | 兩種模式都停用 LSP | 兩 agent 各自 `"lsp": "deny"` | 兩模式各自 `tools.approval.lsp: deny` | 同目標不同機制 |
| 6 | 依模式啟動 OMP 代理行程 | 單一指令 + `setSessionMode` | 兩獨立 spawn + 模式專屬原生資料 | 同目標不同機制 |
| 7 | 依模式隔離的共享行程池 | 池鍵不含模式，跨模式重用 | 池鍵含模式 | OMP 專屬 |
| 8 | 載入前可執行模組排除 | 進行工作區工具／外掛探索（見附註） | 已移除 | — |
| 9 | 工作區可執行檔預檢 | 無專案端預檢 | 已移除 | — |
| 10 | 受限工具清單決策 | `permission` 表 | 能力對照表 + 分派前預設拒絕 | 同目標不同機制 |
| 11 | 工具呼叫的執行期強制 | ACP 閘門為落地點 | ACP 閘門 + 原生 callback | 部分共用 |
| 12 | 原生擴充 API 接線 | 無（設定檔即政策） | `api.on("tool_call")` | OMP 專屬 |
| 13 | 承認受信任的原生內建工具 | 名稱即政策 | 已移除來源判定，改按能力政策 | 同目標不同機制 |
| 14 | 自有模組的實體部署證據 | 無 | 已移除（一般安裝慣例） | — |
| 15 | 破壞性操作的完整性與授權 | 共用模組 | 共用模組 + OMP 入口正規化 | 共用 |
| 16 | 檔案系統邊界 | 共用模組 | 共用模組 | 共用 |
| 17 | 工作區系統呼叫圍籬 | 共用模組 | 共用模組（另加所選原生資產） | 共用 |
| 18 | 一般命令的路徑參數閘門 | 共用模組 | 共用模組 | 共用 |
| 19 | 技能腳本清單與自動批准 | 共用模組 | 共用模組 | 共用 |
| 20 | 受控 URL 讀取傳輸 | `webfetch: allow`，原生全域 fetch | 已移除，改回原生讀取 | 共用（皆原生） |
| 21 | 受控網頁搜尋 | `websearch: allow`，原生全域 fetch | 已移除，改回原生搜尋 | 共用（皆原生） |
| 22 | 網路替換工具的放行閘門 | 無此概念 | 已移除 | — |
| 23 | 替換工具的原生介面契約 | 使用原生工具，無需自建 | 已移除 | — |
| 24 | 公開程式碼搜尋（移除） | 上游已移除 | 不重建 | 共用結論 |
| 25 | 部署方宣告的技能根目錄設定 | 生成 `skills.paths` + 外部目錄白名單 | 手寫 `skills.customDirectories` | 同目標不同機制 |
| 26 | 自有技能的讀取與交接修復 | 原生 `read` + 外部目錄白名單 | 原生 `skill://` 讀取；共用腳本根／提示／交接不變 | 同目標不同機制 |
| 27 | 技能信任對齊共用根目錄 | 無所有權階梯 | 無（信任階梯已移除） | — |
| 28 | 統一技能根目錄解析 | 同一個 `resolveTrustedSkillsRoot()` | 同左 | 共用 |
| 29 | 固定版本的執行檔與封裝 | `opencode-unpacker` + checksum | `omp-unpacker` + checksum + 原生 bundle | 共用模式 + OMP 加項 |
| 30 | 可被原生載入的擴充套件綑綁 | 無 | Bun 可載入 bundle | OMP 專屬 |
| 31 | 受信任擴充模組（整體架構） | 無 | 薄適配層（能力對照表 + 原生 callback） | OMP 專屬 |
| 32 | 逐啟動復原情境的完整串接 | context-free recovery 與可選所有權檢查維持不變 | 共用復原；不再強制所有權記錄 | 同目標不同機制 |
| 33 | 儀表板可選擇 OMP 代理 | 同一選單 | 同左 | 共用 |
| 34 | 代理思考過程的完整記錄 | 同一 `ChatbotClient` | 同左 | 共用 |
| 35 | 模擬 ACP 生命週期整合測試 | `opencode-regression.integration.test.ts` | 同套件其餘案例 | 共用 |
| 36 | 模擬技能交接整合測試 | 同一鏈路 | 同左 | 共用 |
| 37 | 邊界修正的文件與決策同步 | 設定檔納入生成宣告與三檔案一致性檢查 | 同左 | 共用 |

## 附註：OpenCode 的工作區工具與外掛探索

前一份功能對照文件曾宣稱「OpenCode 不會探索工作區工具或外掛」，**這項結論是錯的，已修正**。上游 OpenCode 的[自訂工具文件](https://opencode.ai/docs/custom-tools/)與[外掛文件](https://opencode.ai/docs/plugins/)都列有工作區探索位置。因此本專案**不**把「沒有專案端預檢」誤寫成「上游沒有探索能力」；OpenCode 側確實會探索工作區工具與外掛，本專案只是不對它做專案端的排除或預檢。

## 現行 OpenCode 側規格需求（節錄）

| 規格檔 | 需求名稱 | 要旨（節錄） |
|---|---|---|
| `acp-integration` | `Supported Agent Types` | 恰好兩種代理類型；省略時為 `opencode` |
| `acp-integration` | `Permission Handling — Restricted Mode` | 對受限請求做白名單與路徑驗證 |
| `acp-integration` | `Permission Handling — YOLO Mode` | 兩種模式取得相同授權結果，不把受限政策複製進 YOLO |
| `acp-integration` | `OpenCode YOLO Mode Switching` | 以 ACP `setSessionMode()` 而非 CLI 旗標切換 |
| `acp-integration` | `OpenCode Launch Non-Regression` | 引入 OMP 分支不得改變 OpenCode 的指令、參數、環境組裝與模式切換 |
| `acp-integration` | `OpenCode Both Agents Explicitly Deny The LSP Tool` | `build` 與 `yolo` 皆須明確拒絕 lsp；不得引入全域 clamp |
| `acp-integration` | `Generic-Command Policy Parity Under Canonicalization` | 正規化只能是表示法改變，任何 OpenCode 命令不得因此增減批准 |
| `acp-integration` | `Lifecycle Suite Determinism and Execution Boundaries` | 組合生命週期套件須具決定性且不需網路／真實代理 |
| `acp-integration` | `Shared Agent Recovery With OpenCode Context Checks` | OpenCode 復原保留既有所有權／閘門檢查；OMP 走共用載入 |
| `agent-sandbox-hardening` | `Filesystem-Touching Bash Tools Route Through the ACP Gate` | 受限 profile 不得把碰檔案系統的 bash 工具設為 `allow` |
| `agent-sandbox-hardening` | `OpenCode Tool-Output Directory Boundary` | 僅在解析出的目錄位於 session 工作區或 TMPDIR 內時才加入邊界 |
| `agent-sandbox-hardening` | `Per-Session Tool-Output Isolation` | 以 `XDG_DATA_HOME` 隔離 OpenCode 資料目錄 |
| `agent-version-compatibility` | `Pinned OpenCode Version in Container Build` | 映像安裝固定版本，不追 `releases/latest` |
| `configuration-and-deployment` | `One Configured Skill Root For Every Agent Type` | 兩種代理共用同一個部署解析出的技能根目錄 |
| `configuration-and-deployment` | `Stock Image Declares the Shared Skill Install Root` | 映像明確設定 `/home/deno/.agents/skills` |
| `configuration-and-deployment` | `Generated OpenCode Skill Discovery Declaration` | 啟動時把技能探索宣告寫入 OpenCode 設定 |

## 證據限制（不可誇大之處）

- **LSP**：兩側都只證明「lsp 工具被拒」；專案不對「語言伺服器絕不啟動」做斷言（`docs/AGENT_PERMISSIONS.md`）。
- **原生執行期行為**（實際 OMP 二進位、容器、沙箱）在文件中一律標示為需維運者實際執行，或需以 `OMP_NATIVE_ACCEPTANCE=1` 的驗收模式取得；見 `docs/USER-RUNTIME-VERIFICATION.md` 與 `docs/OMP_SPAWN.md`。
- **原生讀取／搜尋結果差異**屬上游所有，驗收不要求逐位元組一致。
- 早期 37 項設計與其 migration 前的臆測機制為**歷史設計材料**，見 `docs/superpowers/specs/2026-10-14-omp-opencode-parity-simplification-design.md` 與 `openspec/changes/archive/`。
