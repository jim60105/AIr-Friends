Feature: 訊息編輯與更正（Reply Edit / Correction）
  允許 Agent 在同一 session 內編輯已送出的回覆，
  以便修正錯誤或更新資訊，避免發送新訊息污染頻道。

  Background:
    Given 系統已啟動且 Skill API Server 運行中
    And 存在一個活躍的 session

  Scenario: Agent 成功編輯已送出的回覆
    Given Agent 已透過 send-reply 送出回覆並取得 messageId
    When Agent 呼叫 edit-reply skill 帶有有效的 messageId 和新內容
    Then 平台上的原始訊息被更新為新內容
    And edit-reply 返回 success: true 和 messageId

  Scenario: 嘗試在未送出回覆前編輯
    Given Agent 尚未在此 session 內送出任何回覆
    When Agent 呼叫 edit-reply skill
    Then 返回 success: false
    And 錯誤訊息為 "No reply has been sent yet. Use send-reply first."

  Scenario: 缺少必要參數
    Given Agent 已透過 send-reply 送出回覆
    When Agent 呼叫 edit-reply skill 但缺少 messageId 或 message 參數
    Then 返回 success: false
    And 錯誤訊息指出缺少的參數

  Scenario: 平台 API 編輯失敗
    Given Agent 已透過 send-reply 送出回覆
    When Agent 呼叫 edit-reply 但平台返回錯誤（如訊息已被刪除）
    Then 返回 success: false
    And 錯誤訊息包含平台錯誤詳情

  Scenario: 在同一 session 內多次編輯
    Given Agent 已透過 send-reply 送出回覆
    When Agent 連續呼叫 edit-reply 兩次
    Then 兩次呼叫都成功
    And 平台訊息內容為最後一次編輯的內容

  Scenario: Discord 平台訊息編輯
    Given 平台為 Discord
    And Agent 已送出回覆
    When Agent 呼叫 edit-reply
    Then 系統透過 Discord API Message.edit() 更新訊息

  Scenario: Misskey Note 編輯
    Given 平台為 Misskey 且 channelId 為 note: 格式
    And Agent 已送出回覆
    When Agent 呼叫 edit-reply
    Then 系統透過 Misskey notes/update API 更新貼文

  Scenario: Misskey Chat 訊息編輯
    Given 平台為 Misskey 且 channelId 為 chat: 格式
    And Agent 已送出回覆
    When Agent 呼叫 edit-reply
    Then 系統透過 Misskey chat/messages/update API 更新聊天訊息
