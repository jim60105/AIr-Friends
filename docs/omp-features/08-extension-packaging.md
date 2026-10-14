# 8. 擴充模組與封裝

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 9」。

**白話說明（整體）**
OMP 的受限能力管制是靠一個「受信任擴充模組」在行程內執行；要讓它在正式 OMP 執行環境（Bun 原生執行期）被載入，就必須打包成原生可載入的單一檔案。本頁收錄「執行檔從哪來」與「擴充模組怎麼組出來」的相關功能。在 `cutover-omp-native-runtime` 之後，所有 OMP 產物改用**專案既有的一般安裝慣例**（`$UID:0` + `775`），部署位置只是**路徑**，不再是實體信任權威。

## 8.1 固定版本的 OMP 執行檔與封裝

> **處置：保留（釘選＋checksum＋版本健康）；移除摘要清單與自有治理樹政策。**

**白話說明**
為了避免上游偷偷改版導致行為改變，映像建置時會下載**指定版本**的官方 OMP 執行檔，並用每個架構各自的雜湊值驗證；驗證失敗就直接讓建置失敗，絕不安裝來路不明的檔案。官方授權條款與第三方聲明也從同一版本下載並驗證後安裝。這些產物（執行檔、手寫原生設定、提示、擴充 bundle）都依專案既有的 `$UID:0` + `775` 安裝慣例落地——安裝位置是部署路徑，而不是所有權權威。啟動時還會檢查 OMP 版本並記錄一個可追蹤的標記（僅警告，不阻擋啟動）。專案**不再**維護 `PACKAGE-MANIFEST.sha256` 這類內部產物摘要清單，也不再建立 OMP 專屬的不可寫治理樹；下載檔案的 SHA-256 校驗則完整保留。

**主要實作**

| 位置 | 說明 |
|---|---|
| `Containerfile:97-161` | `omp-unpacker` 階段：固定版本 + 每架構雜湊驗證 + 官方聲明 |
| `Containerfile:225-231` | 執行檔與官方聲明安裝（`$UID:0` + `775`） |
| `Containerfile:236-240` | 手寫原生模型設定安裝於 `/home/deno/.omp/agent/models.yml` |
| `Containerfile:258-327` | `/opt/air/omp` 部署路徑：模式設定、提示、擴充 bundle（一般安裝慣例） |
| `src/utils/omp-version.ts` | `verifyOmpVersion()` / `shouldVerifyOmpVersion()` 啟動版本檢查 |
| `src/bootstrap.ts` | 啟動流程呼叫版本檢查 |
| `src/utils/omp-paths.ts:51-73` | 映像路徑常數（`/opt/air/omp/...`） |

**測試位置**
- `tests/utils/omp-packaging.test.ts`
- `tests/utils/omp-version.test.ts`

**規格需求**
- `openspec/specs/agent-version-compatibility/spec.md` — `Bootstrap OMP Version Compatibility Check`
- `openspec/specs/agent-version-compatibility/spec.md` — `OMP Version Minimum Environment Override`
- `openspec/specs/agent-version-compatibility/spec.md` — `OMP Version Health Acceptance Is Mock-Only`
- `openspec/specs/container-packaging/spec.md` — `Pinned Official OMP Executable With Fail-Closed Checksum Verification`
- `openspec/specs/container-packaging/spec.md` — `Official License and Third-Party Notices Installed and Verified`
- `openspec/specs/container-packaging/spec.md` — `OMP Artifact Installation Uses Existing Project Conventions`

**對應封存變更**：`openspec/changes/archive/2026-10-10-package-pinned-omp-runtime`、`openspec/changes/archive/2026-10-15-simplify-omp-container-installation`
**相關文件**：`docs/OMP_PACKAGING.md`

## 8.2 可被原生載入的擴充套件綑綁

> **處置：保留（單一 ESM）；移除信任證據與部署宣告。**

