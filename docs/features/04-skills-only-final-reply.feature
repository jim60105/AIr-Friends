# language: zh-TW
功能: 對外平台只接收最終回覆，過程輸出留在內部

  背景:
    假設 Agent 在推理過程可能會多次呼叫工具、檢索、或上網
    而且使用者期望看到連貫且乾淨的對話體驗
    而且 Bot 不會轉發 Agent 的中間輸出到平台

  情境: 只有透過 send_reply skill 才能對外發言
    當 Agent 產生任何文字輸出
    那麼系統必須把這些輸出視為內部過程
    而且不得直接送到 Discord 或其他平台
    直到 Agent 呼叫 "platform.send_reply" skill
    那麼系統才會把該 skill 的 payload 送到對外平台

  情境: 一次互動最多只能對外送出一則最終回覆
    假設 Agent 在同一 run 中多次呼叫 "platform.send_reply"
    當第二次呼叫發生
    那麼系統必須拒絕該呼叫或視為錯誤
    而且不得造成平台端出現多則回覆

  情境: 工具與檢索結果僅注入當次 session
    當 Agent 呼叫 "platform.fetch_more_context" 或 "memory.search" 或 "web.search"
    那麼這些結果只能被加入當次 session 的上下文
    而且不得自動對外發送

  情境: Agent 完成但未回覆時觸發重試
    假設 使用者傳送一則訊息
    而且 Agent 完成 prompt turn 且 stopReason 為 "end_turn"
    而且 Agent 未透過 send-reply skill 發送回覆
    當 系統偵測到未回覆
    那麼 系統在同一 session 上發送重試 prompt
    而且 重試 prompt 包含 "send another send-reply"

  情境: 重試成功且回覆已發送
    假設 Agent 在第一次 prompt 未回覆
    當 系統發送重試 prompt
    而且 Agent 在重試期間呼叫 send-reply
    那麼 session 回應為成功且 replySent 為 true

  情境: 重試失敗且回傳錯誤
    假設 Agent 在第一次 prompt 未回覆
    當 系統發送重試 prompt
    而且 Agent 仍未呼叫 send-reply
    那麼 session 回應為失敗
    而且 錯誤訊息顯示 Agent 未產生回覆
