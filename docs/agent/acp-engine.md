# ACP 引擎整合

AIr-Friends 是一套 **ACP (Agent Client Protocol)** 客戶端系統，負責維護平台連線、記憶與權限，將核心推理交由外部 ACP 代理人引擎。系統目前支援兩種主流的代理人後端：**OpenCode CLI** 與 **Oh-My-Pi (OMP)**。

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

為了確保 ACP 引擎正常運作，依據部署型態的不同，必須備妥對應的先決條件：

| 先決條件項目 | 容器化部署 (Docker/Podman) | 本機開發或自訂主機部署 |
| :--- | :--- | :--- |
| **代理人執行檔** | 官方發布映像檔已預先包裝對應二進位檔 | 須於主機 `$PATH` 安裝 `opencode` 或 `omp` 執行檔 |
| **OMP 原生模式 YAML** | 映像檔預先內建於 `/opt/air/omp/` | 須手動提供 `agent-config/omp/restricted.yml` 與 `native-yolo.yml` |
| **OMP 模型清單 (`models.yml`)** | 預先安裝至 `/home/deno/.omp/agent/models.yml` | 須手動建立於 `$HOME/.omp/agent/models.yml` 或透過組態指定 |
| **技能目錄 (`skills.customDirectories`)**| 指向單一共用根目錄 `/home/deno/.agents/skills/` | 指向專案的 `skills/` 目錄，雙代理人共用單一根目錄 |
| **OMP 擴充套件 Bundle** | 映像檔建置時自動產生於 `/opt/air/omp/extension/index.js` | 開發環境使用產生的 `build/omp-extension/index.js` |

---

## OMP 版本檢驗機制 (`verifyOmpVersion`)

在系統啟動流程（`src/bootstrap.ts`）中，若當前解析的代理人引擎為 `omp`，系統會呼叫 `src/utils/omp-version.ts` 中的 `verifyOmpVersion()` 函式：

- **執行方式**：在 5 秒超時內執行 `omp --version`，無網路請求，不啟動完整 ACP 工作階段。
- **紀錄識別標記**：於日誌輸出結構化標記：
  - `OMP version check: OK`：版本符合已知相容標準（最低基準版本為 `18.6.1`）。
  - `OMP version check: BELOW_MINIMUM`：版本低於標準，發出警告日誌。
  - `OMP version check: UNKNOWN`：無法正確解析版本字串，發出警告日誌。
- **非阻塞原則**：版本檢查僅作為維運輔助警示（Warn-only），即使低於基準版本，系統亦絕不強制中斷或阻擋啟動。
- **版本覆寫變數**：可透過環境變數 `AGENT_OMP_MIN_VERSION` 覆寫期望的最低版本設定。

---

## 原生驗收指令 (Native Acceptance Commands)

在進行 OMP 原生執行階段驗收測試時，必須區分**一般單元測試**與**嚴格原生驗收**：

- 在一般 CI 或本機測試環境中（未安裝 `omp`、`bwrap` 或 `strace`），所有涉及原生二進位檔的測試案例皆會明確標註為 `UNEXERCISED`，絕不以 Mock 偽造原生成功。
- 若要在真實環境執行完整原生驗收，必須設定 `OMP_NATIVE_ACCEPTANCE=1`，此時缺少先決條件將會直接讓測試失敗：

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
