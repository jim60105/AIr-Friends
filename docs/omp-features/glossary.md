# 詞彙與名詞對照

本頁解釋文件中反覆出現的技術名詞，採「先白話、後精確」的順序。本頁只列**現行行為**會用到的名詞；已隨 `cutover-omp-native-runtime` 移除的治理機制詞彙，統一列於最後的「歷史詞彙」區塊，並標明其已非現行行為。

## 角色與系統

| 名詞 | 說明 |
|---|---|
| **ACP（Agent Client Protocol）** | 一套標準協定，用來讓「客戶端程式」與「代理程式」以 JSON-RPC 溝通。本專案是客戶端。 |
| **Agent（代理）** | 真正執行 AI 推理的外部程式。本專案支援兩種：OpenCode 與 OMP。 |
| **OMP（oh-my-pi）** | 一種 ACP 相容的 CLI 代理，本專案新增支援的第二種代理類型。 |
| **OpenCode** | 本專案原本支援、也是預設的代理類型。 |
| **技能（skill）** | 代理可執行的小型工具腳本（例如 `send-reply`、`memory-save`），放在受信任的技能根目錄下。 |
| **行程池（pool）** | 為了效能，讓同一對話重複使用同一支代理行程的機制。 |
| **裸適配層／薄適配層（thin adapter）** | 只處理原生介面差異的最小程式碼；OMP 側的能力對照表與原生 callback 屬於此。 |

## 權限與安全

| 名詞 | 說明 |
|---|---|
| **受限模式（restricted）** | 預設的安全模式。工具授權受能力對照表與共用白名單管制，檔案存取則由**共用路徑邊界**管制——但該邊界管的是**經 ACP 委派的**檔案 IO；原生本機讀取／搜尋走原生作業系統環境（ambient OS boundary），**不**由 ACP 客戶端政策界定（已接受的殘留）。 |
| **YOLO 模式** | 自動批准所有權限請求的模式，僅限受信任／隔離環境使用。OMP 稱之為 `native-yolo`。 |
| **能力對照表（capability map）** | OMP 受限模式的最小不可變對照表（`src/acp/omp/tool-inventory.ts`）：把原生工具名稱一對一映射到它代表的 OpenCode 能力（read／search／todo／network／execute／modify／destructive）。未對應的名稱在原生分派前被擋下。 |
| **原生工具拒絕（native tool deny）** | 以原生 `tools.approval.<name>` 精確名稱表達的工具拒絕（例如 `lsp`），不引入全行程開關。 |
| **失敗關閉（fail-closed）** | 無法確認安全時，選擇「拒絕」而不是「放行」。本專案安全設計的核心原則。 |
| **SSRF** | 伺服器端請求偽造。攻擊者誘導伺服器去存取內網／本機位址。共用的出口驗證代理就是用來防它。 |
| **MCP** | Model Context Protocol，外部工具伺服器，可由維運者提供。 |
| **破壞性操作** | 刪除、搬移、批次修補等會改動或移除檔案的動作。 |
| **資源世代（resource generation）** | 某個 session 資源狀態（情境／根目錄／目標觀察）的版本編號，用來判斷觀察是否新鮮。僅用於共用檔案系統存取。 |

## 技能與路徑

| 名詞 | 說明 |
|---|---|
| **技能根目錄（skills root）** | 存放受信任技能腳本的單一絕對路徑，由部署方以 `agent.skillsDir` 設定；OMP 的原生探索路徑則由部署者另行手寫於 `skills.customDirectories`。 |
| **暫存目錄（staging）** | 每次 session 專屬的暫存區，代理在此寫入要傳送的內容（例如回覆文字），再以檔案路徑傳給技能。 |
| **技能交接（skill handoff）** | 從提示渲染、技能 API、處理器到平台投遞的完整鏈路。 |

## 封裝與傳輸

| 名詞 | 說明 |
|---|---|
| **bundle（綑綁檔）** | 把擴充模組來源與相依打包成的單一原生可載入 ESM 檔案。 |
| **出口代理（egress proxy）** | 本專案自己實作的驗證代理，讓代理的對外流量經過檢查。 |
| **跳點（hop）** | 一次 HTTP 重導向後的下一站。每個跳點都要重新驗證。 |
| **dev→image 路徑解析（seam）** | 把開發樹路徑（例如 `agent-config/omp/restricted.yml`）對應到映像安裝路徑的解析契約（`src/utils/omp-paths.ts`）。 |

## 流程

| 名詞 | 說明 |
|---|---|
| **封存變更（archived change）** | OpenSpec 流程中，已實作並歸檔的變更提案，位於 `openspec/changes/archive/`。 |
| **規格需求（requirement）** | 合併進 `openspec/specs/<能力>/spec.md` 的 `### Requirement:` 條目。 |
| **能力（capability）** | 規格的分類單位，例如 `acp-integration`、`container-packaging`。 |

## 歷史詞彙（已移除，非現行行為）

下列名詞描述在 `cutover-omp-native-runtime` 被刪除的治理機制；保留於此僅為協助閱讀歷史設計材料（`docs/superpowers/specs/2026-10-14-omp-opencode-parity-simplification-design.md` 與 `openspec/changes/archive/`）。

| 名詞 | 歷史說明 |
|---|---|
| **自有（owned）** | 早期指「由部署方提供、代理無法修改」的資源（如 `/opt/air/omp` 下的設定與擴充）。現行改採專案一般安裝慣例（`$UID:0` + `775`）：安裝位置是路徑，不是所有權權威。 |
| **overlay（疊加設定）** | 早期以 `--config` 指定的設定層，會疊在原生設定之上。現行改為單一手寫模式文件，無疊加組合。 |
| **來源（provenance）** | 早期用來判定工具「實際從哪裡來」的機制（原生內建、自有擴充、維運者 MCP、不受信任）。已刪除，改按能力對照表。 |
| **登記表世代（registry epoch）** | 早期工具登記表的版本編號，用來判斷快照是否過期。已刪除。 |
| **關鍵技能（critical skills）** | 早期要求必須來自受信任根目錄、不能由工作區檔案假冒的技能。已刪除。 |
| **摘要清單（digest manifest）** | 早期記錄 `--from=omp-unpacker` 所安裝檔案雜湊值的 `PACKAGE-MANIFEST.sha256`。已刪除；下載檔的 SHA-256 校驗保留。 |
| **實體部署證據（physical deployment evidence）** | 早期以原生檔案中繼資料複驗已部署模組身分的機制。已刪除。 |
