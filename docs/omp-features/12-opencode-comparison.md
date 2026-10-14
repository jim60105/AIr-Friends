# 12. OpenCode 對照

本頁逐項對照：**同一個功能，OpenCode 側在本專案裡是怎麼做的**（實作與規格），以及它與 OMP 的關係。

## 對照方法

| 對照來源 | 位置 |
|---|---|
| OpenCode 部署設定 | `agent-config/opencode.json`（113 行完整設定） |
| OpenCode 啟動組裝 | `src/acp/agent-factory.ts`（OpenCode 分支） |
| 兩者共用的 ACP 權限閘門 | `src/acp/client.ts`、`src/acp/destructive-policy.ts`、`src/acp/filesystem-*.ts`、`src/acp/command-path-policy.ts`、`src/acp/skill-inventory.ts` |
| OpenCode 專屬啟動期產出 | `src/utils/opencode-paths.ts`（生成技能探索宣告）、`src/utils/opencode-version.ts` |
| 規格 | `openspec/specs/**/spec.md` 中含 OpenCode 的需求 |
| 既有權威對照文件 | `docs/OMP_SETTINGS.md` §1、`docs/OMP_COMPATIBILITY.md` §2–§3、`docs/AGENT_PERMISSIONS.md`、`docs/OMP_SPAWN.md`、`docs/OMP_POOL_MODES.md` |

關係標記：

| 標記 | 意義 |
|---|---|
| **共用** | 同一份程式碼或同一條規格同時服務兩種代理，行為相同 |
| **同目標不同機制** | 想達成的結果一樣，但機制完全不同 |
| **OMP 專屬** | OpenCode 側沒有等價機制（也不需要） |

## 一句話總結

| 面向 | OpenCode | OMP |
|---|---|---|
| 權限政策來源 | 單一 JSON 的 `permission` 表（`"*": "deny"` + 逐工具 `allow`/`ask`/`deny`），由 OpenCode 自己的權限引擎在呼叫點執行 | 部署方自有 YAML overlay（`tools.approvalMode` + `tools.approval`）+ 受信任擴充模組**在行程內逐次呼叫強制** |
| 模式切換 | 同一支行程上用 ACP `setSessionMode("yolo")` 切到 `yolo` agent | 兩種模式**各自啟動獨立行程**；`getSessionModeOverride("omp", …)` 恆為 `null` |
| 設定檔所有權 | `$HOME/.config/opencode/opencode.json`，`$UID:0` / `775`（**代理可寫**），且啟動時還會被程式改寫（寫入技能探索宣告） | `/opt/air/omp/config/{mode}.yml`，`root:root` / `0644`（**代理不可寫**），探索來源被強制隔離 |
| 工作區程式碼 | 不在工作區載入模組 → 沒有可執行探索路徑 | 會探索 `.omp/tools`、`.omp/plugins` 等並匯入 → 需要「載入前排除」+「啟動前預檢」兩道 |
| 網路 | `webfetch` / `websearch` 直接 `allow`，走原生全域 fetch（自動跟隨重導向） | 以受控替換工具接管，每個 URL／每個跳轉點逐一通過 SSRF 分類器 |
| 復原 | 規格明示維持既有的 context-free recovery 行為 | 取得行程時記錄模式與命名空間，復原前強制驗證所有權 |

## 對照 1：代理類型與設定

| 項目 | OpenCode | OMP |
|---|---|---|
| 支援清單 | 同一份 `SUPPORTED_AGENT_TYPES`（`src/acp/types.ts:149`） | 同左 |
| 預設值 | `getDefaultAgentType()` 未設定時回傳 `"opencode"`（`src/acp/agent-factory.ts:558`） | 需明確設定才會被選用 |
| 憑證 | `src/acp/sandbox-manager.ts:70-75`：`GEMINI_API_KEY`、`OPENROUTER_API_KEY`、`OPENCODE_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY` | `:78-81`：僅 `GEMINI_API_KEY`、`OPENROUTER_API_KEY` |
| 規格 | `Supported Agent Types`、`Deployment Agent Type Value Domain And Synchronization` | 同一條 |

**關係：共用**（同一份型別、驗證與選單；只有憑證集合不同）。

## 對照 2：自有設定與探索隔離

