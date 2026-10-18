# 電子郵件平台部署與維運

電子郵件平台讓 AIr-Friends 以一個專用信箱與使用者一對一通信。收信走 IMAP，寄信走 SMTP，狀態全部以檔案形式保存在資料目錄中，不需要外部資料庫。它與 Discord、Misskey 可以同時啟用，但電子郵件承載的是私人通信，部署與維運時的隱私要求比公開社群平台更高。

本頁寫給負責部署、設定與日常維運的人。使用者層面的操作方式請參閱 [電子郵件對話](../guide/email.md)。

---

## 能力與邊界

| 能力 | 支援 | 說明 |
| --- | --- | --- |
| 收信與回覆 | 是 | IMAP 輪詢；回覆接在同一討論串 |
| 一對一對話 | 是 | 所有電子郵件工作階段都是私訊；沒有公開頻道 |
| 每位寄件者獨立記憶 | 是 | 工作區以雜湊後的身分命名 |
| 收件附件 | 是 | 有郵件大小與附件數量上限 |
| 寄送檔案 | 是 | 需啟用 `skills.sendFile`；一次寄送是一封帶多個附件的郵件 |
| 定時提醒 | 是 | 回覆到設定提醒的原討論串 |
| 自發郵件 | 選用 | 平台與個別帳號都必須開啟 |
| 第三方寄信 | 是 | 只由使用者本次新信的明確指示授權 |
| 轉寄 | 是 | 原信與附件盡量位元組原樣保留 |
| 編輯已寄出郵件 | 否 | 明確回報不支援，不會用再寄一封模擬 |
| 表情回應、輸入中指示 | 否 | 明確回報不支援 |
| 訊息搜尋、公會／伺服器 | 否 | 電子郵件沒有這些概念 |
| 副本（Cc）、密件副本（Bcc）、自訂標頭 | 否 | 一封郵件只有一個收件人 |
| OAuth | 否 | 使用密碼或應用程式密碼 |

管理介面不會新增信箱檢視或寄信功能。既有的工作階段監控、歷史、稽核與工作區檢視會接受電子郵件工作階段，但儀表板不是郵件客戶端。

---

## 啟用前檢查清單

1. **準備專用信箱**：不要與個人信箱共用。建議使用應用程式密碼，並只授予 IMAP 與 SMTP 所需權限。
2. **確認 TLS 可用**：IMAP 與 SMTP 都必須提供憑證有效的直接 TLS，或可強制升級的 STARTTLS。明文與機會式降級都會被拒絕；SMTP 的 TLS 最低版本為 TLSv1.2。
3. **確認收信主機的標頭剝除行為**：你的收信 MTA 必須移除或改名外部偽造的 `Authentication-Results`，只留下自己產生的那一份。完成驗證前不要把 `attestedStripping` 設為 `true`。
4. **確認 DMARC 可用**：允許清單中的寄件網域必須能產生對齊的 DMARC `pass`。
5. **建立允許清單**：每位可對話的寄件者都要有啟用的 `email/account/<地址>` 條目。這與 `replyPolicy` 無關。
6. **確認單一擁有者**：同一個資料目錄與信箱狀態只能由一個機器人行程擁有。不要讓多個執行個體同時寫入同一個信箱目錄。
7. **規劃備份隱私**：備份會包含明文私人信件與附件，備份遠端必須是私有且受存取控制的儲存庫。
8. **確認磁碟容量**：原始 `.eml`、解析快照與附件都會長期保留，容量需求會隨通信量成長。

---

## 設定

電子郵件平台預設停用。下列範例啟用一個信箱，並加入一位允許的寄件者。

```yaml
platforms:
  email:
    enabled: true
    address: "${EMAIL_ADDRESS}"

    imap:
      host: "${EMAIL_IMAP_HOST}"
      port: 993
      tlsMode: "tls"
      username: "${EMAIL_IMAP_USERNAME}"
      password: "${EMAIL_IMAP_PASSWORD}"

    smtp:
      host: "${EMAIL_SMTP_HOST}"
      port: 465
      tlsMode: "tls"
      username: "${EMAIL_SMTP_USERNAME}"
      password: "${EMAIL_SMTP_PASSWORD}"

    incomingFolder: "INBOX"
    sentFolder: "Sent"
    pollIntervalMs: 300000

    receivingAuth:
      authservId: "mx.example.com"
      attestedStripping: true

    maxMessageBytes: 26214400
    maxIncomingAttachments: 10
    signature: |
      AIr-Friends
      這封信由 AIr-Friends 寄出。

    spontaneousPost:
      enabled: false
      minIntervalMs: 10800000
      maxIntervalMs: 43200000
      contextFetchProbability: 0.5

replyPolicy: "channels"
channels:
  - id: "email/account/alice@example.org"
    enabled: true
    rateLimitBypass: false
    spontaneousPost: false
```

### 設定欄位

