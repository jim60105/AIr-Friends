# 組態設定載入

AIr-Friends 以階層式架構載入組態，支援 YAML 設定檔與環境變數覆寫。

---

## 載入順序與階層

系統啟動時，組態載入模組（`src/core/config-loader.ts`）依序疊合三層來源。最底層是程式碼中定義的內建預設值，例如 `DEFAULT_CONFIG`、`DEFAULT_RATE_LIMIT` 與 `DEFAULT_DASHBOARD`。其上為 YAML 組態檔案，預設讀取根目錄的 `config.yaml`，提供 `--config <路徑>` 參數時改讀指定檔案。最上層是環境變數覆寫，對應表定義於 `src/utils/env.ts` 的 `ENV_MAPPINGS`。YAML 內容中的 `${ENV_VAR_NAME}` 語法會在解析時代入作業系統環境變數或 `.env` 檔案的值，部分欄位另有專屬環境變數可直接覆寫對應路徑，例如 `AGENT_MODEL`、`AGENT_DEFAULT_TYPE`、`REPLY_POLICY` 與 `LOG_LEVEL`。

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

## 身分群組（identity groups）

選用的最上層設定 `identities` 用來宣告哪些平台帳號屬於同一個人。同一群組內的帳號在記憶回想時視為同一個記憶群體，但磁碟上的工作區不會合併、複製或連結，每個帳號仍保有自己的工作區與記憶檔案。

```yaml
identities:
  - id: "alice"                      # 營運者標籤，僅用於日誌與錯誤定位
    accounts:
      - "discord/123456789012345678"
      - "misskey/account/abcdef1234567890"
      - "alice@example.com"
```

`accounts` 接受下列形式，載入時一律正規化為 `{platform}/{userId}`：

- 工作區鍵：`discord/123456789012345678` 維持不變。
- 頻道式帳號 id：`misskey/account/abcdef1234567890` 收斂為 `misskey/abcdef1234567890`。
- 電子郵件地址：`alice@example.com`、`email/alice@example.com` 與 `email/account/alice@example.com` 皆轉為 `email/e_<sha256 十六進位>`。
- 電子郵件擁有者 id：`email/e_<64 位小寫十六進位>` 維持不變。

驗證採 fail-fast：格式錯誤、群組 `id` 空白或重複、未知平台、頻道或時間軸 id、不安全的 user id，以及同一帳號在同一群組內或跨群組重複出現，都會以 `ConfigError` 中止啟動。錯誤訊息只顯示欄位路徑（例如 `identities[0].accounts[1]`），不會輸出原始帳號或電子郵件地址。

也可用環境變數 `IDENTITIES` 覆寫，值為同一結構的 JSON 陣列：

```bash
IDENTITIES='[{"id":"alice","accounts":["discord/123","alice@example.com"]}]'
```

身分群組只在啟動時讀取一次，修改後必須重新啟動才會生效；系統不做任何身分推斷，群組完全由營運者宣告。帳號不需要出現在 `channels` 中也能被連結，回覆政策不受影響。

私人邊界：連結帳號的私人記憶僅在私訊（DM）工作階段中可被同群組的其他帳號回想；公開頻道的工作階段不會載入其他帳號的私人記憶。頻道記憶與其他使用者的記憶不受影響。

授權警告：連結帳號等於授權該群組的其他帳號讀取此帳號的記憶。請只連結你確認屬於同一個人、且你有權合併其記憶的帳號。

完整的設定參數與對應環境變數表，請參閱 [組態參數辭典](../reference/config-schema.md)。