**白話說明**
OMP 用 Bun 載入擴充模組，而原本的打包方式會產生 Deno 專用的 import map 與 `@std/*` 裸匯入，因此無法在原生環境運作。這項功能在**建置期**把來源與鎖定的相依打包成**可重現、原生可載入**的單一 ESM 檔案，映像安裝與開發環境使用**同一個**產出檔。此產物屬於程式碼建置，與「禁止產生 OMP 設定檔」分開處理——建置只做原始碼與凍結相依的決定性轉換，不合成、不改寫任何 OMP YAML。專案**不再**產生屬於自己的部署宣告（`bundle-declaration.ts` 已刪除），也不再把檔案擁有權或替換證據當作整合授權前提。

**主要實作**

| 位置 | 說明 |
|---|---|
| `scripts/omp/bundle-extension.ts` | 綑綁主邏輯（canonical 來源 + 凍結鎖定） |
| `scripts/omp/bundle-omp-extension.sh` | 建置階段呼叫腳本（`deno task bundle:omp-extension`） |
| `scripts/omp/bundle-audit.ts` | 依賴閉包稽核 |
| `src/utils/omp-paths.ts:24-61` | 開發端／映像端產出檔路徑（`build/omp-extension/index.js`、`/opt/air/omp/extension/index.js`） |

**測試位置**
- `tests/acp/omp-owned-module-bundle-smoke.test.ts`
- `tests/mocks/omp-bundle-smoke-driver.ts`
- `tests/utils/omp-packaging.test.ts`

**規格需求**
- `openspec/specs/container-packaging/spec.md` — `Native OMP Single ESM Code Artifact`
- `openspec/specs/container-packaging/spec.md` — `Development-Path to Image-Path Resolution Contract`
- `openspec/specs/container-packaging/spec.md` — `OMP Artifact Installation Uses Existing Project Conventions`
- `openspec/specs/configuration-and-deployment/spec.md` — `Current Native OMP Artifact And Configuration Documentation`

**對應封存變更**：`openspec/changes/archive/2026-10-12-package-bun-compatible-omp-extension`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_PACKAGING.md`

## 8.3 受信任擴充模組（整體架構）

> **處置：保留（替換治理核心為原生能力差異）。**

**白話說明**
這是嵌在 OMP 行程內的薄適配層。模組樹現在只有兩個檔案：入口 `index.ts` 在載入時同步把能力 callback（`native-registration.ts`）掛到官方 `api.on("tool_call")`；callback 對每次呼叫查能力對照表（`tool-inventory.ts`）：對應到允許能力就繼續，否則在分派前以有界的 `rejected_unknown_tool` 擋下。這個模組本身不含任何路徑授權或破壞性判斷邏輯，破壞性請求的原生形狀正規化由 ACP 客戶端入口的 `destructive-ingress.ts` 承擔，全部委派給共用政策模組。專案**不再**保留治理核心、登記表觀察、替換工具註冊或準備狀態握手。

**主要實作**（模組樹）

| 檔案 | 職責 |
|---|---|
| `src/acp/omp/extension/index.ts` | 擴充入口：`export default registerOmpCapabilityCallback` |
| `src/acp/omp/extension/native-registration.ts` | 官方 `api.on("tool_call")` 註冊與分派前能力決策 |
| `src/acp/omp/tool-inventory.ts` | 受限能力對照表與預設拒絕 |
| `src/acp/omp/destructive-ingress.ts` | OMP 破壞性權限輸入正規化（由客戶端入口使用） |

**測試位置**
- `tests/acp/omp-native-registration.test.ts`
- `tests/integration/omp-lifecycle/lifecycle.integration.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Native OMP Capability Admission Before Tool Dispatch`
- `openspec/specs/acp-integration/spec.md` — `OMP Native Capability Policy Parity`

**相關封存變更**：`openspec/changes/archive/2026-10-12-wire-omp-native-extension-api`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_ENFORCEMENT.md`
