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

技能呼叫是一段跨程序的往返。外部代理人（OpenCode / OMP）在工作區中以命令列啟動 Deno 腳本，腳本再以本機 HTTP 請求呼叫主程序中的 **Skill API 伺服器**，由伺服器分派給對應的技能處理常式，完成記憶儲存或訊息發布。這道程序邊界讓代理人無法直接觸及機器人的內部狀態。每個動作都必須通過工作階段驗證，也只能作用於該工作階段所屬的工作區與頻道。

一次典型的技能呼叫會經過以下環節：

1. 代理人以編輯或寫入工具，將自由文字寫入本次工作階段的酬載檔案。
2. 代理人以 shell 執行技能腳本，例如 `.../memory-save/scripts/memory-save.ts --session-id ... --content-file ...`。
3. 腳本讀取酬載檔案，並由 `skills/lib/client.ts` 對 `POST http://127.0.0.1:3001/api/skill/{skill-name}` 發送請求，請求標頭帶上該工作階段的 JWT。
4. Skill API 伺服器驗證 JWT 與工作階段狀態，再交由 `SkillRegistry` 分派至對應處理常式。
5. 處理常式存取記憶體儲存庫或呼叫平台介面，將結果回傳給腳本，腳本再以 JSON 輸出供代理人判讀。

### 酬載檔案契約

自由文字一律不放在命令列上。Bash 會先展開命令列中的 `$VAR`，內容因此被破壞，子行程的環境變數也可能被帶進外部頻道。代理人改為把文字寫入酬載檔案，再以檔案路徑呼叫腳本，由腳本逐字讀回。

暫存目錄固定為 `{workspace}/tmp/{sessionId}`，其絕對路徑會以 `{{ tmpDir }}` 的形式渲染進系統提示詞，代理人必須原樣引用該字面路徑，不可自行以環境變數拼組。通用旗標為 `--message-file`（回覆內容）、`--content-file`（記憶內容）、`--query-file`（搜尋查詢）與 `--caption-file`（檔案說明文字）。

`skills/lib/payload.ts` 負責路徑解析與邊界檢查。解析後的路徑必須落在該工作階段自己的暫存目錄內，符號連結也會先還原再檢查，因此無法以同層前綴（例如 `{base}-2`）或連結跳出邊界。違反契約時，腳本會在 stderr 輸出帶有穩定錯誤碼的 JSON 並以非零狀態結束，讓代理人得以自行修正。

| 錯誤碼 | 意義 | 修正方式 |
| :--- | :--- | :--- |
| `SKILL_LEGACY_FLAG` | 使用了已移除的自由文字旗標（`--message`、`--content`、`--query`、`--caption`） | 改寫入酬載檔案，並以對應的 `--*-file` 旗標傳遞路徑 |
| `SKILL_MISSING_PAYLOAD` | 必要酬載未提供 | 先寫入酬載檔案，再帶上對應的 `--*-file` |
| `SKILL_PAYLOAD_OUT_OF_BOUNDS` | 酬載路徑不在本次工作階段的暫存目錄內 | 將內容寫入提示詞渲染出的暫存目錄之下 |
| `SKILL_PAYLOAD_NOT_FOUND` | 酬載檔案不存在或無法讀取 | 先以編輯或寫入工具建立檔案，再呼叫腳本 |
| `SKILL_SINGLE_FILE_FLAG` | 對 `send-file` 使用了已移除的單數旗標 `--file-path` | 改用可重複的 `--file-paths`，每個檔案帶一次 |
| `SKILL_SESSION_UNRESOLVED` | 無法解析所屬工作階段（共享行程模式下缺少 `active.json` 指標） | 於有效的代理回合內呼叫技能，不要手動設定 `SESSION_ID` |

舊版呼叫端仍可運作。以 `$TMPDIR/$SESSION_ID` 權杖形式拼出的路徑，會由 ACP 路徑邊界以自身的工作階段脈絡展開成一般路徑，因此既有 OpenCode 呼叫端不受影響。提示詞與技能文件則已全面改以字面路徑指示，不再教導權杖寫法。

### 工作階段識別與驗證

技能請求只認工作階段，不認行程。每次對話開始時，主程序會建立一組工作階段，並記錄其頻道、使用者、工作區與呼叫者權杖；識別碼以 `sess_...` 形式渲染進系統提示詞，代理人再以 `--session-id` 原樣傳入。即使傳入的值與實際工作階段不符，腳本程式庫也會自行解析所屬工作階段並取代之，因此命令列上的值不具權威性。

實際的授權依據是一次性簽發、逐次驗證的 JWT：

- 主程序在取得工作階段租約時簽發 HS256 JWT，內容為 `{sub, channel, jti, iat, exp}`，寫入 `{SKILL_JWT_DIR}/{sessionId}.jwt`，並於工作階段結束時刪除該檔案。
- 簽章金鑰為部署層級的 256 位元密鑰，來源為 `AGENT_SKILL_API_SECRET` 環境變數，或首次啟動時產生並持久化於 `data/skill-secret`（權限 `0600`）。只有主程序持有該密鑰，代理行程僅取得短期有效的 JWT 檔案。
- 伺服器端依序檢查四項：HMAC 簽章是否相符、`sub` 是否等於請求的 `sessionId`、`channel` 是否等於工作階段註冊的頻道、`jti` 是否等於該工作階段的呼叫者權杖，且 `exp` 尚未過期。
- JWT 有效期為 30 分鐘，與工作階段閒置逾時一致（`src/utils/skill-jwt.ts`）。共享行程池會在有效期過半時重新簽發，避免排隊等待中的工作階段持有過期憑證。

