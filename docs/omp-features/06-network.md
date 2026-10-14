# 6. 網路傳輸（URL 讀取／網頁搜尋）

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 7」。

> **本頁整頁處置：已移除。** `cutover-omp-native-runtime` 之後，OMP 的 URL 讀取與網頁搜尋**改回原生工具**：專案不再自建傳輸、路由、後端名單或替換工具，也不再維護替換工具的完成標記與放行閘門。以下保留各項的歷史說明與歷史依據，並記錄現行做法（原生）。

**現行做法（一句話）**
OMP 的原生讀取與搜尋工具在受限模式下由 `src/acp/omp/tool-inventory.ts` 的能力對照表對應到 `read`／`search`／`network` 能力而繼續；原生平台差異（重導向、搜尋後端、結果格式）保留為**上游所有**，專案不追求逐位元組一致，也不以自建傳輸取代原生能力。出口（egress）姿態仍是既有的共用代理／隔離設定，未因模式而新增規則。

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Native OMP Local Read And Search Behavior`
- `openspec/specs/acp-integration/spec.md` — `OMP Native Capability Policy Parity`

## 6.1 受控 URL 讀取傳輸

> **處置：已移除。**

**歷史說明（非現行行為）**
早期版本以受信任擴充模組**取代**原生讀取工具，把每一次對外請求拉進受控通道：逐跳手動重導向、重用 SSRF 分類規則、必要時改走專案自己的驗證代理，文字與二進位走不同路徑。相關模組（`src/acp/omp/fetch-transport.ts`、`fetch-routes.ts`、`extension/read-replacement.ts`）與其測試檔皆已刪除。現行做法是原生讀取；能力由 `tool-inventory.ts` 對應。

**歷史依據**：`openspec/changes/archive/2026-10-10-control-omp-url-fetch-transport`

## 6.2 受控網頁搜尋

> **處置：已移除。**

**歷史說明（非現行行為）**
早期版本把網頁搜尋拉進同一條受控通道，並把可用後端限定在 Gemini／OpenRouter 接地搜尋、憑證缺席即封鎖。相關模組（`src/acp/omp/search-transport.ts`、`search-routes.ts`、`extension/search-replacement.ts`）與其測試檔皆已刪除。現行做法是原生搜尋；能力由 `tool-inventory.ts`（`web_search`）對應。

**歷史依據**：`openspec/changes/archive/2026-10-10-adapt-omp-web-search`

## 6.3 網路替換工具的放行閘門

> **處置：已移除。**

**歷史說明（非現行行為）**
早期版本要求工具清單在「轉接器確實完成且有支援後端」時才放行替換路由，其餘情況維持封鎖並回報有界錯誤。此完成標記與等待閘門隨替換工具一併刪除，不留任何完成標記。

**歷史依據**：`openspec/changes/archive/2026-10-12-admit-completed-omp-network-adapters`

## 6.4 替換工具的原生介面契約

> **處置：已移除。**

**歷史說明（非現行行為）**
早期版本把兩個替換工具（讀取、搜尋）對齊成原生契約（原生相容的參數 schema、原生 `content` 陣列）。隨替換工具刪除，專案不再維護原生 schema 與結果格式的鏡像。

**歷史依據**：`openspec/changes/archive/2026-10-12-align-omp-native-tool-contracts`

## 6.5 公開程式碼搜尋

> **處置：不重建（維持已移除）。**

**歷史說明**
原本規劃保留「公開程式碼搜尋」能力以對齊 OpenCode，但稽核發現 OpenCode 已移除該工具、OMP 側也沒有正式可用的後端與憑證，因此整個能力被誠實移除。專案**不重建**這項已移除的專用能力，也**不**新增針對原生服務的禁用斷言。

**歷史依據**
- `openspec/changes/archive/2026-10-10-adapt-omp-public-code-search`（原始適配提案，後被取代）
- `openspec/changes/archive/2026-10-12-remove-omp-public-code-search`（實際移除）

**相關文件**：`docs/OMP_NETWORK.md`（現記錄此能力已移除的歷史）
