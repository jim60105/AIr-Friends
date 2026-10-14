# 8. 擴充模組與封裝

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 9」。

**白話說明（整體）**
OMP 的安全管制不是靠設定檔就能完成，而是靠一個「受信任擴充模組」在行程內執行。而要讓這個模組在正式的 OMP 執行環境（Bun 原生執行期）能被載入，就必須打包成原生可載入的單一檔案。本頁收錄「執行檔從哪來」與「擴充模組怎麼組出來」的相關功能。

## 8.1 固定版本的 OMP 執行檔與封裝

**白話說明**
為了避免上游偷偷改版導致行為改變，映像建置時會下載**指定版本**的官方 OMP 執行檔，並用每個架構各自的雜湊值驗證；驗證失敗就直接讓建置失敗，絕不安裝來路不明的檔案。官方授權條款與第三方聲明也從同一版本下載並驗證後安裝。所有屬於本專案、用來治理 OMP 的檔案（設定、提示、擴充模組）都安裝在 **root 擁有、代理無法寫入** 的 `/opt/air/omp` 樹下——代理不能改動治理自己的規則。啟動時還會檢查 OMP 版本並記錄一個可追蹤的標記（僅警告，不阻擋啟動）。

**主要實作**

| 位置 | 說明 |
|---|---|
| `Containerfile:97-165` | `omp-unpacker` 階段：固定版本 + 每架構雜湊驗證 |
| `Containerfile:222-236` | 執行檔（root 擁有 0755，與其他 $UID:0 二進位刻意不同）與授權聲明安裝 |
| `Containerfile:257-304` | `/opt/air/omp` 自有樹：設定、提示、擴充 bundles 與 `PACKAGE-MANIFEST.sha256` |
| `src/utils/omp-version.ts:169` | `verifyOmpVersion()` 啟動版本檢查 |
| `src/utils/omp-version.ts:158` | `shouldVerifyOmpVersion()`（僅 OMP 時執行） |
| `src/bootstrap.ts:115-117` | 啟動流程呼叫版本檢查 |
| `src/utils/omp-paths.ts:57-134` | 映像路徑與開發／映像路徑解析對照 |
| `scripts/omp/generate-omp-manifest.sh` | 產出摘要清單 |

**測試位置**
- `tests/utils/omp-packaging.test.ts`
- `tests/utils/omp-version.test.ts`

**規格需求**
- `openspec/specs/agent-version-compatibility/spec.md` — `Bootstrap OMP Version Compatibility Check`
- `openspec/specs/agent-version-compatibility/spec.md` — `OMP Version Minimum Environment Override`
- `openspec/specs/agent-version-compatibility/spec.md` — `OMP Version Health Acceptance Is Mock-Only`
- `openspec/specs/container-packaging/spec.md` — `Pinned Official OMP Executable With Fail-Closed Checksum Verification`
- `openspec/specs/container-packaging/spec.md` — `Official License and Third-Party Notices Installed and Verified`
- `openspec/specs/container-packaging/spec.md` — `Deployment-Owned OMP Artifacts Installed Outside Agent-Writable Roots`
- `openspec/specs/container-packaging/spec.md` — `Auditable Digest Manifest With Recut Invariant`
- `openspec/specs/container-packaging/spec.md` — `Development-Path to Image-Path Resolution Contract`

**對應封存變更**：`openspec/changes/archive/2026-10-10-package-pinned-omp-runtime`
**相關文件**：`docs/OMP_PACKAGING.md`

## 8.2 可被原生載入的擴充套件綑綁

**白話說明**
OMP 用 Bun 載入擴充模組，而原本的打包方式會產生 Deno 專用的 import map 與 `@std/*` 裸匯入，還依賴只有 Deno 才有的 DNS API，因此無法在原生環境運作。這項功能在**建置期**把來源與鎖定的相依打包成**可重現、原生可載入**的單一 ESM 檔案，並把只依賴 Deno 的 DNS 解析改成原生相容的 Node DNS 介面（仍保留可注入的測試替身與同一套 SSRF 分類器）。映像安裝與開發環境使用**同一個**產出檔。

**主要實作**

