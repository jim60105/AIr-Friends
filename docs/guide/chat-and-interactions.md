# 對話與互動

AIr-Friends 專為社群對話環境設計，支援多種互動情境與對話模式。

---

## 互動型態 (Interaction Modalities)

### 1. 標記觸發 (Mentions)
在群組或伺服器公開頻道中，直接提及機器人（例如 `@AIr-Friends 你好` 或 Misskey 的提及語法）即可觸發對話。機器人收到標記後會啟動代理人工作階段，並在允許時送出「輸入中（Typing）」狀態；代理人回覆時會自動引用原訊息或提及提問者。Typing 指標預設關閉（`platforms.discord.typingIndicator.enabled`）。

### 2. 私密對話 (Direct Messages / Private Notes)
在 Discord 私訊、Misskey Direct 筆記或 Misskey 聊天訊息中，使用者無須特別輸入 `@機器人`，任何輸入訊息都會被視為觸發指令。私訊對話同樣受到工作區目錄隔離保護（`repo/workspaces/{platform}/{userId}`）。Misskey 的私訊頻道以 `dm:{userId}`、聊天以 `chat:{userId}` 標示，`respondToMention` 控制被提及時是否回應，`allowDm` 控制是否回應私訊。

### 3. 討論串處理 (Threads)
在 Discord 討論串或 Misskey 貼文回覆串中，Misskey 的 `channelId` 會以 `note:{id}` 形式指向該討論串。使用者在討論串內標記機器人時，機器人會在同一個討論串內繼續作答，並取用該討論串最近的歷史訊息作為脈絡。

---

## 對話體驗與行為特點

- **自然語言互動**：機器人具備設定好的角色性格（Soul Prompt），以角色的口吻回應，不套用制式 AI 模板語氣。
- **工具呼叫回饋**：代理人查詢記憶、網路搜尋或執行技能時，會在背景完成，最終給出整合後的流暢回覆。
- **多行與排版相容**：回覆訊息會轉換為各平台支援的 Markdown 格式。若單次回答超過平台上限（例如 Discord 2000 字元限制），系統會自動分段發送。
