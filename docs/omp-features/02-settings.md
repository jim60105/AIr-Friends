# 2. 自有設定與探索隔離

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 2」與「對照 3」。

本頁收錄「OMP 的設定內容從哪來、如何確保不被使用者環境或工作區竄改」的相關功能。核心概念：**OMP 的設定由部署方（本專案映像）獨家提供（owned），完全不理會使用者家目錄、專案目錄或環境變數中可能存在的設定檔。**

## 2.1 上游相容性契約與稽核

**白話說明**
在開始依賴 OMP 之前，必須先確認「上游的實際行為」與「我們假設的行為」一致。這項功能針對 7 個關鍵安全邊界（例如：模組載入前的排除、授權記錄重置、破壞性操作目標完整性、URL 傳輸控制等），逐條比對已固定的 OMP 版本原始碼，並把結果寫成機器可讀的稽核帳本。任何「上游做不到」的邊界都會被誠實標記為不支援（`incompatible`）或未解（`unresolved`），下游功能再據此設計，而不是憑空相信。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/compatibility-contracts.ts:19-24` | 固定的上游版本常數（OMP `v18.6.1`、commit、OpenCode、ACP SDK） |
| `src/acp/omp/compatibility-contracts.ts:28-45` | `BoundaryId` 與 `REQUIRED_BOUNDARIES`（七個必要邊界） |
| `src/acp/omp/compatibility-contracts.ts:89` | `AUDITED_PINNED_LEDGER` 稽核帳本 |
| `src/acp/omp/compatibility-contracts.ts:291` | `assessCompatibility()` 整體評估 |
| `src/acp/omp/compatibility-contracts.ts:495 / 587` | `validateDiscoveryContract()` / `validateReadinessContract()` |
| `src/acp/omp/inventory-validator.ts`、`lsp-validator.ts`、`transport-validator.ts`、`destructive-validator.ts` | 各邊界的契約驗證器 |

**測試位置**
- `tests/acp/omp-compatibility-contracts.test.ts`
- `tests/acp/omp-lsp-coldstart-evidence.test.ts`
- 固定樣本：`tests/fixtures/omp-compatibility/`（`approval-reset-counterexample.json`、`destructive-operations.json`、`readiness-fixtures.json`、`route-discovery-skills-lsp.json`）

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Pinned OMP Compatibility Evidence`
- `OMP Pre-Import Discovery Compatibility Contract`
- `OMP Policy Readiness Compatibility Contract`
- `OMP Authoritative Record Compatibility Contract`
- `OMP Complete Destructive Intent Compatibility Contract`
- `Restricted-Only LSP Compatibility Contract`
- `OMP Native Transport Compatibility Contract`
- `OMP Critical Skill Ownership Compatibility Contract`

**對應封存變更**：`openspec/changes/archive/2026-10-08-establish-omp-compatibility-contracts`
**相關文件**：`docs/OMP_COMPATIBILITY.md`

## 2.2 模式分離的自有設定內容

**白話說明**
OMP 需要一份設定檔才能啟動。這項功能替它準備兩套「由部署方提供」的設定：受限模式（restricted）與原生 YOLO 模式（native-yolo），兩者互不污染。設定內容是從既有的 OpenCode 設定逐項翻譯過來，包括供應商身分、自訂系統提示、更新姿態、自動對話壓縮等；其中也包含一堆與安全相關的鍵值，全部以「有原始碼依據」的方式固定，避免猜測。此外，這份功能誠實記錄一項「上游做不到」的設定（授權記錄重置），把它列為未解的應用閘門而非假裝可行。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp-settings.ts:822` | `RESTRICTED_YAML_CONTENT` 受限模式 overlay 內容 |
| `src/acp/omp-settings.ts:949` | `NATIVE_YOLO_YAML_CONTENT` 原生 YOLO overlay 內容 |
| `src/acp/omp-settings.ts:731` | `ompSettingsSourcePlan()` 部署方設定來源計畫 |
| `src/acp/omp-settings.ts:138` | `PINNED_REGISTERED_SETTINGS_KEYS` 已註冊且固定之鍵值清單 |
| `src/acp/omp-settings.ts:328-350` | `RESTRICTED_ONLY_KEYS` / `SHARED_DEPLOYMENT_KEYS` 分層鍵值 |
| `src/acp/omp-settings.ts:437` | `ompSettingsForMode()` 依模式產出設定 |
| `agent-config/omp/restricted.yml`、`agent-config/omp/native-yolo.yml`、`agent-config/omp/models.yml` | 映像內實際安裝的設定資產 |
| `prompts/system_prompt_override.md` | 對應到映像 `SYSTEM.md` 的自訂系統提示 |

**測試位置**
- `tests/acp/omp-settings.test.ts`
- 固定樣本：`tests/fixtures/omp-settings/fixtures.json`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Mode-Separated Owned OMP Settings Content`
- `Source-Backed Security Schema Key Validation`
- `Authoritative Record Reset Remains an Unresolved Application Gate`
- `OMP Provider and Application Identity Translation`
- `Compaction, Update Posture, and Prompt Mapping Decisions`
- `Restricted and YOLO Overlay Non-Contamination`

