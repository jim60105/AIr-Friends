# AIr-Friends 文件首頁

歡迎來到 **AIr-Friends** 官方說明文件！

AIr-Friends 是一套專為社群對話打造的多平台對話式 AI 機器人系統。有別於傳統將所有推論邏輯寫死在單一應用程式的架構，AIr-Friends 扮演 **ACP（Agent Client Protocol，代理人客戶端協定）客戶端**的角色，將推理與工具執行委託給外部 ACP 代理人引擎（例如 OpenCode CLI 或 Oh-My-Pi），並由機器人本體維護隔離的使用者工作區與跨對話持久化記憶。

---

## 核心架構概覽

```text
┌─────────────────────────────────────────────────────────────┐
│                 AIr-Friends (ACP 客戶端)                    │
├─────────────────────────────────────────────────────────────┤
│  社群平台介面 (Discord / Misskey)                           │
│           ↓                                                 │
│  AgentCore → SessionOrchestrator                            │
│           ↓                                                 │
│  AgentConnector → ACP ClientSideConnection                  │
│           ↓ (產生子行程，stdio JSON-RPC 通訊)              │
├─────────────────────────────────────────────────────────────┤
│                    外部 ACP 代理人                          │
│  (OpenCode CLI / Oh-My-Pi OMP)                              │
│           ↓ (執行 shell 技能腳本)                           │
├─────────────────────────────────────────────────────────────┤
│  Shell 技能 (位於 skills/ 目錄中的 Deno 腳本)               │
│           ↓ (透過 HTTP 回呼)                                │
│  Skill API 伺服器 (HTTP 端點)                               │
│           ↓                                                 │
│  技能處理常式 (記憶存取、回覆發送、脈絡查詢)                │
│  記憶體儲存庫、工作區管理員                                 │
└─────────────────────────────────────────────────────────────┘
```

系統的核心特點如下。
- **平台與推理分離**：機器人負責平台連線、訊息審查、權限檢查與記憶管理，推理由外部 ACP 行程專職執行。
- **工作區邊界隔離**：每個使用者擁有獨立的目錄空間（`repo/workspaces/{platform}/{userId}`），在 ACP 回呼層嚴防跨工作區存取。
- **純文字語彙記憶檢索**：以 BM25 語彙評分（`src/core/memory-recall/ranker.ts`）搭配 jieba 分詞（`@node-rs/jieba`）為記憶排序，並由背景工作階段定期整併，無須架設或維護向量資料庫。
- **完整維運可觀測性**：內建 Web 管理儀表板、Prometheus 指標、完整 JSONL 稽核日誌與 GELF 日誌傳輸。

---

## 讀者導讀路徑

根據你的角色與需求，可選擇以下路徑快速探索文件。

### 1. 一般終端使用者 (End-User)
如果你想了解如何與 AIr-Friends 機器人互動、掌握記憶功能或設定提醒。
- 閱讀 [對話與互動](guide/chat-and-interactions.md)：認識標記（Mention）、私訊（DM）與討論串對話模式。
- 閱讀 [對話脈絡與重設](guide/context-and-reset.md)：學習如何使用 `/clear` 指令清除對話脈絡。
- 閱讀 [記憶機制與體驗](guide/memory-experience.md)：了解機器人如何自動記住互動內容與偏好。
- 閱讀 [定時提醒功能](guide/reminders.md)：使用自然語言建立定時提醒。

### 2. 系統維運者與管理員 (Operator / Administrator)
如果你負責在伺服器上部署、管理與維護 AIr-Friends 執行個體。
- 閱讀 [快速開始](getting-started/quickstart.md)：使用 Docker Compose 快速啟動服務。
- 閱讀 [支援平台](getting-started/platforms.md) 與 [模型與金鑰設定](getting-started/models-and-keys.md)：完成 Discord/Misskey 與 LLM 供應商設定。
- 閱讀 [組態設定載入](admin/configuration.md) 與 [部署模式指引](admin/deployment-modes.md)：深入掌握容器化、systemd 與環境變數設定。
- 閱讀 [回覆政策控制](admin/reply-policy.md) 與 [頻率限制防護](admin/rate-limiting.md)：保護伺服器不被濫用。
- 閱讀 [ACP 引擎整合](agent/acp-engine.md) 與 [沙盒與安全界線](agent/security-and-sandbox.md)：了解 OpenCode 與 OMP 引擎配置與安全性界限。
- 閱讀 [Web 儀表板](operations/dashboard.md)、[指標與健康檢查](operations/metrics-and-health.md) 與 [對話稽核日誌](operations/audit-logs.md)：掌握日常監控與維運工具。

### 3. 開發者與擴充者 (Developer / Extender)
如果你想自訂提示詞、撰寫自訂技能、串接新平台或參與專案開發。
- 閱讀 [角色設定概念](character/concepts.md)、[系統提示詞片段](character/fragments.md) 與 [範本引擎](character/template-engine.md)：自訂機器人的靈魂提示詞與動態渲染樣式。
- 閱讀 [內建技能目錄](extending/built-in-skills.md) 與 [自訂技能開發](extending/custom-skills.md)：開發符合安全檔案酬載契約的新技能腳本。
- 閱讀 [平台介面介接](extending/platform-adapters.md)：了解如何實作新的社群平台介面。
- 閱讀 [MCP 伺服器整合](extending/mcp-servers.md)：將標準 Model Context Protocol 工具掛載至代理人中。
- 閱讀 [參與專案貢獻](extending/contributing.md)：掌握專案的程式碼風格、測試要求與貢獻流程。