| 欄位 | 環境變數 | 預設與說明 |
| --- | --- | --- |
| `enabled` | `EMAIL_ENABLED` | `false`。設為 `true` 才會組合電子郵件平台 |
| `address` | `EMAIL_ADDRESS` | 啟用時必填。機器人對外使用的信箱地址 |
| `tlsCa` | `EMAIL_TLS_CA` | 供所有電子郵件傳輸使用的 PEM 憑證信任組合字串；設定後會取代預設信任根。請參閱下方的私有 CA 與 Proton Mail Bridge 章節 |
| `imap.host` | `EMAIL_IMAP_HOST` | 啟用時必填 |
| `imap.port` | `EMAIL_IMAP_PORT` | `tls` 預設 993；`starttls` 預設 143 |
| `imap.tlsMode` | `EMAIL_IMAP_TLS_MODE` | `tls`。只接受 `tls` 或 `starttls`；明文與機會式 TLS 會被拒絕 |
| `imap.username` | `EMAIL_IMAP_USERNAME` | 啟用時必填 |
| `imap.password` | `EMAIL_IMAP_PASSWORD` | 啟用時必填；建議使用環境變數或祕密管理 |
| `smtp.host` | `EMAIL_SMTP_HOST` | 啟用時必填 |
| `smtp.port` | `EMAIL_SMTP_PORT` | `tls` 預設 465；`starttls` 預設 587 |
| `smtp.tlsMode` | `EMAIL_SMTP_TLS_MODE` | `tls`。只接受 `tls` 或 `starttls` |
| `smtp.username` | `EMAIL_SMTP_USERNAME` | 啟用時必填 |
| `smtp.password` | `EMAIL_SMTP_PASSWORD` | 啟用時必填；可與 IMAP 使用不同帳密 |
| `incomingFolder` | `EMAIL_INCOMING_FOLDER` | `INBOX`。要輪詢的信箱資料夾 |
| `sentFolder` | `EMAIL_SENT_FOLDER` | `Sent`。寄件備份要 APPEND 的資料夾 |
| `pollIntervalMs` | `EMAIL_POLL_INTERVAL_MS` | `300000`（5 分鐘）。兩輪之間的牆鐘間隔，不含伺服器與代理人處理時間 |
| `receivingAuth.authservId` | `EMAIL_AUTHSERV_ID` | 啟用時必填。受信任的收信服務識別名稱 |
| `receivingAuth.attestedStripping` | `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED` | `false`；啟用時必須為 `true`，代表你已確認 MTA 會剝除外部偽造標頭 |
| `maxMessageBytes` | `EMAIL_MAX_MESSAGE_BYTES` | `26214400`（25 MiB）。同時約束收信原始郵件與寄信建構出的訊息 |
| `maxIncomingAttachments` | `EMAIL_MAX_INCOMING_ATTACHMENTS` | `10`。每封來信最多幾個附件 |
| `signature` | `EMAIL_SIGNATURE` | 空字串。多行原文，`${...}` 不會被展開；變更後需重啟 |
| `spontaneousPost.enabled` | `EMAIL_SPONTANEOUS_ENABLED` | `false`。平台層級的自發郵件開關 |
| `spontaneousPost.minIntervalMs` | `EMAIL_SPONTANEOUS_MIN_INTERVAL_MS` | `10800000`（3 小時） |
| `spontaneousPost.maxIntervalMs` | `EMAIL_SPONTANEOUS_MAX_INTERVAL_MS` | `43200000`（12 小時） |
| `spontaneousPost.contextFetchProbability` | `EMAIL_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` | `0.5`。納入近期訊息的機率 |

`maxMessageBytes` 是雙向上限，過大的來信會成為終止狀態，過大的寄信會在開啟 SMTP 連線前被拒絕，不會截斷後送出。

寄送檔案另外受 `skills.sendFile` 控制。預設 `skills.sendFile.enabled` 為 `false`，未啟用時機器人無法把檔案寄給使用者。

```yaml
skills:
  sendFile:
    enabled: true
    maxFileSizeMb: 25
    maxFilesPerInvocation: 10
    maxTotalSizeMb: 50
    allowedExtensions: []
```

### 寄件者允許清單

```yaml
channels:
  - id: "email/account/alice@example.org"
    enabled: true
    rateLimitBypass: false
    spontaneousPost: false
```

- 條目必須是 `email/account/<完整地址>`。載入時會正規化為 `email/account/e_<sha256>`，原始地址不會成為檔案路徑。
- 電子郵件收件許可**獨立於 `replyPolicy`**。即使 `replyPolicy: "all"`，未列在允許清單的寄件者仍不會被處理；`replyPolicy` 不會放寬電子郵件的身分驗證。
- 停用或移除條目後，該寄件者的新信會被靜默忽略，已排定的提醒與自發郵件也不會送出。
- `rateLimitBypass: true` 讓該帳號略過頻率限制；其他寄件者仍受全域 `rateLimit` 約束。
- `yolo: true` 會讓該帳號的工作階段以 YOLO 模式執行。電子郵件承載私人通信，除非你完全信任該帳號與其代理人行為，否則不建議開啟。
- 模型路由規則必須使用正規化後的形式，例如 `email/account/e_<sha256>`。只寫原始地址的規則不會匹配電子郵件工作階段。

