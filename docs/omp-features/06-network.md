# 6. 網路傳輸（URL 讀取／網頁搜尋）

> OpenCode 側的做法與差異：[第 12 頁](12-opencode-comparison.md)的「對照 7」。

**白話說明（整體）**
OMP 原生上網時會直接用「全域 fetch」並自動跟隨重導向，這使得它可能被誘導去存取內網或本機位址（SSRF）。這一系列功能用「受信任擴充模組」**取代**原生讀取工具與網頁搜尋工具，把每一次對外請求都拉進一條受控通道：每個 URL、每個重導向跳點都要重新通過既有的 SSRF 分類規則，必要時改走專案自己的驗證代理。核心規則只有一套，不允許另開一份。

## 6.1 受控 URL 讀取傳輸

**白話說明**
當代理要讀取某個網址的內容時，不再自己直接抓，而是交給受控通道判斷：這個目標允許「直接連線」、「走代理」還是「封鎖」。重導向一律手動處理、逐跳重新驗證，鏈長上限沿用既有的五跳。文字與二進位（檔案下載）走不同路徑，二進位路徑會先檢查大小上限並邊流邊限量。決策記錄中不含任何憑證資料。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/fetch-transport.ts:86` | `deriveFetchEgressPolicy()` 讀取出口政策 |
| `src/acp/omp/fetch-transport.ts:312` | `decideFetchHop()` 單一跳點決策（重用 `src/utils/ssrf.ts` 規則） |
| `src/acp/omp/fetch-transport.ts:414` | `planFetchRoute()` |
| `src/acp/omp/fetch-transport.ts:520` | `runFetchChain()` 手動逐跳鏈 |
| `src/acp/omp/fetch-transport.ts:685` | `fetchTextRoute()` 文字路徑 |
| `src/acp/omp/fetch-transport.ts`（binary 段） | 二進位路徑與大小上限 |
| `src/acp/omp/fetch-routes.ts:159` | `FETCH_ROUTE_TABLE` 可攔截／已封鎖路由表 |
| `src/acp/omp/fetch-routes.ts:304` | `admitReadUrlReplacement()` 放行判斷 |
| `src/acp/omp/extension/read-replacement.ts:651` | `createReadReplacementToolDefinition()` 讀取替換工具 |
| `src/acp/omp/extension/read-replacement.ts:886` | `registerReadReplacement()` |

**測試位置**
- `tests/acp/omp-fetch-transport-decisions.test.ts`
- `tests/acp/omp-fetch-transport-shapes.test.ts`
- `tests/acp/omp-skill-uri-authorization.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Controlled URL-Fetch Transport Adapter Decision Core`
- `Manual Per-Hop Redirect and Secondary-URL Re-Validation`
- `Egress-Policy-Selected Proxy Routing with Operator Posture Preserved`
- `Text and Binary Fetch Paths with Credential-Free Decision Records`
- `Source-Cited Supported-Route Enumeration with Honest Blocked Residuals`
- `Trusted Loopback and Provider Routing Remain Distinct from Model Fetch Targets`
- `URL-Fetch Adapter Acceptance Is Deterministic Mock-Only`

**對應封存變更**：`openspec/changes/archive/2026-10-10-control-omp-url-fetch-transport`
**相關文件**：`docs/OMP_NETWORK.md`

## 6.2 受控網頁搜尋

**白話說明**
網頁搜尋同樣被拉進受控通道：每一次供應商請求與結果補充請求都走同一套 SSRF 與逐跳驗證。可用的後端限定在「用支援的憑證就能存取的 Gemini 與 OpenRouter 接地搜尋」；若憑證不存在，該路由就維持封鎖並留下「待決策」標記，而不是偷偷改用其他機制或要求新密鑰。輸出的結果格式維持原生樣貌（標題、網址、引文），錯誤也以原生錯誤形式誠實呈現。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/search-transport.ts:213` | `selectSearchBackend()` 後端選擇 |
| `src/acp/omp/search-transport.ts:231` | `decideSearchRoute()` 路由決策 |
| `src/acp/omp/search-transport.ts:302` | `parseSearchToolInput()` 查詢輸入解析 |
| `src/acp/omp/search-transport.ts:391 / 423` | `buildGeminiSearchRequest()` / `buildOpenRouterSearchRequest()` |
| `src/acp/omp/search-routes.ts:229` | `SEARCH_ROUTE_TABLE` 後端分級表 |
| `src/acp/omp/search-routes.ts:362` | `admitWebSearchBackend()` |
| `src/acp/omp/search-routes.ts:412` | `webSearchSeamState()` 縫隙狀態 |
| `src/acp/omp/extension/search-replacement.ts:174` | `createSearchReplacementToolDefinition()` |
| `src/acp/omp/extension/search-replacement.ts:310` | `registerSearchReplacement()` |

