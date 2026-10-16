# ACP 引擎整合

AIr-Friends 是一套 **ACP (Agent Client Protocol)** 客戶端系統，負責維護平台連線、記憶與權限，將核心推理交由外部 ACP 代理人引擎。系統目前支援 **OpenCode CLI** 與 **Oh-My-Pi (OMP)** 兩種主流的代理人後端。

---

## OpenCode 與 OMP 後端架構比較

| 特性比較 | OpenCode CLI (`opencode`) | Oh-My-Pi (`omp`) |
| :--- | :--- | :--- |
| **通訊方式** | 子行程 Stdio JSON-RPC | 子行程 Stdio JSON-RPC |
| **組態檔案** | `opencode.json`（JSON 格式） | 手寫原生 YAML（`restricted.yml`, `native-yolo.yml`, `models.yml`） |
| **沙盒隔離** | 工作階段模式控制 + 檔案存取過濾 | 支援以 bwrap 進行作業系統層級掛載隔離 + 原生擴充套件回呼機制 |
| **自訂技能載入** | 讀取單一受信任的技能根目錄 | 透過 `skills.customDirectories` 指向單一受信任技能根目錄 |
| **模型設定路徑** | 透過環境變數或 CLI 參數傳遞 | 位於 OMP 組態根目錄之 `models.yml` (`getAgentDir()/models.yml`) |
| **版本檢查行為** | 無硬性版本檢查 | 啟動時透過 `verifyOmpVersion()` 執行軟性警告檢查 |

---

## 部署先決條件矩陣 (Setup Matrix)

ACP 引擎依部署型態需要不同的先決條件。

| 先決條件項目 | 容器化部署 (Podman/Docker) | 本機開發或自訂主機部署 |
| :--- | :--- | :--- |
| **代理人執行檔** | 官方發布映像檔已預先包裝對應二進位檔 | 須於主機 `$PATH` 安裝 `opencode` 或 `omp` 執行檔 |
| **OMP 原生模式 YAML** | 映像檔預先內建於 `/opt/air/omp/config/` | 須手動提供 `agent-config/omp/restricted.yml` 與 `native-yolo.yml`（無插值或產生器） |
| **OMP 模型清單 (`models.yml`)** | 預先安裝至 `/home/deno/.omp/agent/models.yml` | 須手動建立於 `$HOME/.omp/agent/models.yml`，且模型 ID 須對齊 OMP 格式 |
| **技能目錄 (`skills.customDirectories`)**| 指向單一共用根目錄 `/home/deno/.agents/skills/` | 在 OMP 模式檔與 `AGENT_SKILLS_DIR` 明確配置相同的技能目錄路徑 |
| **OMP 擴充套件 Bundle** | 映像檔建置時自動產生於 `/opt/air/omp/extension/index.js` | 開發環境使用產生的 `build/omp-extension/index.js` |
| **OMP 原生執行階段快取** | 映像檔建置時自動準備於 `/opt/air/omp/native-cache/{platform}/natives/18.6.1/`（OMP 啟動的硬性先決條件） | 須以固定版本執行檔執行 `deno task prepare:omp-natives`，預設輸出於 `${XDG_CACHE_HOME:-$HOME/.cache}/air-friends/omp/{platform}/natives/18.6.1/` |
| **LSP 阻絕政策** | 映像檔模式檔已設定 `tools.approval.lsp: deny` | 手寫模式檔必須在受限與 YOLO 模式中明確宣告 LSP 拒絕 |

---

## OMP 原生執行階段重要部署契約

配置 OMP 原生執行環境時，有四項契約需要留意。

### 手寫原生配置無動態插值

OMP 模式設定（`agent-config/omp/restricted.yml` 與 `native-yolo.yml`）是由 OMP 本身直接解析的原生 YAML，AIr-Friends 程式碼不會對其進行字串插值、範本替換或動態重寫。

### 共用單一受信任技能根目錄

雙代理人共用單一技能根目錄。自訂部署時，維運者必須手動在 OMP 模式 YAML 中的 `skills.customDirectories` 填入技能路徑，並與系統的 `agent.skillsDir`（或 `AGENT_SKILLS_DIR`）指向相同目錄。

### 金鑰與憑證傳遞界限

OMP 子行程採用繼承之 HOME 環境，但沙盒環境下僅會轉發核可的供應商金鑰（如 `GEMINI_API_KEY`、`OPENROUTER_API_KEY`），其餘非核可環境變數與平台權杖受到模組層級隔離。

