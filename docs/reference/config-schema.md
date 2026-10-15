# 組態參數辭典

本文件提供 AIr-Friends 的完整組態參數清單與對應的環境變數對照表。

---

## 完整組態參數對照表

| YAML 欄位路徑 | 環境變數名稱 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `platforms.discord.enabled` | `DISCORD_ENABLED` | `false` | 是否啟用 Discord 平台 |
| `platforms.discord.token` | `DISCORD_TOKEN` | `""` | Discord Bot Token |
| `platforms.discord.applicationId` | `DISCORD_CLIENT_ID` | `""` | Discord Application ID |
| `platforms.misskey.enabled` | `MISSKEY_ENABLED` | `false` | 是否啟用 Misskey 平台 |
| `platforms.misskey.host` | `MISSKEY_HOST` | `""` | Misskey 執行個體主機網址 |
| `platforms.misskey.token` | `MISSKEY_TOKEN` | `""` | Misskey 存取權杖 |
| `agent.type` | `AGENT_TYPE` | `"opencode"` | 代理人引擎類型 (`opencode` 或 `omp`) |
| `agent.defaultModel` | `AGENT_DEFAULT_MODEL`| `"anthropic/claude-3-7-sonnet"` | 預設主要大型語言模型 |
| `agent.fallbackModel` | `AGENT_FALLBACK_MODEL`| `""` | 供應商異常時的備用模型 |
| `agent.thoughtLevel` | `AGENT_THOUGHT_LEVEL`| `"medium"` | 預設思考強度 (`off`, `low`, `medium`, `high`) |
| `agent.skillsDir` | `AGENT_SKILLS_DIR` | `"skills"` | 受信任的技能根目錄 |
| `agent.yolo` | `AGENT_YOLO` | `false` | 全域自動核准模式 |
| `rateLimit.enabled` | `RATE_LIMIT_ENABLED` | `true` | 是否啟用頻率限制 |
| `rateLimit.windowMs` | `RATE_LIMIT_WINDOW_MS`| `60000` | 滑動視窗時間（毫秒） |
| `rateLimit.maxRequests` | `RATE_LIMIT_MAX_REQUESTS`| `5` | 單一視窗最大請求數 |
| `rateLimit.cooldownMs` | `RATE_LIMIT_COOLDOWN_MS`| `30000` | 超標冷卻懲罰時間（毫秒） |
| `dashboard.enabled` | `DASHBOARD_ENABLED` | `true` | 是否啟用 Web 儀表板 |
| `dashboard.port` | `DASHBOARD_PORT` | `8090` | 儀表板 HTTP 連接埠 |
| `dashboard.bindAddress` | `DASHBOARD_BIND_ADDRESS`| `"127.0.0.1"` | 儀表板綁定網路位址 |
| `dashboard.passphrase` | `DASHBOARD_PASSPHRASE`| `""` | 儀表板登入密碼（長度至少 16 字元） |
| `gitBackup.enabled` | `GIT_BACKUP_ENABLED` | `false` | 是否啟用 Git 自動備份 |
| `gitBackup.remoteUrl` | `GIT_BACKUP_REMOTE_URL`| `""` | 遠端 Git 儲存庫 URL |