### 部署形態差異

工作階段身分的解析來源隨部署形態而異，兩種形態都要求代理人傳入提示詞渲染出的字面識別碼。

| 形態 | 身分來源 | 說明 |
| :--- | :--- | :--- |
| 每次生成獨立行程（預設） | 子行程環境變數 `SESSION_ID` | 每個工作階段各自生成一個代理行程，環境中的工作階段身分即對應本次對話 |
| 共享行程池（`agent.sharedProcess.enabled`） | `{SKILL_JWT_DIR}/active.json` 指標 | 長效行程在租約取得時由池寫入指標檔，行程本身不帶生成時的工作階段身分 |

共享行程模式下，若指標檔缺失、不可讀或格式錯誤，腳本會在讀取任何酬載檔案之前以 `SKILL_SESSION_UNRESOLVED` 直接失敗，不會退回命令列參數。指標是該形態唯一的權威來源；若容許退回，一個延遲執行中的腳本就可能讀取並刪除同一工作區中另一組工作階段的暫存內容（後續的 JWT 檢查把關的是 API 呼叫，不是檔案讀寫）。腳本另會在單次執行期間快照所屬工作階段與 JWT，因此後續工作階段改寫指標時，不會影響仍在背景執行中的腳本。

### HTTP 介面

Skill API 伺服器只接受 POST，路由為 `/api/skill/{skill-name}`，其他路徑與方法分別回傳 404 與 405。請求主體為 `{ sessionId, parameters }`，回應為 `{ success, data?, error?, code? }`。

| 狀態碼 | 情境 |
| :--- | :--- |
| 400 | 缺少 `sessionId` |
| 401 | 工作階段不存在或已過期；JWT 已過期 |
| 403 | 缺少 Authorization 標頭，或 JWT 驗證失敗（簽章、`sub`、`channel`、`jti` 不符）；`send-file` 用於非使用者觸發的工作階段 |
| 404 | 技能名稱不存在 |
| 405 | 非 POST 方法 |
| 409 | 工作階段正處於崩潰復原的封鎖狀態 |
| 429 | 已達回覆或檔案傳送配額 |
| 500 | 伺服器內部錯誤 |

伺服器另有一層 1 秒去重快取。同一工作階段、同一技能、同一參數的重複請求會得到先前的結果，避免代理人在單一回合內重複觸發相同副作用。驗證失敗與 `send-file` 的結果不進快取，前者避免未授權者汙染合法呼叫端的結果，後者讓配額與迴圈偵測保持有效。

### 工作階段生命週期

工作階段建立時會登記於 `SessionRegistry`，並附帶閒置逾時（`skillApi.sessionTimeoutMs`，預設 30 分鐘）。每次通過驗證的呼叫都會重新整理該計時器；逾時的工作階段在查詢時視為不存在，並由清理計時器回收，之後的技能呼叫會得到 401。工作階段結束時，對應的 JWT 檔案一併刪除。

### 執行限制與保護

技能是代理人唯一能影響外界的管道，因此伺服器對具外部副作用的技能設有配額與迴圈防護。超過配額的嘗試會被拒絕，並累計次數；達到門檻即判定為迴圈並終止該代理行程。

| 技能 | 配額 | 備註 |
| :--- | :--- | :--- |
| `send-reply` | 每工作階段 1 次 | 失敗時回復為未回覆狀態，計數仍累加；累計 4 次嘗試即終止行程 |
| `send-file` | 每工作階段 1 次（多檔批次算一次） | 僅限使用者觸發的工作階段；未實際送達時退回配額；累計 4 次嘗試即終止行程 |
| `edit-reply` | 累計 3 次即終止行程 | 成功編輯才累加計數 |

另外三層防護與周邊機制：

- **崩潰復原封鎖**：工作階段處於崩潰復原期間，具外部副作用的技能（回覆、編輯、檔案、表情回應、記憶寫入、提醒）一律回傳 409，唯讀技能（`memory-search`、`memory-stats`、`fetch-context`、`get-message`、`memory-export`）不受影響。已進入處理常式的副作用呼叫會被計數，讓復原決策得以等待其結清，避免重複效果。
- **指標**：每次技能呼叫都會累加 `airfriends_skill_api_calls_total{skill, status}`，可從 `/metrics` 取得（需設定 `metrics.enabled`）。
- **就緒檢查**：Health Check 伺服器的 `/readyz` 會一併檢查 Skill API 伺服器連線，設定檔路徑為 `skillApi.enabled`、`skillApi.host` 與 `skillApi.port`，預設為 `127.0.0.1:3001`。用戶端預設連線至 `http://localhost:3001`，可由 `SKILL_API_URL` 環境變數或 `--api-url` 參數覆寫，且僅允許 localhost 位址。

權限層面另有一道把關，代理人在受限模式（非 YOLO）下僅能執行技能清單中已註冊的腳本，詳見[沙盒與安全界線](../agent/security-and-sandbox.md)。若你要自行開發同構的技能，請接續閱讀[自訂技能開發](custom-skills.md)。