### 雙模式 LSP 工具阻絕

在受限模式與原生 YOLO 模式下，皆透過模式檔中精確命名的 `tools.approval.lsp: deny` 阻擋 LSP 工具呼叫，但這屬於工具審查層面，不代表能完全壓制原生語言伺服器的內部隱式啟動。

---

## 共用原生執行階段快取準備 (`prepare:omp-natives`)

OMP 的原生載入器會把內嵌的原生附加檔（native addons，單一平台約 380 MB）解壓縮到 `$XDG_DATA_HOME/omp/natives/{version}`。AIr-Friends 改為準備**單一共用原生內容**（payload），讓所有模式、pool 與每次啟動的根目錄以符號連結共用同一份位元組。這份原生內容是 OMP 啟動的**硬性先決條件**，缺少、不完整或身分不符時，啟動階段會直接失敗並附上準備指令，不會退回由載入器自行解壓縮。

映像檔建置時，`Containerfile` 的 `omp-unpacker` 階段會在執行檔雜湊校驗完成後自動執行同一支準備程式，並以專案既有的 `$UID:0`／775 慣例安裝到 `/opt/air/omp/native-cache/{platform}/natives/18.6.1/`；`{platform}` 為 `linux-x64` 或 `linux-arm64`，映像檔只包含自身目標平台的那一份。本機開發或自訂主機部署則需手動執行：

```bash
# 建置受信任原生擴充套件 Bundle（映像檔建置時自動執行相同步驟）
deno task bundle:omp-extension

# 準備共用的 OMP 原生執行階段快取
# 預設輸出：${XDG_CACHE_HOME:-$HOME/.cache}/air-friends/omp/{platform}/natives/18.6.1/
deno task prepare:omp-natives
```

`prepare:omp-natives` 預設解析 `$PATH` 上的 `omp` 執行檔，也可以 `--executable <path>` 明確指定。準備程式要求執行檔版本恰為固定的 `18.6.1`（快取身分取自版本固定值，`AGENT_OMP_MIN_VERSION` 不影響快取身分）、驗證該平台官方執行檔的 SHA-256，接著以拋棄式的 HOME／工作目錄與既有的臨時 `XDG_DATA_HOME/omp` 執行一次有界的 ACP `initialize` 交握，最後只發布原生子樹與其附帶的 `native-manifest.json` 清單檔；探測過程產生的資料庫、HOME 與工作階段一律丟棄。

準備流程為獨占且不可分割（同檔案系統暫存目錄加原子更名），所以**變更已發布的原生內容前必須先停止部署**，完成後再啟動。目的地若已是完整且相符的原生內容，會經驗證後直接沿用而不重寫；不完整的既有目的地則明確失敗，不會被覆蓋。

此外，若既有根目錄的 `omp/natives` 項目已是**實體目錄**（舊版 OMP 在該根目錄自行解壓縮的殘留），系統不會追隨或自動清除它，而是在產生代理人之前以「項目被佔用」的診斷失敗，訊息同時給出精確路徑與移除操作範例。維運者必須先手動清除該目錄，OMP 工作階段才能恢復；本專案不提供自動清理或搬移。

---

## OMP 版本檢驗機制 (`verifyOmpVersion`)

在系統啟動流程（`src/bootstrap.ts`）中，若當前解析的代理人引擎為 `omp`，系統會呼叫 `src/utils/omp-version.ts` 中的 `verifyOmpVersion()` 函式，在 5 秒超時內執行 `omp --version`，過程不發出網路請求，也不啟動完整 ACP 工作階段。檢查結果以結構化標記寫入日誌，`OMP version check: OK` 表示版本符合已知相容標準（最低基準版本為 `18.6.1`），`OMP version check: BELOW_MINIMUM` 表示版本低於標準，`OMP version check: UNKNOWN` 表示無法正確解析版本字串，後兩者僅發出警告日誌。這項檢查只作為維運輔助警示（Warn-only），即使低於基準版本，系統也不會強制中斷或阻擋啟動。期望的最低版本可透過環境變數 `AGENT_OMP_MIN_VERSION` 覆寫。

---

## 目前工作階段的 OMP bash 產物讀取例外

OMP 會把被截斷的 bash 輸出寫進原生工作階段日誌旁的產物目錄，檔名形如 `<數字識別碼>.bash.log`。ACP 回呼預設拒絕 `.log` 讀取，因此本專案為**目前這個**原生工作階段註冊一項唯讀能力。