**對應封存變更**：`openspec/changes/archive/2026-10-08-translate-omp-owned-settings`
**相關文件**：`docs/OMP_SETTINGS.md`

## 2.3 自有設定探索來源隔離

**白話說明**
如果 OMP 在啟動時會去讀使用者的家目錄設定、專案目錄設定或環境變數指定的設定檔，那麼使用者就能偷偷放一份設定來放寬安全限制。這項功能把這些「外來設定來源」一律移除：子行程環境中的相關環境變數被強制清掉，並由部署方計畫與既有的中繼資料觀察器檢查是否還有任何被禁止的設定來源存在；一旦發現就明確拒絕、不做任何變更，而不是合併或刪除使用者檔案。自 `simplify-omp-session-boundaries` 起，daemon 端不再逐次請求執行此檢查（連線／`session/new`／`session/load` 的請求前閘門與其已接受身分基線已移除），此觀察器保留給啟動組裝與擴充端使用。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/sandbox-manager.ts:132-139` | `sanitizeOmpDiscoveryEnv()`：清掉所有設定探索用環境變數 |
| `src/acp/sandbox-manager.ts:180-182` | 對 OMP 子行程強制執行上述清理（無法被 `filterEnv` 關閉） |
| `src/acp/agent-factory.ts:142` | `finalizeOmpSpawnEnvironment()`：清理後只重新帶入部署方計畫值 |
| `src/acp/omp/settings-sources.ts:183` | `checkOmpSettingsSources()` |
| `src/acp/omp/settings-sources.ts:377` | `assertOmpSettingsSourcesVisible()`：觀察器保留（已無 daemon 端呼叫端） |
| `src/acp/omp/settings-sources.ts:93` | `SettingsSourceRejectionError` |
| `src/acp/omp-settings.ts:635` | `OMP_SETTINGS_DISCOVERY_ENV_SELECTORS` |
| `src/acp/omp-settings.ts:466` | `PINNED_FORBIDDEN_SETTINGS_SOURCES` |

**測試位置**
- `tests/acp/omp-settings-sources.test.ts`
- `tests/acp/agent-connector-env-isolation.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Owned-Only OMP Settings Discovery Sources`
- `OMP Environment and Egress Pass-Through Without New Rules`
- `Authoritative Record Reset Remains an Unresolved Application Gate`

**對應封存變更**：`openspec/changes/archive/2026-10-11-isolate-omp-settings-discovery`
**相關文件**：`docs/OMP_SETTINGS.md`、`docs/OMP_DISCOVERY.md`

## 2.4 兩種模式都停用 LSP

**白話說明**
語言伺服器（LSP）會啟動額外程序並接觸工作區檔案，屬於多餘的攻擊面。這項功能在受限模式與 YOLO 模式兩套設定中都固定把 LSP 關閉，讓兩種模式的設定保持一致，並且不引入任何受限模式專屬的工具政策到 YOLO 設定中。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp-settings.ts:339` | `SHARED_DEPLOYMENT_KEYS`（兩模式共用、含 `lsp.enabled: false`） |
| `src/acp/omp-settings.ts:822 / 949` | 兩份 overlay 內容中的 LSP 固定值 |
| `src/acp/omp/lsp-validator.ts:10` | `validateRestrictedLspContract()` |

**測試位置**
- `tests/acp/omp-settings.test.ts`
- `tests/acp/omp-lsp-coldstart-evidence.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Restricted and YOLO Overlay Non-Contamination`

**對應封存變更**：`openspec/changes/archive/2026-10-11-pin-omp-yolo-lsp-settings`
**相關文件**：`docs/OMP_SETTINGS.md`