| 項目 | OpenCode | OMP |
|---|---|---|
| 政策載體 | `agent-config/opencode.json` 的兩個 agent 區塊：`build`（受限）與 `yolo`（`agent-config/opencode.json:29-112`） | 兩份獨立 YAML overlay：`agent-config/omp/restricted.yml`、`native-yolo.yml` |
| 疊加方式 | `build` 為 `default_agent`；YOLO 是「切換 agent」不是「換設定檔」 | `--config` 依序疊加（共用 → 模式文件），載入啟動參數 |
| 探索來源 | 依賴 `$HOME/.config/opencode/`（且由程式寫入）；`external_directory` 白名單 4 條（`:95-101`） | 環境變數 selector 一律清除；只允許部署方計畫值 |
| 相容性稽核 | 以 OpenCode `1.18.21` 作為 parity 基準；OpenCode 側本身無「自有模組」概念 | 7 邊界稽核帳本（`src/acp/omp/compatibility-contracts.ts:89`） |
| 規格 | `Owned-Only OMP Settings Discovery Sources` 僅規範 OMP | 另見 `docs/OMP_SETTINGS.md` §1 逐項翻譯表 |

**關係：同目標不同機制**（OpenCode 為「單一 JSON + 兩個 agent」；OMP 為「兩份自有 overlay + 探索隔離」）。

## 對照 3：LSP 停用

| 項目 | OpenCode | OMP |
|---|---|---|
| 載體 | `build` 與 `yolo` 各自 `"lsp": "deny"`（`agent-config/opencode.json:39,109`） | `lsp.enabled: false` 於兩份 overlay + 兩模式皆帶 `--no-lsp` |
| 規格 | `OpenCode Both Agents Explicitly Deny The LSP Tool`（且「不得引入全域 clamp」） | `Restricted and YOLO Overlay Non-Contamination` |
| 證據限制 | 隱含 server 啟動在 1.18.21 是全域機制，**無法按 agent 限定** → 邊界 5b 記為 `incompatible` | 邊界 5a 記為 `unresolved`（`--no-lsp` 與設定的實際抑制未經執行期證明） |

**關係：同目標不同機制**，且**兩者都只能證明「工具被拒」，不能證明「語言伺服器絕不啟動」**（`docs/AGENT_PERMISSIONS.md:98`）。

## 對照 4：啟動與行程池

| 項目 | OpenCode | OMP |
|---|---|---|
| 指令 | `opencode` + `acp`（`src/acp/agent-factory.ts:328-332`），**不帶模式 CLI 旗標** | `omp acp` + `--no-extensions` + 有序 `--config` + `--trusted-extension` + `--system-prompt` |
| 模式切換 | `getSessionModeOverride("opencode", true) === "yolo"` → ACP `setSessionMode` | 恆為 `null`；模式只在 spawn 決定 |
| 可變狀態 | 池模式：`TMPDIR`、`XDG_DATA_HOME`、cwd 依 poolKey；單次模式：`${workingDir}/tmp` + `SESSION_ID` | `PI_CODING_AGENT_DIR`、暫存根、中立啟動 cwd 皆**依模式**分離 |
| 行程池鍵 | 只含對話識別（`{platform}:{channelId}` 等）→ 同池跨模式重用 | 併入 `agentType` + `permissionMode` |
| 規格 | `OpenCode YOLO Mode Switching`、`OpenCode Launch Non-Regression`、`OpenCode Pool Reuse Unchanged By Mode Splitting` | `Mode-Scoped OMP Spawn Resolution` 系列、`Per-Spawn OMP Mode Distinctness …` |

**關係：同目標不同機制**（OpenCode 靠「同行程換 agent」，OMP 靠「不同行程換設定」）。

## 對照 5：工具授權與執行強制

| 項目 | OpenCode | OMP |
|---|---|---|
| 清單定義 | `permission` 表：`"*": "deny"` 開頭，逐工具允許 `read`/`list`/`glob`/`grep`/`todoread`/`todowrite`/`skill`/`webfetch`/`websearch`、`edit: "ask"`、`task`/`doom_loop`/`question` 拒絕（`agent-config/opencode.json:33-48`） | 純函式清單表 `RESTRICTED_TOOL_INVENTORY_TABLE`（`src/acp/omp/tool-inventory.ts:213`）＋來源判定＋替代入口封鎖 |
| 執行位置 | OpenCode 行程內引擎 → 需要時發 ACP `requestPermission` → 本專案閘門決定 | 受信任擴充 handler 在**每次**呼叫時決策；ACP 閘門仍為第二層 |
| 工作區模組 | 不在工作區載入 → 無探索問題 | 載入前排除 + 啟動前預檢兩道（`discovery-guard.ts`、`executable-sources.ts`） |
| 原生工具來源 | 政策以「註冊 tool id 名稱」綁定，名稱即可 | 必須判定來源（native-builtin / owned-extension / operator-MCP / 未知） |
| 記錄（approval/record） | 無對等概念（政策即表） | 需解讀原生批准記錄，且**存活記錄永不授予執行權** |
| 模組不可變性 | 無（設定檔可被代理寫入） | 自有模組需實體部署證據（`deployment-module.ts`、`owned-module-evidence.ts`） |