- 來源只採用受信任的生命週期資訊：factory 選定的 `XDG_DATA_HOME`、`session/new` 回傳的原生 ACP UUID，以及已註冊的工作階段 cwd。模型提供的路徑、技能 API 工作階段 ID 與環境變數 `HOME` 都不構成授權依據。
- 解析器只在 `<XDG_DATA_HOME>/omp/sessions` 及其直接子目錄（bucket）中，尋找檔名符合固定時間戳格式且 UUID 後綴完全相符的日誌，最多檢查 4096 個 bucket 與 16384 筆項目。中繼資料以受保護的無追蹤讀取取得前 64 KiB，解析前四行（允許原生標題插槽位於首行），要求標頭 UUID 與 cwd 相符（兩者都以同一套實際路徑規則正規化後比較），且恰好一筆符合。超出界線、重複、格式錯誤、不可讀或元件不安全時，一律不授予能力，也不影響工作階段其他已授權的操作。
- 可讀取的僅限該目錄下的直接一般檔案，且檔名符合 `^[0-9]+\.bash\.log$`。其他副檔名、巢狀子目錄、符號連結、目錄與特殊節點都會在讀取內容前拒絕。此例外在受限模式與原生 YOLO 模式皆為唯讀。

### 保留的 OMP 原生狀態優先於廣泛工作區授權

對 OMP 回呼脈絡，`{工作階段 cwd}/tmp/omp-agent`（涵蓋兩個模式子目錄）與 connector 選定的原生資料根目錄，都會從一般工作區、staging 與共用工作區授權中排除。保留範圍同時包含這些設定路徑**實際解析後的目標**，所以把原生狀態放進工作區某個連結後面，也不會讓它因為落在大範圍工作區之內而取得回呼權限。因此同一部署下的同儕工作階段、同儕模式、原生日誌、auth 與資料庫檔案，即使副檔名是 `.md` 或 `.jsonl`，都不會取得回呼權限。保留區與受信任技能根目錄或共用可寫根目錄重疊時，系統直接拒絕，不會借用那些角色。

若某次變更類權限請求的保留狀態無法完成判定（工作階段脈絡缺失，或無關的根目錄無法觀測），系統一律拒絕，不會退回 YOLO 或技能白名單的核准路徑；拒絕時只會選取明確的拒絕選項，沒有拒絕選項就取消該請求，不會挑選任意選項。

### 這道界線的適用範圍

這道界線只約束 ACP 委派的檔案操作，不代表原生執行層的隔離。原生 YOLO 的 shell 執行維持不變；受限模式的通用 `cat`、`rg` 等命令仍沿用原本的工作區路徑授權，仍可讀取原生執行層能觸及的每次啟動狀態，本機制不阻止、也不宣稱阻止那些讀取。OpenCode 的既有結果完全不變。

### 證據範圍

上述行為由真實暫存檔案、受保護存取與可注入的原生邊界取代模型驗證；原生 OMP 執行檔的實際行為需要另外以固定版本的驗收環境執行。

---

## 工作區暫存目錄的回收與保留

每個工作區的 `{workspace}/tmp` 只存放可丟棄的暫存內容，但引擎的原生狀態同樣落在此目錄之下，因此回收政策必須逐項判斷，不能整棵刪除。