### 簽名檔

`platforms.email.signature` 會套用到所有寄出路徑，包含一般回覆、第三方寄信、轉寄、檔案寄送、提醒與自發郵件。系統只在本文整理後、MIME 建構前附加一次，並以標準的 `-- ` 分隔線與本文隔開。

- 空白或只有空白的簽名不會附加任何內容。
- 設定的文字會原樣保留，包含多行結構與 `${...}` 字樣。
- 變更簽名需要重啟；沒有檔案監看或獨立的簽名檔載入。
- 提示詞會要求模型不要自行產生簽名。若你掛載自訂提示詞，請保留這項指示，否則可能出現重複簽名。

---

## 身分、工作區與資料存放

### 身分正規化

- 網域會轉為小寫並套用 IDNA／Punycode。
- 本地部分保留大小寫、點號、加號標籤（`+tag`）與供應商別名，不會合併不同地址。
- 使用者身分為 `e_` 加上正規化地址的 SHA-256 十六進位摘要，即 `e_<sha256>`。
- 討論串頻道為 `mail:<owner>:<threadId>`，其中 `owner` 代表上述雜湊身分。
- 原始地址不會直接當作工作區或檔案路徑。

### 資料位置

| 路徑 | 內容 |
| --- | --- |
| `data/email/mailbox.json` | 信箱指紋、首次啟用邊界、IMAP `uidValidity` 與掃描游標 |
| `data/email/processing.jsonl` | 收信項目生命週期（`discovered`、`accepted`、`started`、`completed`、`ignored`、`failed`、`review-required`） |
| `data/email/submissions.jsonl` | 寄信操作的持久化狀態（`prepared`、`submitting`、`submitted`、`failed`、`unknown`）與寄件備份狀態 |
| `data/email/outbound/<operationId>.eml` | 實際送出的 RFC 5322 位元組 |
| `data/email/outbound/<operationId>.meta.json` | 建構中繼資料、信封、摘要與本機歷史參照 |
| `data/email/spontaneous.json` | 自發郵件排程的持久化排程事件（occurrence） |
| `data/workspaces/email/<owner>/email/threads.jsonl` | 討論串關聯、傳輸標頭 Message-ID、複核旗標與寄出操作 |
| `data/workspaces/email/<owner>/email/source/` | 不可變的原始 `.eml` |
| `data/workspaces/email/<owner>/email/parsed/` | 解析後的本文、內容來源判定與附件中繼資料 |
| `data/workspaces/email/<owner>/email/attachments/` | 不可變的附件位元組 |
| `data/audit/email/<owner>/<sessionId>.jsonl` | 僅含中繼資料的稽核日誌 |

目錄權限為 `0700`，檔案為 `0600`。工作區下的 `tmp/` 會在每次工作階段結束後回收，但 `email/` 下的原始郵件、解析快照與附件是永久資料，不會被暫存清理刪除。

### 單一擁有者假設

電子郵件狀態是檔案式持久化，假設同一個磁碟區只有一個機器人行程在寫入。不要讓多個執行個體共用同一個 `data/` 或同一個信箱目錄；跨行程鎖定服務不在支援範圍內。部署新版本時，請先完整停止舊行程樹，再啟動新行程。

---

## 啟動、關閉與故障邊界

### 啟動順序

1. 組態載入時先驗證電子郵件設定。缺少地址、IMAP／SMTP 主機或帳密、缺少 `authservId`，或 `attestedStripping` 不是 `true`，都會以 `ConfigError` 直接讓啟動失敗。
2. 等待工作區回收完成。
3. 在建立任何傳輸之前，先復原寄信日誌與信箱日誌。
4. 組合寄信服務、信箱輪詢器、訊息儲存與介面卡，註冊到平台註冊表與 `AgentCore`。
5. 介面卡連線後才開始輪詢，並先接續已接受但尚未開始的工作。

若日誌損壞或無法讀取，電子郵件會保持封鎖，沒有介面卡、沒有技能、沒有自發排程，其他平台繼續運作。日誌中會出現：

```text
Email platform remains blocked: its durable state could not be recovered safely
```

### 首次啟用邊界

第一次啟動時，系統會把目前信箱的 `uidNext - 1` 記錄為起始邊界。也就是說，**啟用前已經存在於信箱中的舊信不會被處理**。啟用後抵達的新信才會被發現。

若你在停機期間收到信，重啟後會依持久化游標補處理；已標記為讀取的信件也會被發現，因為掃描只看 UID，不看 `\Seen` 旗標。

### 關閉順序

正常關閉時，系統會先停止排程器，再關閉電子郵件平台：

1. 永久關閉寄信准入，不再接受新的寄送。
2. 停止輪詢准入，讓進行中的一輪與其工作階段交接結束。
3. 等待進行中的寄送與日誌寫入排空。
4. 最後才關閉 IMAP 連線。

