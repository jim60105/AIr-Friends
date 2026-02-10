# language: zh-TW
功能: 多平台擴充的抽象層與一致的對話模型

  背景:
    假設目前 Bot 主要運行於 Discord
    而且未來預計再串接 Misskey
    而且還可能擴充到其他平台
    而且現階段需求是保留擴充彈性，不要求完成所有平台實作

  情境: 平台事件模型必須抽象化
    當 Bot 從任一平台收到互動事件
    那麼系統必須將事件正規化為統一格式
    而且格式至少包含
      | 欄位 | 說明 |
      | platform | 平台識別 |
      | channel_id | 對話所在的頻道/聊天室識別 |
      | user_id | 發話者識別 |
      | message_id | 原始訊息識別 |
      | is_dm | 是否為私訊情境 |
      | guild_id | 若平台有群組/伺服器概念則提供，否則為空 |

  情境: 平台能力介面必須一致
    當系統要支援一個新平台
    那麼該平台 Adapter 必須提供至少下列能力
      | 能力 | 說明 |
      | fetch_recent_messages | 取得某對話的近期訊息 |
      | search_messages | 以關鍵字搜尋關聯訊息 |
      | send_reply | 送出回覆到平台 |
    而且這些能力必須以 skill 的方式提供給 Agent 呼叫
    而且 skill 介面不得綁死 Discord 專用術語

  情境: Misskey - 忽略來自 bot 帳號的 Note
    假設 Misskey adapter 已連線
    當 收到一則 mention note，其 user.isBot 為 true
    那麼 shouldRespondToNote 回傳 false，不觸發 agent

  情境: Misskey - 忽略來自 bot 帳號的 Chat 訊息
    假設 Misskey adapter 已連線
    當 收到一則 chat message，其 fromUser.isBot 為 true
    那麼 shouldRespondToChatMessage 回傳 false，不觸發 agent

  情境: Misskey - Recent Messages 正確標記其他 Bot 訊息
    當 收到一則來自其他 bot 帳號的 note（user.isBot 為 true）
    那麼 noteToPlatformMessage 的 PlatformMessage.isBot 為 true
    而且在對話歷史中該訊息顯示 [Bot] 前綴

  情境: 工作目錄命名需包含 platform 以避免跨平台混用記憶
    當 Bot 在不同平台收到互動事件
    那麼系統必須把 platform 納入 workspace_key 的組成
    而且不同 platform 不得共用同一個 working directory