- **回收時機**：啟動階段在建立 `AgentCore` 之後、任何會產生工作階段的入口（平台介面卡、儀表板、排程器）之前，先等待一次回收完成；每個工作階段結束時，於最後一位臨時使用擁有者釋放後再進行一次。清理失敗既不會讓啟動失敗，也不會改變已完成工作階段的回應。
- **保留項目**：`tmp` 根目錄本身，以及保留名稱 `omp-agent`（每次啟動的 OMP 狀態，兩種模式皆同，內含指向共用原生執行階段的 `natives` 連結）與 `opencode-data`（OpenCode 工具輸出）。無論目前選用哪一個引擎或模式，這些項目都不會被列舉、不會跟隨連結，也不會因為閒置逾時而被視為可丟棄；同名項目即使型別不符也是原樣保留。
- **獨立的即時使用保護**：工作區的臨時使用參考計數與 Skill API 註冊表到期無關。生產者在可能建立工作區的第一個等待之前先取得參考，並在生產者拆卸完成評估後恰好釋放一次；共用行程模式的工作階段也會等到該次釋放之後才回報結果，因此註冊表到期永遠不會成為刪除檔案的依據。所有權尚未釋放時不會回收任何內容；無法確認生產者靜止時，該工作區在此行程生命週期內保留黏著保護，並記錄原因。
- **走訪邊界**：只走訪確實具有 `tmp` 子目錄的 `{platform}/{user}` 與 `{platform}/channels/{channel}` 形狀，每個工作區每次最多嘗試檢查 2048 個節點；達到節點上限時停止該工作區的走訪，剩餘內容留待下一次正常清理或重新啟動處理。深度上限 64 屬於資格限制：超過上限的內容刻意保留，但走訪會繼續處理其餘候選項目，因此過深的子樹不會讓同層的可丟棄項目永遠無法回收。符號連結、被置換或無法讀取的組件會略過並留下診斷，根目錄不存在則視為無事可做。集區與原生執行階段根目錄、備份、頻道記憶檔與共用代理工作區都不在走訪範圍內。
- **部署前提**：已設定的工作區儲存磁碟區預期只有單一擁有者。重用同一個磁碟區之前，必須先停止上一個機器人與代理行程樹；同一磁碟區上的並行獨立機器人，或外部行程對檔案系統的惡意變更，都不在支援範圍內。同一使用者留下的殘檔屬於該使用者自己的工作區內容，並非其他使用者的資料。

## 提示詞權限說明與實際引擎及模式對齊

捆綁的提示詞片段（`prompts/agent_permissions.md`、`prompts/browser_automation.md`、`prompts/omp_shell.md`）依目前工作階段所選的引擎與生效模式提供權限說明，不再把受限模式的 shell 限制描述成通則，也不再把 OpenCode 的拒絕規則套用到其他引擎。

- 受限模式：保留共用的命令允許清單、`;`／`&&`／`||` 的分段規則，以及管線、背景執行、檔案重導向與換行的拒絕；`2>&1`、`1>&2` 這類標準串流之間的 fd 重導向不寫入檔案，仍被容忍。
- OpenCode 專屬的權限閘門前命令拒絕（`echo`、`curl`、`git` 等）只在 OpenCode 的說明中列出；OMP 只陳述共用的命令與路徑規則。
- YOLO 與原生 YOLO：不再出現受限模式的 shell 拒絕敘述，也不宣稱所有操作或路徑皆可使用。OMP 仍保留 LSP 工具在所有模式皆拒絕的敘述，以及一次性命令、服務模式與背景完成通知的工具用法。
- 共享 Agent 工作區的寫入說明依 `canWriteAgentWorkspace` 與 `agent.sandbox.allowedWriteExtensions` 政策描述，受限模式不再一律稱為唯讀。

強制執行本身沒有改變：命令閘門、ACP 檔案系統授權、OMP 模式 YAML 與 OpenCode 權限對應都維持原樣，上述調整只涉及交付給代理人的文字。自主研究未產生筆記時的一次性修正提示，同樣依該工作階段實際選用的引擎與模式挑選措辭。

維運者若以 Volume 掛載自訂的 `prompts/agent_permissions.md`、`prompts/browser_automation.md` 或 `prompts/omp_shell.md`，覆寫檔全由維運者維護；要取得修正後的措辭，必須比照更新或重新掛載，本專案不會改寫掛載內容。

---

## 原生驗收指令 (Native Acceptance Commands)

在進行 OMP 原生執行階段驗收測試時，必須區分一般單元測試與嚴格原生驗收。在一般 CI 或本機測試環境中（未安裝 `omp`、`bwrap` 或 `strace`），所有涉及原生二進位檔的測試案例皆會明確標註為 `UNEXERCISED`，絕不以 Mock 偽造原生成功。若要在真實環境執行完整原生驗收，必須設定 `OMP_NATIVE_ACCEPTANCE=1`，此時缺少先決條件將會直接讓測試失敗。

```bash
# 1. 驗證 OMP 二進位檔版本
omp --version # 必須回傳指定的相容版本 (如 18.6.1)

# 2. 執行原生執行階段煙霧測試與沙盒掛載驗收
OMP_NATIVE_ACCEPTANCE=1 deno test \
  --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi \
  tests/acp/omp-native-runtime-smoke.test.ts \
  tests/acp/filesystem-confinement.test.ts \
  tests/core/omp-pool-modes.test.ts

# 3. 執行伴隨模型驅動的原生工具派發整合測試
OMP_NATIVE_ACCEPTANCE=1 deno test \
  --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi \
  tests/integration/omp-native-runtime/native-runtime.integration.test.ts
```
