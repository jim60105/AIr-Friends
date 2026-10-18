# AIr-Friends 文件首頁

![AIr-Friends](hero.avif)

歡迎來到 **AIr-Friends** 官方說明文件！

AIr-Friends 是一套專為社群對話打造的多平台對話式 AI 機器人系統。有別於傳統將所有推論邏輯寫死在單一應用程式的架構，AIr-Friends 扮演 **ACP（Agent Client Protocol，代理人客戶端協定）客戶端** 的角色，將推理與工具執行委託給外部 ACP 代理人引擎（例如 OpenCode CLI 或 Oh-My-Pi），並由機器人本體維護隔離的使用者工作區與跨對話持久化記憶。

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

推理由外部 ACP 行程專職執行，機器人本體負責平台連線、訊息審查、權限檢查與記憶管理。每個使用者擁有獨立的目錄空間（`repo/workspaces/{platform}/{userId}`），ACP 回呼層嚴防跨工作區存取。記憶檢索採純文字語彙評分，以 BM25（`src/core/memory-recall/ranker.ts`）搭配 jieba 分詞（`@node-rs/jieba`）為記憶排序，並由背景工作階段定期整併，無須架設或維護向量資料庫。維運方面內建 Web 管理儀表板、Prometheus 指標、JSONL 稽核日誌與 GELF 日誌傳輸。

---

## 讀者導讀路徑

依照你的角色與需求，可以選擇下列路徑快速探索文件。

### 一般終端使用者 (End-User)

想了解如何與 AIr-Friends 互動、記憶功能如何運作，或想設定提醒時，先讀 [對話與互動](guide/chat-and-interactions.md) 認識標記（Mention）、私訊（DM）與討論串三種對話模式，再看 [對話脈絡與重設](guide/context-and-reset.md) 學會以 `/clear` 指令清除對話脈絡。[記憶機制與體驗](guide/memory-experience.md) 說明機器人自動記住互動內容與偏好的方式，[定時提醒功能](guide/reminders.md) 則示範如何用自然語言建立定時提醒。若你透過電子郵件與機器人往來，[電子郵件對話](guide/email.md) 說明討論串、附件、第三方寄信與轉寄的使用方式。

### 系統維運者與管理員 (Operator / Administrator)

部署與維護從 [快速開始](getting-started/quickstart.md) 的 Podman Compose 啟動著手，並在 [支援平台](getting-started/platforms.md) 與 [模型與金鑰設定](getting-started/models-and-keys.md) 完成 Discord、Misskey、電子郵件與 LLM 供應商的設定。[組態設定載入](admin/configuration.md)、[部署模式指引](admin/deployment-modes.md) 交代容器化、systemd 與環境變數的載入方式，[回覆政策控制](admin/reply-policy.md) 與 [頻率限制防護](admin/rate-limiting.md) 負責控制機器人的發言範圍與濫用防護。電子郵件平台的允許清單、TLS、MTA 標頭剝除驗證、資料落地與複核程序見 [電子郵件平台部署與維運](admin/email-platform.md)。[ACP 引擎整合](agent/acp-engine.md) 與 [沙盒與安全界線](agent/security-and-sandbox.md) 說明兩種代理人引擎的組態與安全界限，[Web 儀表板](operations/dashboard.md)、[指標與健康檢查](operations/metrics-and-health.md) 與 [對話稽核日誌](operations/audit-logs.md) 則是日常監控工具。

### 開發者與擴充者 (Developer / Extender)

自訂提示詞、撰寫技能、串接新平台或參與專案開發前，先看 [角色設定概念](character/concepts.md)、[系統提示詞片段](character/fragments.md) 與 [範本引擎](character/template-engine.md) 了解角色提示詞與動態渲染樣式的組合方式。[內建技能目錄](extending/built-in-skills.md) 與 [自訂技能開發](extending/custom-skills.md) 說明安全檔案酬載契約與新技能腳本的開發流程，[平台介面介接](extending/platform-adapters.md) 與 [MCP 伺服器整合](extending/mcp-servers.md) 分別處理新社群平台與 Model Context Protocol 工具的擴充。[參與專案貢獻](extending/contributing.md) 列出程式碼風格、測試要求與貢獻流程。
