# language: zh-TW
功能: 以本地 local repo + working directory 作為 Agent 信任邊界

  背景:
    假設系統在本地建立一個資料夾作為 Copilot CLI 的 local repo
    而且 local repo 下存在多個 working directory
    而且 Copilot SDK/ACP Agent 僅信任當前 working directory 可存取的檔案範圍
    而且系統以 working directory 區分不同互動情境的記憶讀取權限

  情境: 以 (平台, user_id) 決定 working directory
    當 Bot 在某平台收到一則與 Bot 互動的訊息
    那麼系統必須計算 workspace_key = "{platform}/{user_id}"
    而且必須確保 working directory 路徑為 "repo/workspaces/{workspace_key}/"
    而且此路徑不可與其他 workspace_key 共用
    而且同一使用者在不同 channel 的互動都共用同一個 workspace

  情境: 每次觸發皆建立新的 Agent session 且使用該 working directory 當 cwd
    當 Bot 被觸發開始一次回覆流程
    那麼系統必須建立新的 Agent session
    而且啟動 session 時必須把 cwd 設為該次互動對應的 working directory
    而且該 session 不得復用先前 session 的內部對話狀態

  情境: 同時處理多個對話時，工作目錄不可互相讀取
    假設 Bot 同時在兩個不同 workspace_key 收到互動訊息
    當兩個回覆流程同時進行
    那麼每個流程只能讀取自己的 working directory 內的檔案
    而且任何跨工作目錄的檔案讀取都必須被拒絕或視為錯誤