**測試位置**
- `tests/acp/omp-search-transport-decisions.test.ts`
- `tests/acp/omp-search-interface-shape.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Controlled Web-Search Transport Routing Through the URL-Fetch Decision Core`
- `Web-Search Backend Tiering Restricted to the Supported Credential Set`
- `Web-Search Native Interface, Citation, and Error Honesty`
- `Credential-Absent Web Search Fails Closed With a Documented Capability Gap`
- `Web-Search Seam Completion Is Additive, Route-Scoped, and Backend-Gated`
- `Native YOLO Web Search Keeps Native Behavior`
- `Web-Search Adapter Acceptance Is Deterministic Mock-Only`

**對應封存變更**：`openspec/changes/archive/2026-10-10-adapt-omp-web-search`
**相關文件**：`docs/OMP_NETWORK.md`

## 6.3 網路替換工具的放行閘門

**白話說明**
替換工具寫好了，但管制系統預設不會讓「等待轉接器」的項目通過。這項功能讓工具清單在「轉接器確實完成且有支援後端」時才放行替換路由；其他情況（轉接器缺席、後端不支援、來源過期或未涵蓋的原生路由）一律維持封鎖並回報有界錯誤，不會偷偷放行任何請求。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/fetch-routes.ts:242` | `isRouteCompleted()` |
| `src/acp/omp/search-routes.ts:305` | `isSearchRouteCompleted()` |
| `src/acp/omp/extension/enforcement.ts:641` | `consumeNetworkAdapterCompletion()` 消費完成決策 |

**測試位置**
- `tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts`
- `tests/acp/omp-tool-enforcement-wiring.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Source-Cited Supported-Route Enumeration with Honest Blocked Residuals`
- `Pending-Adapter Seam Completion Is Additive and Route-Scoped`
- `Web-Search Seam Completion Is Additive, Route-Scoped, and Backend-Gated`

**對應封存變更**：`openspec/changes/archive/2026-10-12-admit-completed-omp-network-adapters`

## 6.4 替換工具的原生介面契約

**白話說明**
替換工具一開始缺少原生必要的參數結構描述，回傳格式也與原生不同。這項功能把兩個替換工具（讀取、搜尋）對齊成原生契約：提供原生相容的參數 schema、回傳原生 `content` 陣列（誠實區分文字、圖片、二進位中繼資料、錯誤），並保留對非網路輸入的原生委派。

**主要實作**

| 位置 | 說明 |
|---|---|
| `src/acp/omp/extension/read-replacement.ts:506` | `READ_REPLACEMENT_PARAMETERS` 參數結構描述 |
| `src/acp/omp/extension/read-replacement.ts:580` | `formatNativeShapedUrlRead()` |
| `src/acp/omp/extension/read-replacement.ts:610-632` | `formatNativeBytes()` / `buildBinaryNotice()` / `encodeBase64()` |
| `src/acp/omp/extension/search-replacement.ts:113` | `SEARCH_REPLACEMENT_PARAMETERS` |

**測試位置**
- `tests/acp/omp-search-interface-shape.test.ts`
- `tests/acp/omp-fetch-transport-shapes.test.ts`

**規格需求**（`openspec/specs/acp-integration/spec.md`）
- `Controlled Replacements Have Native Parameter Contracts`
- `Controlled Read Results Use Native Content Representations`

**對應封存變更**：`openspec/changes/archive/2026-10-12-align-omp-native-tool-contracts`

## 6.5 移除公開程式碼搜尋

**白話說明**
原本規劃要保留「公開程式碼搜尋」能力以對齊 OpenCode。但稽核發現 OpenCode 在 1.18.21 已經**移除**了該工具，OMP 側也沒有正式可用的後端與憑證。因此這項功能選擇誠實地整個移除該能力（含執行器、路由表、清單項目與相關測試），而不是留著一個沒有實際消費者、也沒人維護的半成品。

**主要實作**
- 移除對象：`src/acp/omp/` 下原 public-code-search 執行器與路由資料、`agent-config/opencode.json` 中失效的 `codesearch` 權限項
- 相關調整：`src/acp/omp/fetch-routes.ts`、`src/acp/omp/search-routes.ts`（傳輸與清單需求收斂為 URL 讀取與網頁搜尋）

**測試位置**
- `tests/acp/omp-search-transport-decisions.test.ts`（移除後的適用範圍）
- `tests/acp/omp-compatibility-contracts.test.ts`

**規格需求**
- `openspec/specs/acp-integration/spec.md` — `Dedicated Public Code Search Is Outside OpenCode Parity`
- `openspec/specs/acp-integration/spec.md` — `Source-Cited Supported-Route Enumeration with Honest Blocked Residuals`
- `openspec/specs/container-packaging/spec.md` — `Auditable Digest Manifest With Recut Invariant`

**對應封存變更**
- `openspec/changes/archive/2026-10-10-adapt-omp-public-code-search`（原始適配提案，後被取代）
- `openspec/changes/archive/2026-10-12-remove-omp-public-code-search`（實際移除）

**相關文件**：`docs/OMP_NETWORK.md`