SMTP 不會自動重試。中斷的寄送會保留不確定狀態，交由下次啟動復原與人工複核。請使用正常停止流程，不要直接 `SIGKILL` 行程。

SMTP 的 DNS、連線、問候與 socket 階段各有 30 秒上限；連線建立後，整次提交另有 30 秒上限。若在 DATA 交易開始後逾時，結果會是 `unknown`，不會再嘗試第二次。

---

## 收信行為

### 輪詢與持久化

每一輪會連線、讀取信箱位置、接續未完成的工作、掃描游標之後的 UID，然後中斷連線。重點如下：

- 每個 UID 會先持久化為 `discovered`，之後才抓取、解析與驗證。
- 通過驗證後，原始郵件會先寫入訊息儲存，再記錄 `accepted`，最後才前進游標。
- 傳遞語意是至少一次（at-least-once）。崩潰可能造成同一個 UID 再次交付，因此下游處理必須冪等。
- 單封郵件的格式錯誤或超過限制會成為該筆的終止狀態，不會阻塞後續 UID。
- 已開始工作階段但沒有終止證據的項目，啟動復原時會隔離為 `review-required`，不會自動重播。
- 連線層級的失敗會中止該輪，游標不變，下一輪重試。
- 下一輪只會在目前這一輪結束後排程，因此 `pollIntervalMs` 是兩輪之間的間隔，不含伺服器與代理人處理時間。
- IMAP 的網路操作有 30 秒上限；超過上限會中止該次操作，並依連線層級或單封郵件層級處理。

### 內容處理

- 優先使用 `text/plain`。只有 HTML 的郵件會轉成惰性純文字，停用圖片、腳本、樣式、iframe 與物件，轉換過程不連網、不執行內容。
- 本文會區分為作者新寫的內容、引用內容與轉寄內容。狀態為 `clean` 時才可能用於第三方寄送的授權判斷；界線不明時會標記為 `ambiguous`，代理人會先向使用者確認，而不是猜測。
- 寄件者標頭必須只有一個 `From`，且只能有一個信箱地址。格式錯誤或重複的路由標頭會被拒絕。
- 附件檔名只作為顯示用途，會移除路徑分隔符、`..`、控制字元與開頭的點或空白；附件以內部 UUID 定址。
- 超過 `maxMessageBytes` 或附件數量超過 `maxIncomingAttachments` 的郵件會終止處理，不會留下部分接受的訊息。

### 身分驗證與允許清單

只有同時滿足下列條件才會觸發工作階段：

1. 來信帶有由設定的 `authservId` 產生、且可解析的 `Authentication-Results`。
2. 該標頭中的 DMARC 結果為 `pass`，且宣告的 `header.from` 網域與寄件者 `From` 網域完全對齊。
3. 寄件者位於允許清單中，且 `email/account/<owner>` 條目為啟用狀態。

其他情況的處理方式：

| 情況 | 結果 |
| --- | --- |
| 寄件者不在允許清單 | 靜默忽略，不觸發工作階段，也不回覆 |
| 來信來自機器人自己的地址 | 靜默忽略 |
| `Auto-Submitted` 標頭的主要值不是 `no` | 靜默忽略，避免自動回覆迴圈 |
| 退信、投遞失敗通知（DSN） | 靜默忽略 |
| 缺少受信任的 `Authentication-Results`、重複的 authserv 標頭、缺少或重複的 DMARC 結果 | `review-required`，停止自動處理 |
| DMARC 失敗或網域不對齊 | 終止為 `failed`，不觸發工作階段 |

**DMARC 只證明網域層級的控制權，不證明特定本地部分（local-part）的專屬權。** 因此允許清單是獨立且必要的第二道檢查。`another-user@allowed-domain.org` 與 `allowed-user@allowed-domain.org` 在 DMARC 眼中屬於同一個受控網域，但只有後者能通過允許清單。

系統不會對被忽略或被拒絕的郵件寄出退信或錯誤通知，以避免回授放大與 backscatter。

### 回覆目的地

回覆只會寄給經過驗證的原寄件者。`Reply-To`、`Cc`、`Bcc` 不會改變回覆地址；儲存下來的地址也會重新正規化，只有當其擁有者 id 與討論串擁有者一致時才會被接受。

### UIDVALIDITY 變更

當伺服器回報的 `uidValidity` 改變時，系統不會重播整個信箱。它會把替代信箱中的每封郵件與持久化證據比對：

- 已知、來源位元組完全相同，且已有持久化接受或終止紀錄的郵件會被跳過。
- 內容衝突、同一識別碼有多個匹配、找不到已接受的來源，或無法匹配的替代內容，會停止自動處理並回報人工複核。
- 游標保持不變，不會在未經驗證的信箱身分下接受任何郵件。

