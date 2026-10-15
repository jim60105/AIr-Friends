# 自主研究探索

「自主研究（Self-Research）」是 AIr-Friends 的一項自主代理能力，允許機器人在空閒時間主動進行主題探索與知識整合。

---

## 自主研究工作流程

1. **研究動機產生**：題材來自先前對話中未完全解決的問題，或來自 `selfResearch.rssFeeds` 設定的 RSS 來源。
2. **工具呼叫與資訊檢索**：排程器啟動獨立的 ACP 研究工作階段（工作階段類型 `self-research`），並依 `self-research` 技能的指引，使用代理人引擎的網路搜尋與瀏覽器工具查詢外部資訊。
3. **知識綜合與儲存**：代理人將檢索到的資料交叉驗證、整理歸納後，寫入全域知識庫（`agent-workspace/notes/{topic-slug}.md`），並更新索引檔 `agent-workspace/notes/_index.md`。

`selfResearch.verifyCompletion` 啟用時，系統會檢查工作階段是否確實產生研究筆記，未產生者會重試一次。

---

## 全域工作區寫入權限管制

全域代理人知識庫（`agent-workspace/`）屬於跨使用者的共用知識空間。

- **嚴格寫入限制**：一般使用者會話、自發貼文會話與頻道潛水會話對該目錄皆為**唯讀（Read-only）**，防止個別使用者污染共用知識。
- **僅自主研究工作階段具備寫入權限**：只有帶有 `canWriteAgentWorkspace` 授權的自主研究工作階段，其針對 `agent-workspace/` 的寫入或修改請求才會被 ACP 權限閘道放行。
