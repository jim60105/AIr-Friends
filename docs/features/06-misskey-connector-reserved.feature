# language: zh-TW
功能: Misskey 平台整合

  背景:
    假設 Misskey 平台支援 REST API 與 WebSocket 串流
    而且 Misskey 以 access token 參數 i 進行認證
    而且 WebSocket 連線會在 URL 中帶上 i 參數
    而且系統已完整實作 Misskey 平台支援

  情境: Misskey Adapter 的基本功能
    當系統新增 Misskey 平台 Adapter
    那麼 Adapter 必須能提供 platform="misskey"
    而且能輸出正規化事件模型(包含 is_dm 與 channel_id)
    而且能實作 send_reply 能力以回覆提及或私訊

  情境: Misskey 即時事件接入
    當 Misskey Adapter 接收到即時事件
    那麼系統必須能將其轉為統一事件並觸發相同的回覆流程
    而且系統透過 WebSocket 串流承接 mention/reply/私訊事件

  情境: Misskey 回覆串接功能
    假設使用者在一則貼文中提及機器人
    當系統處理此事件並產生回覆
    那麼回覆必須以「回覆至原貼文」的方式發送
    而且回覆會使用原貼文的 noteId 作為 replyId
    而且可見度設定會繼承原貼文的設定

  情境: Misskey 新貼文功能
    假設系統需要發送訊息但沒有原始觸發貼文
    當系統處理排程觸發或其他無來源的事件
    那麼系統必須建立新貼文而非回覆
    而且新貼文不帶 replyId 參數

  情境: Misskey 使用者名稱格式
    假設系統需要取得最近訊息作為對話上下文
    當系統取得 Misskey 的貼文
    那麼使用者名稱必須格式為「@顯示名稱 (userId)」
    而且此格式能讓對話中的使用者身份更加明確
