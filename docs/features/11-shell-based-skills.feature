# language: zh-TW
功能: Shell 執行模式的 Skills 系統重構

  背景:
    假設 外部 ACP Agent（GitHub Copilot CLI、Gemini CLI）需要呼叫我們的 Skills
    而且 Discord/Misskey 客戶端是 Singleton，無法從第二執行緒發送訊息
    而且 我們需要讓 Agent 透過 Shell 執行來呼叫 Skills

  情境: Agent 透過 Shell 執行 Skill 腳本
    當 Agent 需要呼叫 send-reply skill
    那麼 Agent 會執行 `deno run skills/send-reply/skill.ts --session-id=abc123 --message="Hello"`
    而且 該腳本會透過 HTTP 呼叫主程式的 Skill API 端點
    而且 主程式會根據 session-id 找到對應的 Discord/Misskey channel
    而且 主程式透過 Singleton 客戶端發送訊息

  情境: Session ID 識別對話上下文
    假設 使用者從 Discord 發送訊息觸發一次對話
    當 系統建立新的 Agent Session 時
    那麼 系統會產生一個唯一的 session-id
    而且 將 session-id、platform、channel_id、user_id 等資訊註冊到 Session Registry
    而且 Agent 會在 working directory 中讀取到這個 session-id
    而且 Skill 腳本使用這個 session-id 來識別要回覆的頻道

  情境: Skill 腳本透過 HTTP API 與主程式溝通
    假設 主程式啟動了 Skill API HTTP Server
    當 Skill 腳本需要執行操作時
    那麼 腳本會發送 HTTP POST 請求到 localhost:PORT/api/skill/{skill-name}
    而且 請求 body 包含 session-id 和 skill 參數
    而且 主程式驗證 session-id 的有效性
    而且 主程式執行對應的 skill handler
    而且 返回執行結果給腳本

  情境: 記憶體操作透過 Skill 腳本執行
    當 Agent 需要儲存記憶時
    那麼 Agent 執行 `deno run skills/memory-save/skill.ts --session-id=abc --content="..." --importance=high`
    而且 腳本呼叫主程式 API `/api/skill/memory-save`
    而且 主程式透過 MemoryStore 寫入記憶
    而且 返回新建立的 memory-id

  情境: 搜尋記憶透過 Skill 腳本執行
    當 Agent 需要搜尋記憶時
    那麼 Agent 執行 `deno run skills/memory-search/skill.ts --session-id=abc --query="..."`
    而且 腳本呼叫主程式 API `/api/skill/memory-search`
    而且 主程式透過 MemoryStore 搜尋記憶
    而且 返回符合的記憶列表（JSON 格式）

  情境: 單次回覆限制仍然生效
    假設 Agent 已經呼叫過一次 send-reply
    當 Agent 再次嘗試呼叫 send-reply
    那麼 Skill API 會檢查 session 狀態
    而且 發現已經發送過回覆
    而且 返回錯誤訊息拒絕第二次回覆

  情境: Session 過期處理
    假設 一個 session 已經超過設定的 timeout 時間
    當 Skill 腳本嘗試使用該 session-id 呼叫 API
    那麼 主程式會返回 session 已過期或不存在的錯誤
    而且 腳本會輸出錯誤訊息給 Agent

  規則: SKILL.md 必須描述 Shell 執行方式
    - SKILL.md 必須說明 skill 腳本的路徑
    - SKILL.md 必須說明所有必要的命令列參數
    - SKILL.md 必須說明 stdout 輸出格式（JSON）
    - SKILL.md 必須說明錯誤處理方式（非零 exit code + stderr）

  規則: Skill API 必須安全
    - 只監聽 localhost，不對外暴露
    - Session ID 應該是難以猜測的隨機字串
    - 應該驗證所有輸入參數
    - 應該限制請求頻率（rate limiting）

  規則: 向後相容
    - 保留原有的 ACP Skill Handler 介面
    - Skill API 內部呼叫相同的 handler 實作
    - 測試應該覆蓋兩種呼叫方式