**關係**：清單與決策屬 **同目標不同機制**；「載入前排除」「模組證據」屬 **OMP 專屬**。

## 對照 6：破壞性操作與路徑邊界

| 模組 | OpenCode | OMP | 關係 |
|---|---|---|---|
| `src/acp/destructive-policy.ts` | 經 `client.ts` 的 `requestDestructivePermission` 使用（`src/acp/client.ts:574-687`） | 經 `src/acp/omp/destructive-decision.ts` 逐字委派使用 | **共用** |
| `src/acp/filesystem-*.ts` | 讀寫授權、實體路徑成員判定 | 同一批模組 | **共用** |
| `src/acp/filesystem-confinement.ts` | bubblewrap 唯讀/可寫掛載 | 同一份 | **共用** |
| `src/acp/command-path-policy.ts` | `bash` 的 `ask` 項次送進閘門後由此判定 | 同一份 | **共用** |
| `src/acp/skill-inventory.ts` | 同一份清單建構 | 同一份 | **共用** |

**規格要求兩條路徑共用同一份決策**：`Shared Client And Extension Destructive Decision Surface`、`Generic-Command Policy Parity Under Canonicalization`（明言「不得讓任何 OpenCode 命令因此增減批准」）。

## 對照 7：網路

| 項目 | OpenCode | OMP |
|---|---|---|
| 讀取網址 | `webfetch: "allow"` → 原生實作，走全域 fetch（自動跟隨重導向） | 受控替換工具，逐跳手動重導向 + SSRF 逐跳重驗 + 走驗證代理 |
| 網頁搜尋 | `websearch: "allow"` → 原生全域 fetch | 受控替換工具，後端限定 Gemini／OpenRouter，憑證缺席即封鎖 |
| 公開程式碼搜尋 | 上游 `1.18.21` 已移除 `codesearch`（設定 key 失效） | 同樣移除（規格 `Dedicated Public Code Search Is Outside OpenCode Parity`） |
| 規格 | 邊界 6 記載 OpenCode 側 `fetchBinary` 使用 `redirect: "follow"` | `Controlled URL-Fetch Transport Adapter Decision Core` 系列 |

**關係：同目標不同機制**；移除公開程式碼搜尋是 **共用結論**。

## 對照 8：技能

| 項目 | OpenCode | OMP |
|---|---|---|
| 根目錄 | 同一個 `resolveTrustedSkillsRoot()` 輸出（`src/core/skills-root.ts:101`）；`agentType` **不用於選擇** | 同左 |
| 探索宣告 | 啟動時把 `skills.paths` 與 `external_directory` 的 `"<root>/**": "allow"` 寫入 `$HOME/.config/opencode/opencode.json`（`src/utils/opencode-paths.ts:541-639`） | 由自有 overlay 產生 `skills.customDirectories`，並寫出單鍵技能根目錄宣告 |
| 技能讀取 | 原生 `read` 為 `allow`，技能路徑透過 `external_directory` 白名單 | 需替換工具支援 `skill://`，並以共享根目錄為授權來源 |
| 所有權階梯 | 無此概念 | 曾要求 root 擁有／不可寫；後刻意放寬以接受共用根目錄 |
| 容器打包 | 技能樹 `COPY` 到 `/home/deno/.agents/skills`（`$UID:0` 775） | 同一個樹，映像另有 root 擁有的 `/opt/air/omp` 自有樹 |
| 規格 | `One Configured Skill Root For Every Agent Type`、`Stock Image Declares the Shared Skill Install Root`、`Generated OpenCode Skill Discovery Declaration` | `Deployment-Owned OMP Skill Root Settings`、`OMP Owned Skill Read And Execution Over The Shared Root` |