| 位置 | 說明 |
|---|---|
| `scripts/omp/bundle-extension.ts` | 綑綁主邏輯（canonical 來源 + 凍結鎖定） |
| `scripts/omp/bundle-omp-extension.sh` | 建置階段呼叫腳本 |
| `scripts/omp/bundle-audit.ts` | 依賴閉包稽核（只允許 `@std/*` 外部相依） |
| `scripts/omp/bundle-declaration.ts` | 產出屬於自己的部署宣告 |
| `src/utils/omp-paths.ts:26-47` | 開發端產出檔路徑（`build/omp-extension/index.js`） |
| `src/utils/omp-paths.ts:81-89` | 映像端產出檔路徑（`/opt/air/omp/extension/index.js`） |
| `src/acp/omp/extension/read-replacement.ts:863` | `runtimeResolveHost()` 原生相容 DNS 解析 |

**測試位置**
- `tests/acp/omp-owned-module-bundle-smoke.test.ts`
- `tests/mocks/omp-bundle-smoke-driver.ts`
- `tests/utils/omp-packaging.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Controlled Transport DNS Runs in the Native Runtime`
- `openspec/specs/container-packaging/spec.md` — `Owned Extension Has a Locked Native-Loadable Closure`
- `openspec/specs/container-packaging/spec.md` — `Deployment-Owned OMP Artifacts Installed Outside Agent-Writable Roots`
- `openspec/specs/container-packaging/spec.md` — `Development-Path to Image-Path Resolution Contract`
- `openspec/specs/container-packaging/spec.md` — `Generated OMP Bundle Carries Its Owned Deployment Declaration`

**對應封存變更**：`openspec/changes/archive/2026-10-12-package-bun-compatible-omp-extension`
**相關文件**：`docs/OMP_PACKAGING.md`

## 8.3 受信任擴充模組（整體架構）

**白話說明**
這是嵌在 OMP 行程內的「管制核心」。它在載入時先做探索排除決策，接著把工具呼叫處理器與替換工具（讀取、搜尋）註冊進原生 API；之後每一次受限呼叫都會：讀取最新來源與世代、合成決策、必要時擋下並回報有界錯誤。這個模組本身不含任何路徑授權或破壞性判斷邏輯，全部委派給共用模組與政策模組。

**主要實作**（模組樹）

| 檔案 | 職責 |
|---|---|
| `src/acp/omp/extension/index.ts:36` | `loadTimeDiscoveryDecision()` 載入入口 |
| `src/acp/omp/extension/bootstrap.ts:59` | `bootstrapDiscoveryGuard()` 身分觀察與決策計算 |
| `src/acp/omp/extension/enforcement.ts` | 每次呼叫的決策合成與註冊 |
| `src/acp/omp/extension/native-registration.ts` | 原生擴充 API 註冊與登記表觀察 |
| `src/acp/omp/extension/native-events.ts` | 原生事件解碼為政策輸入 |
| `src/acp/omp/extension/read-replacement.ts` | 讀取替換工具（含自有技能 URI） |
| `src/acp/omp/extension/search-replacement.ts` | 網頁搜尋替換工具 |
| `src/acp/omp/extension/critical-skills.ts` | 關鍵技能根目錄宣告觀察 |
| `src/acp/omp/extension/enforcement-error.ts` | 有界錯誤詞彙 |
| `src/acp/omp/extension/ownership.ts`、`surfaces.ts` | 所有權／表面輔助 |

**測試位置**
- `tests/acp/omp-native-registration.test.ts`
- `tests/acp/omp-tool-enforcement-wiring.test.ts`
- `tests/integration/omp-lifecycle/lifecycle.integration.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Trusted-Extension Tool-Call Enforcement Wiring`
- `openspec/specs/acp-integration/spec.md` — `Restricted Enforcement Registers Through the Native Extension Contract`
- `openspec/specs/acp-integration/spec.md` — `Exact Owned-Module Trust Scope`

**相關封存變更**：`2026-10-08-establish-omp-compatibility-contracts`、`2026-10-09-guard-omp-executable-discovery`、`2026-10-12-wire-omp-native-extension-api`
**相關文件**：`docs/OMP_ENFORCEMENT.md`、`docs/OMP_DISCOVERY.md`