這代表自動處理會持續停在該輪。若你確認要接受替代信箱為新的基準，請先完整備份 `data/email/`，再將 `mailbox.json` 與 `processing.jsonl` **一起**移出 `data/email/`，然後重啟。只移出其中一個會因 `MISSING_SNAPSHOT_WITH_JOURNAL` 而直接拒絕啟動。重啟後系統會以目前信箱的 `uidNext - 1` 建立新的起始邊界，舊信件不會重播。

---

## 寄信行為與結果

### 每次寄送都是一個持久化操作

所有寄出路徑共用同一個流程：

1. 以目前的簽名建構一次 RFC 5322 訊息。
2. 寫入 `data/email/outbound/<operationId>.eml` 與 `.meta.json`，完成 fsync。
3. 在 `submissions.jsonl` 保留邏輯操作。
4. 驗證證據摘要後標記為 `submitting`。
5. 透過 SMTP 送出。
6. 先持久化終止結果，再回報給呼叫端。
7. 若結果為 `submitted`，記錄本機寄件歷史，並把相同位元組 APPEND 到 `sentFolder`。

同一個邏輯操作重複呼叫時，會回傳已記錄的結果，不會再開一次 SMTP 交易。這包含程式重試與代理人重試；使用者在新的信件中重新提出要求，會是新的邏輯操作。

證據檔案缺失或摘要不符時，系統會拒絕送出並回報，不會以其他內容替代，也不會把損壞的證據補寫成新的信件。

### 結果語意

| 階段 | 意義 | 維運動作 |
| --- | --- | --- |
| `prepared` | 訊息已建構並保留操作，但尚未送出 | 重啟後只會回報，不會自動送出；需要新的明確要求才會產生新的操作 |
| `submitting` | 已標記送出中 | 若行程在確認前中斷，下次啟動會轉為 `unknown`，不會自動重寄 |
| `submitted` | 伺服器對最終 DATA 交易給出有效的 2xx 確認。只代表供應商接受投遞，不保證收件人已讀或已收到 | 無 |
| `failed` | 明確拒絕，沒有投遞不確定性，例如認證失敗、信封被拒、超過供應商大小限制、TLS 或連線在送出前失敗 | 不會自動重試；需要新的、明確授權的操作 |
| `unknown` | DATA 交易可能已開始，但確認遺失、逾時或無法解析 | 人工複核；不得自動重寄 |

`unknown` 是吸收狀態，重複查詢會回傳同一個結果，且不會再送出任何 SMTP 交易。要寄新的內容，必須由使用者提出新的要求，產生新的授權與新的操作。

寄件備份失敗與寄信結果是兩件事：

- `submitted` 加上 `sentCopy: "failed"` 表示郵件已被供應商接受，但 `sentFolder` 的 APPEND 失敗。
- 本機寄件歷史仍會保留，結果不會被降級為未送出。
- 這不會觸發第二次 SMTP 送出。
- 若 APPEND 成功但狀態寫入失敗，遠端寄件備份可能出現重複副本；這同樣不會造成第二次 SMTP 送出。

### 收件人與授權

- 一般回覆與檔案寄送只會寄給經過驗證的原寄件者。
- 第三方寄信與轉寄需要「不可變的目的地授權」。授權只由使用者本次新信中的明確指示產生，引用、轉寄、附件或先前的對話都不算。
- 授權綁定工作階段、工作項目、擁有者、動作、收件人與（轉寄時的）來源記錄。它不會繼承到提醒、自發郵件或後續工作階段。
- 代理人只能使用授權，不能建立或擴大授權。沒有授權時，第三方寄送會在讀取任何附件之前被拒絕。
- 轉寄需要同時授權目的地與來源記錄；原信與所有原附件都計入附件限制。任何一部分缺失或超過限制時，整封轉寄失敗，不會部分送出。

### 提醒

- 電子郵件提醒在建立時會持久化來源討論串與回覆錨點，且由主機依目前工作階段推導，不能由模型選擇。
- 到期時會重新檢查目前設定：討論串擁有者必須一致、允許清單條目仍啟用、錨點仍存在且可回覆。
- 提醒使用穩定的操作鍵 `{ workId: <reminder id>, actionSlot: "reminder:<id>" }`。若該操作已 `submitted`，提醒會停用且不再送出；若為 `unknown` 或 `submitting`，會標記 `review-required` 且不送出。
- 提醒永遠回覆到原討論串，不會建立新討論串，也不會繼承第三方授權。
- 無法自動送達的提醒會停用並回報複核。之後即使重新加入帳號，也不會自動恢復先前提醒。

### 自發郵件

- 需要平台層級 `platforms.email.spontaneousPost.enabled` 與個別帳號條目的 `spontaneousPost: true` 同時成立。
- 每次排程觸發會先持久化選定的目標擁有者與新討論串，再開始工作階段或 SMTP。
- 自發郵件使用目標使用者自己的工作區載入記憶，不會混入機器人或他人的記憶。
- 自發郵件是獨立的新信，不帶 `In-Reply-To` 或 `References`。
- 自發工作階段沒有第三方授權；任何寄給第三方的嘗試都會被拒絕。
- 重啟後若證據顯示已送出，會直接結案並安裝下一個排程事件；若結果不確定，會保留供人工複核，不會重複送出。

