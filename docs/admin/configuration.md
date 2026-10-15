# 組態設定載入

AIr-Friends 以階層式架構載入組態，支援 YAML 設定檔與環境變數覆寫。

---

## 載入順序與階層

系統啟動時，組態載入模組（`src/core/config-loader.ts`）依序執行以下步驟。

1. **內建預設值（Built-in Defaults）**：程式碼中定義的基底預設值，例如 `DEFAULT_CONFIG`、`DEFAULT_RATE_LIMIT`、`DEFAULT_DASHBOARD`。
2. **YAML 組態檔案**：預設讀取根目錄的 `config.yaml`；提供 `--config <路徑>` 參數時改讀指定檔案。
3. **環境變數覆寫**：`src/utils/env.ts` 的 `ENV_MAPPINGS` 定義了環境變數與組態路徑的對應表。
   - YAML 內容支援 `${ENV_VAR_NAME}` 語法，解析時代入作業系統環境變數或 `.env` 檔案中的值。
   - 部分欄位另有專屬環境變數可直接覆寫對應路徑，例如 `AGENT_MODEL`、`AGENT_DEFAULT_TYPE`、`REPLY_POLICY`、`LOG_LEVEL`。

---

## 核心組態區塊結構

一份典型的 `config.yaml` 結構如下。

```yaml
# 1. 聊天平台介面
platforms:
  discord:
    enabled: true
    token: "${DISCORD_TOKEN}"
    guildIds: []                # 空陣列 = 全部伺服器
    allowDm: true
    respondToMention: true
  misskey:
    enabled: false
    host: "${MISSKEY_HOST}"
    token: "${MISSKEY_TOKEN}"
    secure: true

# 2. ACP 代理人引擎
agent:
  model: "openrouter/deepseek/deepseek-v4-pro"
  defaultAgentType: "opencode"  # 引擎類型：opencode（預設）或 omp
  skillsDir: "skills"           # 受信任的技能腳本根目錄
  tokenLimit: 20000
  reasoningEffort: "default"

# 3. 頻道與回覆政策
replyPolicy: "channels"         # 全域模式：all、public、channels
channels:
  - id: "discord/channel/123456789"
    enabled: true
    yolo: false

# 4. 記憶系統設定
memory:
  recall:
    coreMaxTokens: 512
    workingMaxItems: 4
    fastRecallEnabled: true

# 5. 維運與管理儀表板
dashboard:
  enabled: true
  port: 8090
  host: "127.0.0.1"
  passphrase: "${DASHBOARD_PASSPHRASE}"
```

完整的設定參數與對應環境變數表，請參閱 [組態參數辭典](../reference/config-schema.md)。