**關係**：根目錄解析屬 **共用**；探索宣告與讀取機制屬 **同目標不同機制**；信任階梯放寬屬 **OMP 專屬**。

## 對照 9：封裝與版本

| 項目 | OpenCode | OMP |
|---|---|---|
| 釘選 | `Containerfile` 的 `opencode-unpacker`，`OPENCODE_VERSION` + 每架構 SHA-256 | `omp-unpacker`，`OMP_VERSION` + 每架構 SHA-256（另有 LICENSE／NOTICES 兩個 digest） |
| 執行檔所有權 | `$UID:0` / `775` 模式 | **刻意分歧**：`root:root` / `0755`（代理不得改寫自己的執行檔） |
| 設定檔安裝 | `/home/deno/.config/opencode/opencode.json`，`$UID:0` / `775`（可寫） | `/opt/air/omp/**`，`root:root` / `0644`（不可寫） |
| 版本檢查 | `verifyOpenCodeVersion()`，最低 `1.17.13`，`AGENT_OPENCODE_MIN_VERSION` | `verifyOmpVersion()`，最低 `18.6.1`，`AGENT_OMP_MIN_VERSION` |
| 摘要清單 | 無 | `PACKAGE-MANIFEST.sha256`（任何輸入變動都必須重算） |
| 擴充 bundle | 無（自帶 binary + JSON） | 需產生原生可載入的單一 ESM bundle |
| 規格 | `Pinned OpenCode Version in Container Build` | `Pinned Official OMP Executable With Fail-Closed Checksum Verification` 系列 |

**關係**：釘選＋checksum 的模式屬 **共用**；所有權、自有樹、manifest、bundle 屬 **OMP 加項**。

## 對照 10：復原、儀表板與觀測

| 項目 | OpenCode | OMP |
|---|---|---|
| 復原 | 規格明示「OpenCode 既有的 context-free recovery **維持不變**」（`OMP Recovery Cannot Select a Context-Free Legacy Path`） | 有所有權 provenance，復原前先驗證模式與命名空間，不符即不動 |
| 儀表板代理選單 | 同一份選單（`src/dashboard/public/index.html:552-553`）、同一份 `isSupportedAgentType` 驗證 | 同左 |
| 思考／訊息緩衝 | 同一份 `ChatbotClient`（`src/acp/client.ts:248-249`） | 同左 |

**關係**：儀表板與觀測屬 **共用**；復原屬 **OMP 專屬**。

## 對照 11：測試與文件

| 項目 | OpenCode | OMP |
|---|---|---|
| 生命週期整合測試 | `tests/integration/omp-lifecycle/opencode-regression.integration.test.ts`（非回歸） | 同套件其餘案例 |
| 技能交接整合測試 | 同一套真實元件鏈路 | 同左 |
| 設定三檔案同步 | `tests/utils/config-trio-sync.test.ts`（含 OMP 對照表） | 同左 |
| 生成宣告測試 | `tests/utils/opencode-skill-discovery-declaration.test.ts` | `tests/acp/omp-skill-root-declaration.test.ts` |
| 規格 | `Combined Mock-ACP Lifecycle Integration Suite`（要求 OpenCode 非回歸流程維持一致） | 同左 |

**關係：共用**。

## 逐項對照表