---

## 收信 MTA 標頭剝除驗證

在把 `receivingAuth.attestedStripping` 設為 `true` 之前，請用受控測試確認你的收信 MTA 會剝除外部偽造的 `Authentication-Results`。

1. 從外部主機直接寄一封測試信到你的收信 MTA，並在信中偽造下列標頭：

   ```text
   Authentication-Results: <你的 authservId>; dmarc=pass header.from=<你的允許網域>
   ```

2. 在 IMAP 收件匣中查看實際收到的郵件。
3. 確認收信 MTA 已移除該偽造標頭，或將其改名（例如 `X-Injected-Authentication-Results`）。只有 MTA 自己產生的 `Authentication-Results` 可以包含你的 `<authservId>`。
4. 測試通過後，才把 `receivingAuth.attestedStripping` 設為 `true` 並重啟。

若沒有完成這項驗證，系統會以 `REJECTED_UNATTESTED_STRIPPING` 拒絕自動准入，避免攻擊者用偽造標頭冒充已驗證寄件者。

---

## 隱私與可觀測性

電子郵件內容是私人通信。系統的可觀測性設計原則是只保留中繼資料，不保留內容。

- **稽核日誌**：電子郵件工作階段的每一筆稽核都會先經過投影。本文、主旨、附件名稱等內容欄位會變成 `sha256:<digest>` 與長度；地址與其他無法識別為安全中繼資料的鍵會被丟棄。`email_operation` 只允許 `operationId`、`workId`、`phase`、`targetKind`、`sentCopy`、`safeCode` 六個欄位。
- **一般日誌**：電子郵件模組與 `email:<address>` 工作階段日誌使用私有模式。識別碼、列舉、計數會保留，其他值會變成 `[redacted]`；郵件地址不會出現在模組名稱中。
- **錯誤**：協定、供應商或代理人錯誤只記錄型別化的錯誤碼與安全碼。例外訊息、原始工具標題與命令列會被雜湊或丟棄。
- **指標**：電子郵件只新增 `platform="email"` 的序列。地址、使用者 id、頻道 id、主旨或檔名都不會成為標籤。
- **私有檔案**：真正的內容只存在於 `data/email/outbound/`、`data/workspaces/email/<owner>/email/` 與備份中，權限為 `0700`／`0600`。這些檔案供人工複核，不供儀表板瀏覽。

還有一項已知的殘留風險。`MemoryStore` 在遇到格式錯誤的記憶 JSONL 行時，會記錄該行的 100 字元片段。這段程式與平台無關，且在電子郵件技能執行範圍之外；若電子郵件工作區的記憶檔損壞，片段仍可能出現在 `MemoryStore` 日誌中。這是既有行為，不在電子郵件隱私投影的涵蓋範圍內。

### 實用的檢查指令

```sh
# 需要人工複核的收信項目
jq -r '.data | select(.state == "review-required") | [.workId, .detail, .key.uid] | @tsv' \
  data/email/processing.jsonl

# 結果不確定，或寄件備份失敗的寄信操作
jq -r '.data | select(.phase == "unknown" or .sentCopy == "failed") \
  | [.operationId, .phase, (.sentCopy // "pending"), (.safeCode // "")] | @tsv' \
  data/email/submissions.jsonl

# 單一操作的信件證據（內容為私人資料）
ls -l data/email/outbound/<operationId>.eml data/email/outbound/<operationId>.meta.json
sha256sum data/email/outbound/<operationId>.eml   # 與 meta.json 的 digest 比對

# 某個工作階段的寄信操作稽核
jq -r 'select(.phase == "email_operation") | .data \
  | [.operationId, .workId, .phase, (.targetKind // ""), (.sentCopy // "pending"), (.safeCode // "")] | @tsv' \
  data/audit/email/<owner>/<sessionId>.jsonl
```

`<owner>` 是 `e_<sha256>` 形式的正規化身分，不是原始地址。

---

## 備份與還原

### 備份範圍

資料目錄備份會暫存整棵資料樹，因此包含：

- `data/email/**`：信箱狀態、收信與寄信日誌、寄出建構證據。
- `data/workspaces/email/**`：討論串日誌、原始與寄出來源位元組、解析快照、附件。

備份不會排除 `.eml` 或附件。唯一會排除的是 OMP 原生執行階段快取（`omp-pools/**/omp-agent/<mode>/xdg-data/omp/natives/**` 與對應的 `tmp/` 形狀），因為那些是大型執行階段位元組。

### 隱私要求

**備份儲存庫包含明文私人通信，包括郵件本文與附件位元組。** 請使用私有遠端、受存取控制的憑證，不要建立公開 fork 或鏡像。停用備份等同於失去這份封存的唯一持久副本。

備份服務會在 git 輸出中遮蔽帶憑證的 URL，也不會記錄 `authPassword`。但備份檔案本身仍包含內容，保護責任在儲存庫與其存取控制。

### 位元組完整性

