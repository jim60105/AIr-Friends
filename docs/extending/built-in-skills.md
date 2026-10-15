# 內建技能目錄

AIr-Friends 內建一組開箱即用的專屬技能（Skills），存放在專案的 `skills/` 目錄中，並以 Deno TypeScript 腳本實作。

---

## 內建技能清單

| 技能名稱 | 腳本路徑 | 功能說明 | 執行權限需求 |
| :--- | :--- | :--- | :--- |
| **`memory-save`** | `skills/memory-save/index.ts` | 儲存一則新的長期記憶條目至當前使用者的記憶庫中 | 需提供分類（category）、內容（content）與重要性評分 |
| **`memory-search`** | `skills/memory-search/index.ts` | 搜尋使用者個人記憶與全域代理人知識庫筆記 | 語彙倒排索引搜尋，支援關鍵字與標籤過濾 |
| **`reminder-create`** | `skills/reminder-create/index.ts` | 建立一則指定未來時間觸發的定時提醒通知 | 需提供 ISO 時間戳記或相對時間與提醒內文 |
| **`reply`** | `skills/reply/index.ts` | 將生成的文字訊息發布至當前對話頻道或私訊 | 傳遞最終訊息給社群平台介面 |
| **`webfetch`** | `skills/webfetch/index.ts` | 抓取外部網頁內容並轉換為簡潔的純文字或 Markdown | 受限模式下需經權限閘道放行或配置網路白名單 |

---

## 執行與通訊架構

1. **子行程執行**：外部代理人（OpenCode / OMP）在工作區中透過 shell 命令（例如 `deno run --allow-net ...`）呼叫技能腳本。
2. **HTTP 回呼 (Callback)**：技能腳本內部透過本地 HTTP 請求與主程序的 **Skill API 伺服器**（預設監聽於 3000 埠）通訊，驗證工作階段 Session ID 並完成實際的記憶儲存或訊息發布。
