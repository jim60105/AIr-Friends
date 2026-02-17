# language: zh-TW
功能: 提示詞模板系統——使用 Vento 模板引擎渲染提示詞

  背景:
    假設 Bot 使用 Vento 模板引擎處理提示詞
    而且 prompts 目錄下存在 system_reply.md 作為主模板
    而且 system_reply.md 使用 Vento 語法（include、if、變數插值等）

  情境: 使用 include 載入片段檔案
    假設 prompts/system_reply.md 包含 include "./character_name.md" 指令
    而且 prompts/character_name.md 的內容為 "蘭堂悠奈 (Randou Yuna)"
    當系統載入並渲染系統提示詞
    那麼 include 指令必須被替換為 character_name.md 的內容

  情境: 使用 set 載入片段並重複使用
    假設 prompts/system_reply.md 使用 set 將 character_name.md 的內容存為變數
    而且模板中多次使用該變數
    當系統載入並渲染系統提示詞
    那麼所有變數引用都被替換為相同的片段內容

  情境: 條件式渲染——DM 模式
    假設 prompts/system_reply.md 包含 isDm 條件判斷區塊
    當系統以 isDm=true 渲染提示詞
    那麼輸出包含 DM 專用內容
    當系統以 isDm=false 渲染提示詞
    那麼輸出不包含 DM 專用內容

  情境: 平台變數注入
    假設 prompts/system_reply.md 引用 platform 變數
    當系統以 platform="discord" 渲染提示詞
    那麼輸出包含 "discord" 對應的平台內容

  情境: 模板變數由系統注入
    假設系統提供以下模板變數
      | 變數名稱    | 說明                         |
      | isDm        | 是否為私訊對話               |
      | platform    | 平台名稱（discord / misskey）|
      | userId      | 使用者 ID                    |
      | channelId   | 頻道 ID                      |
      | guildId     | 伺服器 ID（無則為空字串）    |
      | sessionId   | Skill API 的 session ID      |
    當系統渲染提示詞
    那麼所有變數可在模板中以 {{ variableName }} 語法使用

  情境: include 檔案不存在時拋出錯誤
    假設 prompts/system_reply.md include 一個不存在的檔案 "./missing.md"
    當系統載入並渲染系統提示詞
    那麼系統拋出錯誤
    而且錯誤訊息包含檔案名稱

  情境: 片段檔案中支援 Vento 語法
    假設某片段檔案包含條件判斷語法
    而且 prompts/system_reply.md 使用 include 引入該片段
    當系統以特定變數值渲染提示詞
    那麼片段中的條件語法被正確處理

  情境: JavaScript 表達式支援
    假設 prompts/system_reply.md 包含 JavaScript 表達式
    當系統渲染提示詞
    那麼表達式被正確求值並輸出結果

  情境: 渲染後的最終結果去除首尾空白
    假設系統成功渲染提示詞
    那麼渲染結果的首尾空白必須被去除

  情境: Spontaneous Post 提示詞使用 Vento 模板渲染
    假設 prompts/system_spontaneous.md 使用 Vento 語法
    而且模板包含 recentMessagesFetched、importantMemories、recentMessages、availableEmojis 等變數
    當系統以 recentMessagesFetched=true 渲染提示詞
    那麼輸出包含「reference recent conversation topics」指示
    當系統以 recentMessagesFetched=false 渲染提示詞
    那麼輸出包含「Create something entirely original」指示

  情境: 一般訊息回覆提示詞使用 Vento 模板渲染
    假設 prompts/system_reply.md 包含 userContextMessage 條件區塊
    而且模板包含 userContextMessage 變數
    當系統以 sessionId 渲染提示詞
    那麼輸出包含 Session Information 區塊
    而且輸出包含 Instructions 區塊

  情境: sessionId 不依賴 userContextMessage 條件
    假設 prompts/system_reply.md 包含 sessionId 條件區塊
    當系統以 sessionId 渲染提示詞但未提供 userContextMessage
    那麼輸出仍包含 Session Information 區塊
    而且輸出不包含 Instructions 區塊
