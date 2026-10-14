# 2. 自有設定與探索隔離

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 2」與「對照 3」。

本頁收錄「OMP 的設定內容從哪來」的相關功能。核心概念在 `cutover-omp-native-runtime` 之後已改為：**OMP 直接讀取由部署方手寫的原生 YAML（依模式各一份），由 OMP 原生解析器負責載入與報錯**；應用程式不再產生、序列化、改寫或套用模板到 OMP 設定，也不再對原生設定做重複驗證。共用沙箱的環境過濾仍會清除外來設定選擇器。

## 2.1 上游相容性契約與稽核

> **處置：已移除。** 這項機制的程式、測試與 fixtures（`src/acp/omp/compatibility-contracts.ts` 及契約驗證器、`tests/acp/omp-compatibility-contracts.test.ts`、`tests/fixtures/omp-compatibility/`）皆已在 `cutover-omp-native-runtime` 刪除，對應的規格需求亦已移除。

**歷史說明（非現行行為）**
早期版本針對 7 個安全邊界逐條比對固定的 OMP 版本原始碼，並把結果寫成機器可讀的稽核帳本，作為下游功能的設計依據。此治理帳本與固定姿態斷言如今已不存在；剩餘的原生行為差異以文件與 `openspec/changes/archive/2026-10-08-establish-omp-compatibility-contracts` 的歷史紀錄保存，不再作為執行期或啟動期的判斷來源。

**歷史依據**
- `openspec/changes/archive/2026-10-08-establish-omp-compatibility-contracts`
- `docs/superpowers/specs/2026-10-14-omp-opencode-parity-simplification-design.md` §2

## 2.2 模式分離的自有設定內容

> **處置：保留（簡化為手寫原生 YAML）。**

**白話說明**
OMP 需要一份原生設定檔才能啟動。受限模式（restricted）與原生 YOLO 模式（native-yolo）各自有一份**由部署方手寫**的原生 YAML，兩者互不污染。受限模式的批准政策有**兩層不同機制**，必須分清楚：

1. **原生精確名稱批准**：`tools.approvalMode: write` 搭配逐工具的精確名稱項 `tools.approval.<name>`（原生 YAML schema 沒有萬用字元預設拒絕鍵）。
2. **擴充的能力對照表成員判定**：受限能力擴充在分派前只檢查名稱是否在能力對照表內——名稱在表內者（例如 `bash`、`read`、`write`、`edit`）**即使未出現在原生 YAML 的允許項中仍會繼續**至原生分派（原生批准與共用 ACP 政策仍各自決定），**只有**名稱不在對照表內者才會在分派前被擋下。

此外，原生 OMP 直接讀取部署 HOME 下的模型設定檔（`~/.omp/agent/models.yml`）——那是**原生模型設定檔，不是 overlay**：沒有 `--config` 疊加、沒有程式產生的內容字串、沒有 schema 鏡像或設定疊加模擬。原生設定載入錯誤由 OMP 自己的解析與啟動錯誤回報，應用程式不新增比原生格式更窄的合法值集合。

**主要實作**

| 位置 | 說明 |
|---|---|
| `agent-config/omp/restricted.yml` | 受限模式手寫原生設定（`tools.approvalMode: write` + 逐工具 `tools.approval.*`，含 `lsp: deny`） |
| `agent-config/omp/native-yolo.yml` | 原生 YOLO 模式手寫原生設定（`tools.approvalMode: yolo` + 單一 `lsp: deny`） |
| `agent-config/omp/models.yml` | 手寫原生模型設定，安裝為 `~/.omp/agent/models.yml` 由原生讀取 |
| `prompts/system_prompt_override.md` | 對應到映像 `SYSTEM.md` 的自訂系統提示 |
| `src/acp/agent-factory.ts:239-388` | OMP 啟動分支：以 `resolveOmpConfigPath()` 選取模式文件，交由原生解析 |
| `src/utils/omp-paths.ts:80-137` | `resolveOmpConfigPath()` / `resolveOmpSystemPromptPath()`：dev→image 路徑解析 |