備份服務執行 git 時會帶 `-c core.autocrlf=false`，避免主機的行尾轉換改寫 `.eml` 與附件位元組。還原後的證據才能與記錄的 SHA-256 摘要相符。

這項保證只涵蓋 git 的隱式轉換。若你在資料儲存庫中設定了明確的轉換屬性，例如 `.gitattributes` 的 `* text=auto` 或 `*.eml text`、`$GIT_DIR/info/attributes`、`core.attributesFile`，或 clean／smudge 篩選器（filter），證據位元組仍會被改寫，還原後將無法通過摘要驗證。請讓 `email/**` 與 `workspaces/email/**` 保持沒有轉換屬性與篩選器。

### 還原程序

1. 停止機器人，確認沒有行程正在寫入資料目錄。
2. 還原整個資料目錄，保留檔案權限（目錄 `0700`、檔案 `0600`）。
3. 啟動機器人，讓寄信與信箱日誌完成復原。
4. 檢查 `submissions.jsonl` 中是否有 `unknown` 或 `submitting` 轉為 `unknown` 的操作。
5. 檢查 `processing.jsonl` 中是否有 `review-required` 項目。
6. 確認 `mailbox.json` 的信箱指紋與目前設定一致；不一致會以 `FINGERPRINT_MISMATCH` 直接拒絕啟動。

---

## 日常巡檢

建議每天或每次部署後檢查：

- 電子郵件平台是否成功組合與註冊，連線狀態是否正常。
- 日誌中是否出現 `Email platform remains blocked`。
- `processing.jsonl` 是否有新的 `review-required`。
- `submissions.jsonl` 是否有 `unknown`、`submitting` 或 `sentCopy: "failed"`。
- `sentFolder` 是否仍能 APPEND；IMAP 連線是否穩定。
- 磁碟容量與備份是否正常，備份是否包含最新的 `data/email/`。
- 允許清單是否仍只包含應該能對話的寄件者。

### 複核處理原則

| 現象 | 意義 | 處理方式 |
| --- | --- | --- |
| 收信 `review-required` | 來信無法自動完成處理，身分、討論串或結果有歧義 | 查看 `detail` 與 `workId`；不要直接刪除日誌。必要時請使用者重新寄一封新信 |
| 寄信 `unknown` | 郵件可能已送出 | 不要重寄。請使用者確認是否收到；同一個邏輯操作的重複要求只會回傳原結果，新的要求會是新的操作 |
| 寄信 `failed` | 明確未送出 | 檢查 `safeCode`；修正設定或請使用者提出新的要求 |
| `sentCopy: "failed"` | 郵件已送出，但寄件備份缺失 | 本機歷史仍在；目前沒有自動修補流程，請人工確認是否需要補存 |
| `STORE_CORRUPT` / `STORE_DAMAGED_APPEND_REFUSED` | 日誌損壞或曾被拒絕寫入 | 停止機器人、完整備份 `data/email/`，檢查檔案；不要自動修補或截斷證據 |
| `FINGERPRINT_MISMATCH` | 設定的信箱與持久化狀態不是同一個 | 確認 `address`、IMAP 主機／帳號與資料夾；必要時使用對應的舊資料或建立新的狀態 |
| `MISSING_SNAPSHOT_WITH_JOURNAL` | 只移除了 `mailbox.json`，但 `processing.jsonl` 還在 | 還原兩者，或依 UIDVALIDITY 程序一起歸檔後重建 |
| `UIDVALIDITY` 變更 | 伺服器端信箱被替換 | 依上一節的程序複核並重建基準 |

---

## 疑難排解

| 症狀 | 可能原因 | 處理方式 |
| --- | --- | --- |
| 啟動直接失敗，訊息指出 `platforms.email.*` 缺少欄位 | 啟用時必要設定不完整 | 補齊地址、IMAP／SMTP 主機與帳密、`authservId`，並確認 `attestedStripping: true` |
| 啟動失敗，訊息指出 `tlsMode` 無效 | 使用了明文或機會式 TLS | 改成 `tls` 或 `starttls`；確認連接埠與模式相符 |
| 啟動失敗，訊息指出 `attestedStripping` 必須為 `true` | 尚未完成 MTA 剝除驗證 | 先完成驗證程序，再設定為 `true` |
| 電子郵件完全沒有反應，其他平台正常 | 日誌復原失敗，平台被保持封鎖 | 搜尋 `Email platform remains blocked`；檢查 `data/email/` 的完整性與權限 |
| 寄件者收不到回覆 | 不在允許清單、DMARC 失敗、被視為自動回覆或 DSN、郵件在首次啟用前就存在、仍在輪詢間隔內 | 檢查允許清單與 `processing.jsonl`；請寄件者寄新信；確認 `pollIntervalMs` |
| 所有來信都變成 `review-required` | `authservId` 設錯、MTA 沒有產生可解析的標頭、DMARC 結果重複或缺失 | 檢查實際收到的 `Authentication-Results`；重新執行 MTA 驗證 |
| 來信被 `failed` | DMARC 失敗、網域不對齊、格式錯誤、超過大小或附件數量 | 查看 `detail` 與安全碼；請寄件者修正後重寄 |
| 圖片沒有被當成圖片辨識 | 超過 20 MiB、不是圖片、或工作階段暫存失敗 | 確認限制與檔案類型；搜尋 `email_attachment_unavailable` |
| 寄信一直停在 `unknown` | SMTP 在 DATA 階段斷線、逾時，或最終回應無法解析 | 不要重寄；請收件人確認；必要時請使用者提出新的要求 |
| 寄件備份資料夾沒有信 | `sentCopy` APPEND 失敗，或 `sentFolder` 名稱錯誤 | 檢查 `submissions.jsonl` 與 IMAP 資料夾名稱；郵件本身可能已送出 |
| 備份還原後摘要不符 | `.gitattributes` 或篩選器改寫了 `.eml`／附件位元組 | 移除轉換屬性與篩選器，重新備份；不要用一般文字模式處理證據檔 |
| 記憶維護沒有處理電子郵件使用者 | 工作區未被辨識，或平台未通過驗證 | 確認工作區路徑為 `data/workspaces/email/<owner>`，且平台已註冊 |

