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