| # | 功能 | OpenCode 側 | OMP 側 | 關係 |
|---|---|---|---|---|
| 1 | 可選的第二種代理：OMP | 預設代理；`src/acp/types.ts:143-163` | 第二種；同型別與驗證 | 共用 |
| 2 | 上游相容性契約與稽核 | 作為 parity 基準（`1.18.21`） | 7 邊界稽核帳本 | OMP 專屬 |
| 3 | 模式分離的自有設定內容 | `opencode.json` 的 `build`／`yolo` 區塊 | 兩份 YAML overlay | 同目標不同機制 |
| 4 | 自有設定探索來源隔離 | 無（依賴並寫入 `$HOME/.config`） | 強制清除 selector | OMP 專屬 |
| 5 | 兩種模式都停用 LSP | 兩 agent 各自 `"lsp": "deny"` | 兩 overlay pin + `--no-lsp` | 同目標不同機制 |
| 6 | 依模式啟動 OMP 代理行程 | 單一指令 + `setSessionMode` | 兩獨立 spawn + 模式專屬狀態 | 同目標不同機制 |
| 7 | 依模式隔離的共享行程池 | 池鍵不含模式，跨模式重用 | 池鍵含模式 | OMP 專屬 |
| 8 | 載入前可執行模組排除 | 無此問題 | 載入前排除決策 | OMP 專屬 |
| 9 | 工作區可執行檔預檢 | 無此問題 | 啟動／session 前預檢 | OMP 專屬 |
| 10 | 受限工具清單決策 | `permission` 表 | 純函式清單 + 來源 + 替代入口 | 同目標不同機制 |
| 11 | 工具呼叫的執行期強制 | ACP 閘門為落地點 | ACP 閘門 + 行程內 handler | 部分共用 |
| 12 | 原生擴充 API 接線 | 無（設定檔即政策） | `api.on`／`api.registerTool` | OMP 專屬 |
| 13 | 承認受信任的原生內建工具 | 名稱即政策 | 需來源判定 | 同目標不同機制 |
| 14 | 自有模組的實體部署證據 | 無（設定檔可被代理寫入） | 需實體證據 | OMP 專屬 |
| 15 | 破壞性操作的完整性與授權 | 共用模組 | 共用模組 | 共用 |
| 16 | 檔案系統邊界 | 共用模組 | 共用模組 | 共用 |
| 17 | 工作區系統呼叫圍籬 | 共用模組 | 共用模組 | 共用 |
| 18 | 一般命令的路徑參數閘門 | 共用模組 | 共用模組 | 共用 |
| 19 | 技能腳本清單與自動批准 | 共用模組 | 共用模組 | 共用 |
| 20 | 受控 URL 讀取傳輸 | `webfetch: allow`，原生全域 fetch | 受控替換工具 | 同目標不同機制 |
| 21 | 受控網頁搜尋 | `websearch: allow`，原生全域 fetch | 受控替換工具 + 後端分級 | 同目標不同機制 |
| 22 | 網路替換工具的放行閘門 | 無 seam 概念 | 完成標記 + 有界封鎖 | OMP 專屬 |
| 23 | 替換工具的原生介面契約 | 使用原生工具，無需自建 | 需符合原生 schema／content | OMP 專屬 |
| 24 | 公開程式碼搜尋（移除） | 上游已移除 | 同步移除 | 共用 |
| 25 | 部署方宣告的技能根目錄設定 | 生成 `skills.paths` + `external_directory` | 生成 `skills.customDirectories` + 單鍵宣告 | 同目標不同機制 |
| 26 | 自有技能的讀取與交接修復 | 原生 `read` + `external_directory` | 替換工具支援 `skill://` | 同目標不同機制 |
| 27 | 技能信任對齊共用根目錄 | 無所有權階梯 | 刻意放寬所有權條款 | OMP 專屬 |
| 28 | 統一技能根目錄解析 | 同一個 `resolveTrustedSkillsRoot()` | 同左 | 共用 |
| 29 | 固定版本的執行檔與封裝 | `opencode-unpacker` + checksum | `omp-unpacker` + checksum + 自有樹 + manifest | 共用模式 + OMP 加項 |
| 30 | 可被原生載入的擴充套件綑綁 | 無 | Bun 可載入 bundle | OMP 專屬 |
| 31 | 受信任擴充模組（整體架構） | 無 | 行程內管制核心 | OMP 專屬 |
| 32 | 逐啟動復原情境的完整串接 | context-free recovery 維持不變 | 所有權驗證 | OMP 專屬 |
| 33 | 儀表板可選擇 OMP 代理 | 同一選單 | 同左 | 共用 |
| 34 | 代理思考過程的完整記錄 | 同一 `ChatbotClient` | 同左 | 共用 |
| 35 | 模擬 ACP 生命週期整合測試 | `opencode-regression.integration.test.ts` | 同套件其餘案例 | 共用 |
| 36 | 模擬技能交接整合測試 | 同一鏈路 | 同左 | 共用 |
| 37 | 邊界修正的文件與決策同步 | 設定檔納入生成宣告與三檔案一致性檢查 | 同左 | 共用 |

## 既有權威對照文件索引