**測試位置**
- `tests/acp/agent-factory-omp.test.ts`
- `tests/acp/omp-native-runtime-smoke.test.ts`（以手寫模型 fixture 驅動原生初始化／目錄／載入）

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Handwritten Native OMP Configuration Consumption`
- `Authored Native OMP Provider Configuration And Identity`
- `Authored Native OMP Compaction Update And Prompt Behavior`

**對應封存變更**：`openspec/changes/archive/2026-10-08-translate-omp-owned-settings`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_SETTINGS.md`

## 2.3 自有設定探索來源隔離

> **處置：保留（簡化：移除身分／預檢閘門）。**

**白話說明**
共用沙箱在啟用環境過濾時，會以固定的基準允許清單、各代理類型的憑證集合與維運者可允許變數，組出子行程環境，並拒絕平台／儀表板／原始 Skill API 機密；外來的設定選擇器（例如 XDG 選擇器、`OMP_PROFILE`、`PI_CODING_AGENT_DIR`、`PI_CONFIG_FILES`）一律不傳遞給任何代理。自 `cutover-omp-native-runtime` 起，OMP **不再**另有一套設定探索清理或選擇器身分閘門：`settings-sources.ts` 與其 daemon 端／擴充端呼叫端已刪除，OMP 與 OpenCode 共用同一套環境過濾。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/sandbox-manager.ts:66-79` | `AGENT_TYPE_ENV`：各代理類型的憑證允許集合 |
| `src/acp/sandbox-manager.ts:85-115` | `NEVER_PASS_ENV`：永不傳遞的機密與選擇器 |
| `src/acp/sandbox-manager.ts:135-158` | `buildSpawnOptions()`／`buildFilteredEnv()`：環境過濾入口 |
| `src/acp/agent-factory.ts:316-351` | OMP 啟動環境最終化與唯讀掛載 |

**測試位置**
- `tests/acp/sandbox-manager.test.ts`
- `tests/acp/agent-connector-env-isolation.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Shared Agent Environment Filtering With Native OMP Discovery`

**對應封存變更**：`openspec/changes/archive/2026-10-11-isolate-omp-settings-discovery`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_SETTINGS.md`

## 2.4 兩種模式都停用 LSP

> **處置：保留（簡化為原生工具拒絕）。**

**白話說明**
語言伺服器（LSP）工具會啟動額外程序並接觸工作區檔案。兩種 OMP 模式都透過**原生精確名稱的工具拒絕**停用它：受限模式在 `agent-config/omp/restricted.yml` 以 `tools.approval.lsp: deny` 表達，原生 YOLO 模式在 `agent-config/omp/native-yolo.yml` 以同樣的 `lsp: deny` 表達。專案**不**引入 `--no-lsp` 或全域 `lsp.enabled: false` 這類全行程開關，也**不**對「語言伺服器絕不啟動」做任何斷言——只證明該工具被拒絕。

**主要實作**

| 位置 | 說明 |
|---|---|
| `agent-config/omp/restricted.yml:18` | 受限模式 `tools.approval.lsp: deny` |
| `agent-config/omp/native-yolo.yml:10` | 原生 YOLO 模式 `tools.approval.lsp: deny` |

**測試位置**
- `tests/acp/agent-factory-omp.test.ts`
- `tests/integration/omp-native-runtime/native-runtime.integration.test.ts`（實際驅動原生工具操作）
- `tests/acp/omp-native-runtime-smoke.test.ts`（僅 init／catalog／load／mount 證據）

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `OMP Native Capability Policy Parity`
- `openspec/specs/acp-integration/spec.md` — `Permissive Native OMP ACP Launch With Explicit LSP Denial`
- `openspec/specs/acp-integration/spec.md` — `OpenCode Both Agents Explicitly Deny The LSP Tool`

**對應封存變更**：`openspec/changes/archive/2026-10-11-pin-omp-yolo-lsp-settings`、`openspec/changes/archive/2026-10-15-cutover-omp-native-runtime`
**相關文件**：`docs/OMP_SETTINGS.md`、`docs/AGENT_PERMISSIONS.md`
