# 組態參數辭典

本文件提供 AIr-Friends 的完整組態參數清單與對應的環境變數對照表（定義於 `src/types/config.ts`）。

---

## 核心組態欄位與環境變數

| YAML 欄位路徑 | 環境變數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `platforms.discord.enabled` | `DISCORD_ENABLED` | `false` | 是否啟用 Discord 平台 |
| `platforms.discord.token` | `DISCORD_TOKEN` | `""` | Discord Bot Token |
| `platforms.discord.applicationId` | `DISCORD_CLIENT_ID` | `""` | Discord Application ID |
| `platforms.discord.spontaneousPost.enabled` | `DISCORD_SPONTANEOUS_ENABLED` | `false` | 是否啟用 Discord 自發貼文 |
| `platforms.discord.channelLurk.enabled` | `DISCORD_CHANNEL_LURK_ENABLED` | `false` | 是否啟用 Discord 頻道潛水回覆 |
| `platforms.misskey.enabled` | `MISSKEY_ENABLED` | `false` | 是否啟用 Misskey 平台 |
| `platforms.misskey.host` | `MISSKEY_HOST` | `""` | Misskey 實例主機網址 |
| `platforms.misskey.token` | `MISSKEY_TOKEN` | `""` | Misskey 存取權杖 |
| `platforms.misskey.spontaneousPost.enabled` | `MISSKEY_SPONTANEOUS_ENABLED` | `false` | 是否啟用 Misskey 自發貼文 |
| `agent.model` | `AGENT_MODEL` | `"openrouter/anthropic/claude-3.7-sonnet"` | 預設主要大型語言模型 |
| `agent.defaultAgentType` | `AGENT_DEFAULT_TYPE` | `"opencode"` | 代理人引擎類型 (`opencode` 或 `omp`) |
| `agent.reasoningEffort` | `AGENT_REASONING_EFFORT` | `"default"` | 推理思考強度 (`default`, `off`, `low`, `medium`, `high`, `xhigh`, `max`) |
| `agent.skillsDir` | `AGENT_SKILLS_DIR` | `"skills"` | 受信任的技能根目錄 |
| `agent.tokenLimit` | `AGENT_TOKEN_LIMIT` | `32000` | 對話脈絡 Token 上限 |
| `agent.openRouterApiKey` | `OPENROUTER_API_KEY` | `""` | OpenRouter API 金鑰 |
| `agent.geminiApiKey` | `GEMINI_API_KEY` | `""` | Google Gemini API 金鑰 |
| `agent.opencodeApiKey` | `OPENCODE_API_KEY` | `""` | OpenCode CLI API 金鑰 |
| `agent.sandbox.filesystemConfinement` | `SANDBOX_FILESYSTEM_CONFINEMENT` | `false` | 是否啟用 bwrap 檔案系統隔離（需要環境支援，失敗時嚴格中斷啟動） |
| `replyPolicy` | `REPLY_POLICY` | `"channels"` | 全域回覆政策模式 (`all`, `public`, `channels`) |
| `channels` | `CHANNELS` | `[]` | 頻道與帳號存取控制清單（JSON 陣列字串） |
| `rateLimit.enabled` | `RATE_LIMIT_ENABLED` | `false` | 是否啟用頻率限制 |
| `rateLimit.maxRequestsPerWindow` | `RATE_LIMIT_MAX_REQUESTS_PER_WINDOW` | `10` | 單一視窗每使用者最大請求數 |
| `rateLimit.windowMs` | `RATE_LIMIT_WINDOW_MS` | `600000` | 滑動視窗時間（毫秒，預設 10 分鐘） |
| `rateLimit.cooldownMs` | `RATE_LIMIT_COOLDOWN_MS` | `600000` | 超標冷卻懲罰時間（毫秒，預設 10 分鐘） |
| `dashboard.enabled` | `DASHBOARD_ENABLED` | `false` | 是否啟用 Web 儀表板 |
| `dashboard.port` | `DASHBOARD_PORT` | `8090` | 儀表板 HTTP 連接埠 |
| `dashboard.host` | `DASHBOARD_HOST` | `"127.0.0.1"` | 儀表板綁定網路位址 |
| `dashboard.passphrase` | `DASHBOARD_PASSPHRASE` | `""` | 儀表板登入密碼（啟用時至少須 16 字元） |
| `dashboard.behindHttpsProxy` | `DASHBOARD_BEHIND_HTTPS_PROXY` | `false` | 是否在反向代理後方（為 Cookie 加上 Secure 標記） |
| `memory.recentMessageLimit` | `MEMORY_RECENT_MESSAGE_LIMIT` | `20` | 對話脈絡包含的近期訊息則數 |
| `memory.workingTierLimit` | `MEMORY_WORKING_TIER_LIMIT` | `20` | 工作層記憶載入上限 |
| `memory.channelWritePolicy` | `MEMORY_CHANNEL_WRITE_POLICY` | `"sessions"` | 頻道記憶寫入政策 (`sessions` 或 `curated`) |
| `memory.recall.fastRecallEnabled`| `MEMORY_FAST_RECALL_ENABLED` | `true` | 是否啟用快速回想檢索 |
| `selfResearch.enabled` | `SELF_RESEARCH_ENABLED` | `false` | 是否啟用自主研究功能 |
| `selfResearch.model` | `SELF_RESEARCH_MODEL` | `"gpt-5-mini"` | 自主研究所需之專屬模型 |
| `memoryMaintenance.enabled` | `MEMORY_MAINTENANCE_ENABLED` | `false` | 是否啟用背景記憶維護與整併 |
| `reminders.enabled` | `REMINDERS_ENABLED` | `false` | 是否啟用定時提醒功能 |
| `gitBackup.enabled` | `GIT_BACKUP_ENABLED` | `false` | 是否啟用 Git 自動備份 |
| `gitBackup.remoteUrl` | `GIT_BACKUP_REMOTE_URL` | `""` | 遠端 Git 儲存庫 URL (HTTPS) |
| `audit.enabled` | `AUDIT_ENABLED` | `false` | 是否啟用對話歷程 JSONL 稽核日誌 |
| `audit.retentionDays` | `AUDIT_RETENTION_DAYS` | `7` | 稽核日誌保留天數 |
| `metrics.enabled` | `METRICS_ENABLED` | `false` | 是否啟用 Prometheus `/metrics` 端點 |
| `metrics.path` | `METRICS_PATH` | `"/metrics"` | Prometheus 度量指標端點路徑 |
| `health.enabled` | `HEALTH_ENABLED` | `true` | 是否啟用 HTTP 健康檢查探針端點 |
| `health.port` | `HEALTH_PORT` | `8080` | 健康檢查 HTTP 連接埠 |
| `logging.level` | `LOG_LEVEL` | `"INFO"` | 系統日誌等級 (`DEBUG`, `INFO`, `WARN`, `ERROR`) |