| 文件 | 位置 | 內容 |
|---|---|---|
| `docs/OMP_SETTINGS.md` | §1（第 9–22 行） | OpenCode → OMP 設定逐項翻譯表（11 個子系統，含原生行為差異） |
| `docs/OMP_COMPATIBILITY.md` | §2（第 144–148 行）、§3（第 162–171 行）、§4 | 固定版本與參考權威、七邊界決策帳本、不相容機制詳析 |
| `docs/AGENT_PERMISSIONS.md` | 第 83–101 行 | LSP 停用載體矩陣（OMP／OpenCode × 顯式／隱含） |
| `docs/OMP_SPAWN.md` | §1（第 9–20 行） | 模式解析差異（OpenCode 同行程切換 vs OMP 獨立 spawn） |
| `docs/OMP_POOL_MODES.md` | §Process identity and state（第 5–11 行） | 行程重用與池鍵隔離差異 |

## OpenCode 側規格需求（節錄）

| 規格檔 | 需求名稱 | 要旨（節錄） |
|---|---|---|
| `acp-integration` | `Supported Agent Types` | 恰好兩種代理類型；省略時為 `opencode` |
| `acp-integration` | `Permission Handling — Restricted Mode` | 對 OpenCode 的 `kind: "edit"`／舊式 edit/write 標題視為受範圍限制的檔案修改請求 |
| `acp-integration` | `Permission Handling — YOLO Mode` | 兩種模式取得相同授權結果，不把受限政策複製進 YOLO |
| `acp-integration` | `OpenCode YOLO Mode Switching` | 以 ACP `setSessionMode()` 而非 CLI 旗標切換 |
| `acp-integration` | `OpenCode Launch Non-Regression` | 引入 OMP 分支不得改變 OpenCode 的指令、參數、環境組裝與模式切換 |
| `acp-integration` | `OpenCode Both Agents Explicitly Deny The LSP Tool` | `build` 與 `yolo` 皆須明確拒絕 lsp；不得引入全域 clamp |
| `acp-integration` | `Generic-Command Policy Parity Under Canonicalization` | 正規化只能是表示法改變，任何 OpenCode 命令不得因此增減批准 |
| `acp-integration` | `Combined Mock-ACP Lifecycle Integration Suite` | OpenCode 非回歸流程須維持一致 |
| `acp-integration` | `Dedicated Public Code Search Is Outside OpenCode Parity` | 本地搜尋、公開 URL 讀取、一般網路搜尋才是 parity 目標 |
| `acp-integration` | `OMP Recovery Cannot Select a Context-Free Legacy Path` | OpenCode 既有的 context-free recovery 維持不變 |
| `agent-sandbox-hardening` | `Filesystem-Touching Bash Tools Route Through the ACP Gate` | 受限 profile 不得把碰檔案系統的 bash 工具設為 `allow` |
| `agent-sandbox-hardening` | `OpenCode Tool-Output Directory Boundary` | 僅在解析出的目錄位於 session 工作區或 TMPDIR 內時才加入邊界 |
| `agent-sandbox-hardening` | `Per-Session Tool-Output Isolation` | 以 `XDG_DATA_HOME` 隔離 OpenCode 資料目錄 |
| `agent-version-compatibility` | `Pinned OpenCode Version in Container Build` | 映像安裝固定版本，不追 `releases/latest` |
| `configuration-and-deployment` | `One Configured Skill Root For Every Agent Type` | 兩種代理共用同一個部署解析出的技能根目錄 |
| `configuration-and-deployment` | `Stock Image Declares the Shared Skill Install Root` | 映像明確設定 `/home/deno/.agents/skills` |
| `configuration-and-deployment` | `Generated OpenCode Skill Discovery Declaration` | 啟動時把技能探索宣告寫入 OpenCode 設定 |

## 證據限制（不可誇大之處）

- **LSP**：兩側都只證明「lsp 工具被拒」；OpenCode 的隱含 server 啟動在固定版本是全域機制、無法按 agent 限定（邊界 5b `incompatible`）；OMP 側記為 `unresolved`（`docs/AGENT_PERMISSIONS.md:98`）。
- **七邊界的「Status」欄指的是原生機制狀態**，不是部署控制的成敗；`DECIDED` 的部署處置另立欄位記錄（`docs/OMP_COMPATIBILITY.md:162-171`）。
- **執行期行為**（實際行程、容器、沙箱）在文件中一律標記為 **UNVERIFIED**，需維運者實際執行；見 `docs/USER-RUNTIME-VERIFICATION.md`。
- **OMP 技能根目錄所有權放寬**是刻意的安全取捨，已記錄於變更 `align-omp-skill-trust-to-shared-root` 的 `design.md`。
