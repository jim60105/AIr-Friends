# 內建技能目錄

AIr-Friends 內建一組開箱即用的專屬技能（Skills），存放於專案的 `skills/` 目錄，並以 Deno TypeScript 腳本實作。每個技能的腳本位於 `skills/<name>/scripts/<name>.ts`，說明檔為 `skills/<name>/SKILL.md`。

---

## 內建技能清單

| 技能名稱 | 腳本路徑 | 功能說明 |
| :--- | :--- | :--- |
| `memory-save` | `skills/memory-save/scripts/memory-save.ts` | 儲存一則長期記憶條目至使用者的記憶庫 |
| `memory-search` | `skills/memory-search/scripts/memory-search.ts` | 以語彙評分搜尋使用者記憶與全域知識筆記 |
| `memory-patch` | `skills/memory-patch/scripts/memory-patch.ts` | 更新既有記憶條目的屬性（含停用） |
| `memory-stats` | `skills/memory-stats/scripts/memory-stats.ts` | 查詢記憶庫的統計摘要 |
| `memory-export` | `skills/memory-export/scripts/memory-export.ts` | 匯出使用者的記憶資料 |
| `send-reply` | `skills/send-reply/scripts/send-reply.ts` | 將最終回覆發布至當前對話頻道或私訊 |
| `edit-reply` | `skills/edit-reply/scripts/edit-reply.ts` | 編輯先前送出的回覆訊息 |
| `get-message` | `skills/get-message/scripts/get-message.ts` | 依訊息 ID 取回單則訊息內容 |
| `fetch-context` | `skills/fetch-context/scripts/fetch-context.ts` | 取回頻道近期訊息作為對話脈絡 |
| `react-message` | `skills/react-message/scripts/react-message.ts` | 對訊息加上表情符號回應 |
| `set-reminder` | `skills/set-reminder/scripts/set-reminder.ts` | 建立指定未來時間觸發的定時提醒 |
| `cancel-reminder` | `skills/cancel-reminder/scripts/cancel-reminder.ts` | 取消既有提醒 |
| `list-reminders` | `skills/list-reminders/scripts/list-reminders.ts` | 列出使用者的提醒清單 |
| `send-file` | `skills/send-file/scripts/send-file.ts` | 傳送檔案至對話頻道 |

提醒相關的三個技能需設定 `reminders.enabled`，`send-file` 需設定 `skills.sendFile.enabled`，否則不會註冊。另有兩個由代理人自行使用的技能，不含獨立腳本。

| 技能名稱 | 說明 |
| :--- | :--- |
| `self-research` | 自主研究工作階段的指引，代理人自行執行網路搜尋與瀏覽器工具並撰寫筆記 |
| `agent-browser` | 瀏覽器自動化操作指引 |

> `webfetch` 並非本專案內建技能。網頁抓取與搜尋由代理人引擎的原生工具（例如 OpenCode 內建工具）或外部技能提供。

---

## 執行與通訊架構

外部代理人（OpenCode / OMP）在工作區中透過 shell 命令呼叫技能腳本，例如 `.../memory-save/scripts/memory-save.ts --session-id ... --content-file ...`。自由文字內容不會出現在命令列上，而是由代理人寫入工作階段暫存目錄的酬載檔案，腳本再讀取該檔案。腳本透過本地 HTTP 請求與主程序的 **Skill API 伺服器** 通訊，驗證工作階段 Session ID 後完成記憶儲存或訊息發布。Skill API 伺服器預設監聽 `127.0.0.1:3001`（`skillApi.port`）。