---

## 已知限制

- **單一信箱**：一個部署只設定一個機器人信箱。多信箱需要多個獨立部署。
- **單一行程**：同一個資料目錄不支援多個機器人行程同時寫入。
- **輪詢延遲**：回覆不是即時；預設最多約一個輪詢間隔加上工作階段處理時間。
- **沒有 OAuth**：目前只支援密碼或應用程式密碼。
- **DMARC 只到網域層級**：允許清單仍是必要的第二道檢查；同網域的其他地址不會自動獲得授權。
- **模型判斷仍有殘留風險**：目的地授權由主機產生與綁定，但模型對使用者指示的理解仍可能出錯。隔離的意圖解讀環境會提高 prompt injection 與工具濫用的成本，但不構成模型層級的授權證明。
- **沒有郵件編輯**：已寄出的郵件無法編輯；系統不會用再寄一封來模擬。
- **寄件備份不自動修補**：APPEND 失敗會被記錄，但沒有自動補寫流程。
- **舊信不重播**：首次啟用前的既有郵件不會被處理；UIDVALIDITY 變更也不會重播整個信箱。
- **隱私殘留**：`MemoryStore` 的格式錯誤行片段可能出現在其日誌中，如上一節所述。
- **備份即明文**：備份儲存庫包含私人通信；停用備份會失去唯一持久副本。

## 私有憑證授權單位與 Proton Mail Bridge

`platforms.email.tlsCa`（對應環境變數 `EMAIL_TLS_CA`）接受純文字的 PEM 憑證組合字串，供 Proton Mail Bridge 等私有郵件伺服器建立受信任連線。此欄位空白或未設定時，系統保留預設的執行環境根憑證；一旦設定，該組合將**取代**所有電子郵件連線的信任根，包含接收端 IMAP、寄信端 SMTP 與獨立的寄件備份 IMAP 連線。若 IMAP 與 SMTP 分別由不同授權單位簽發，該 PEM 內容必須包含雙方的簽發者憑證。憑證驗證、主機名稱核對與最低 TLSv1.2 門檻依然持續啟用，不會放寬安全限制。

請直接提供公開的 PEM 憑證內容，不可填入檔案路徑，也絕不能包含 TLS 私密金鑰。在 Helm 環境中，可透過現有的 `extraEnv` 設定，以 `secretKeyRef` 參照 TLS 密鑰的 `tls.crt` 鍵值，不需要額外掛載磁區。密鑰內容變更後，必須重啟機器人容器以載入新的環境變數。

Proton Mail Bridge 必須搭配付費方案、持久化憑證存放區與互動式帳號登入。請一律使用 Bridge 產生的專用應用程式帳密，不要使用 Proton 帳號的登入密碼。跨 Pod 通信時，`127.0.0.1` 代表各 Pod 自身的本機介面，因此連線目標應指向內部 Service，且該 Service 主機名稱必須列於 Bridge 憑證的主題備用名稱（SAN）中。轉發 Bridge 內部連接埠的 TCP 代理也必須完整保留兩端的 STARTTLS 交握。將對應的憑證與私密金鑰匯入 Bridge 後需重啟 Bridge 服務；日後輪替憑證時，也必須重新匯入 Bridge，並重啟機器人以完成更新。

Bridge 或本 CA 設定均無法證明 Proton 接收郵件伺服器的標頭處理行為。在決定 `EMAIL_AUTHSERV_ID` 或將 `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED` 設為 `true` 之前，請務必透過 Bridge 的 IMAP 介面檢視收到的原始信件標頭，並完成前述的偽造 `Authentication-Results` 標頭剝除測試。若 Proton 伺服器未提供受信任且對齊的 DMARC 結果，請維持電子郵件停用狀態，切勿略過身分驗證或關閉 TLS 驗證。
