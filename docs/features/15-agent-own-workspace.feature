Feature: Agent 專屬全域工作區
  作為 AI Agent
  我想要有一個跨對話、跨使用者的全域工作區
  以便持久保存我的知識筆記和研究結論

  Background:
    Given Agent 工作區路徑為 "{workspace.repoPath}/agent-workspace/"
    And 環境變數 AGENT_WORKSPACE 指向該路徑

  Scenario: 工作區初始化
    When 系統首次建立 Agent 工作區
    Then 目錄結構包含 notes/ 和 journal/ 子目錄
    And notes/_index.md 被初始化
    And README.md 被初始化

  Scenario: Agent 透過 bash 讀寫工作區
    Given Agent 已連線並取得 session
    When Agent 透過 bash 執行 "cat $AGENT_WORKSPACE/notes/_index.md"
    Then Agent 可成功讀取檔案內容

  Scenario: memory-search 包含工作區搜尋結果
    Given Agent 工作區中有筆記 "notes/cooking.md" 包含 "pasta recipe"
    When Agent 使用 memory-search 搜尋 "pasta"
    Then 搜尋結果包含 agentNotes 區段
    And agentNotes 中包含 "notes/cooking.md" 的匹配

  Scenario: 工作區內容不預載入 system prompt
    When 系統組裝對話上下文
    Then Agent 工作區的檔案內容不包含在初始上下文中
    And system prompt 包含工作區使用引導

  Scenario: 路徑安全邊界
    When Agent 嘗試讀取工作區外的檔案
    Then 操作被拒絕

  Scenario: 使用者隱私分離
    Given 系統引導 Agent 將使用者隱私資料使用 memory-save
    Then Agent 工作區中不應包含使用者個人隱私資訊

  Scenario: 工作區為冪等操作
    When getOrCreateAgentWorkspace 被重複呼叫
    Then 已存在的檔案不會被覆蓋
    And 目錄結構保持不變
