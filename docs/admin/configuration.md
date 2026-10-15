# 組態設定載入

AIr-Friends 擁有嚴謹且直覺的階層式組態載入架構，支援 YAML 設定檔與環境變數動態替換。

---

## 載入順序與階層

當系統啟動時，組態載入模組（位於 `src/utils/config.ts`）會依序執行以下步驟：

1. **內建預設值 (Built-in Defaults)**：系統程式碼定義的基底預設設定。
2. **YAML 組態檔案**：預設讀取根目錄的 `config.yaml`（若提供 `--config <路徑>` 參數則讀取指定檔案）。
3. **環境變數覆寫 (Environment Variable Substitution)**：
   - YAML 內容中支援 `${ENV_VAR_NAME}` 語法，系統解析時會自動代入作業系統環境變數或 `.env` 檔案中的值。
   - 具備最高優先權的全域環境變數覆寫（例如 `AGENT_TYPE`、`PORT`、`DRY_RUN_ENABLED` 等直接覆蓋對應欄位）。

---

## 核心組態區塊結構

一份典型的 `config.yaml` 結構如下：

```yaml
# 1. 聊天平台介面
platforms:
  discord:
    enabled: true
    token: "${DISCORD_TOKEN}"
    applicationId: "${DISCORD_CLIENT_ID}"
  misskey:
    enabled: false
    host: "https://misskey.io"
    token: "${MISSKEY_TOKEN}"

# 2. ACP 代理人引擎
agent:
  type: "opencode"             # 引擎類型：opencode 或 omp
  defaultModel: "anthropic/claude-3-7-sonnet"
  skillsDir: "skills"          # 信任的技能腳本根目錄
  yolo: false                  # 全域 YOLO 自動授權模式 (預設關閉)

# 3. 頻道與回覆政策
channels:
  - id: "discord/channel/123456789"
    enabled: true
    replyPolicy: "mention_only" # 回覆政策：all, mention_only, disabled

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
  bindAddress: "127.0.0.1"
  passphrase: "${DASHBOARD_PASSPHRASE}"
```

完整的設定參數與對應的環境變數表，請參閱 [組態參數辭典](../reference/config-schema.md)。
