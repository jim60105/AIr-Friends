# language: zh-TW
功能: 使用 Deno 作為執行環境與配置檔載入機制

  背景:
    假設 Bot 使用 Deno 作為 NodeJS 執行環境
    而且 Deno 提供原生 TypeScript 支援與安全沙箱
    而且系統需要清晰的配置檔機制管理不同平台的設定
    而且 Bot 的提示詞必須與程式碼分離以便獨立維護

  情境: 使用 Deno 作為執行環境
    當系統部署與執行時
    那麼必須使用 Deno 2.x 以上版本
    而且不得依賴傳統 Node.js 執行環境
    而且專案使用 TypeScript 作為主要開發語言
    而且不需要額外的轉譯步驟即可執行

  情境: Deno 權限必須明確宣告
    當系統啟動 Bot 程序
    那麼必須使用 Deno 的權限旗標明確定義所需權限
    而且至少包含
      | 權限 | 說明 |
      | --allow-net | 允許網路存取(Discord API、Misskey API、web search) |
      | --allow-read | 允許讀取 local repo 與 working directory |
      | --allow-write | 允許寫入 working directory 內的記憶日誌 |
      | --allow-env | 允許讀取環境變數(例如 tokens) |
    而且不得使用 --allow-all 或過度寬鬆的權限設定

  情境: 配置檔使用 JSON5 或 YAML 格式
    當系統載入配置檔
    那麼配置檔必須支援 JSON5 或 YAML 格式
    而且配置檔路徑必須可透過環境變數或命令列參數指定
    而且預設配置檔路徑為 "./config.yaml"
    而且配置檔至少包含
      | 區塊 | 說明 |
      | platforms | 各平台(Discord、Misskey)的認證資訊與設定 |
      | agent | Agent SDK 相關設定(model、token limits) |
      | memory | 記憶檔案路徑與檢索限制 |
      | workspace | local repo 路徑與 workspace 根目錄 |

  情境: 平台認證資訊允許環境變數覆寫
    假設配置檔中存在 platforms.discord.token 欄位
    當系統啟動時偵測到環境變數 DISCORD_TOKEN
    那麼必須使用環境變數值覆寫配置檔中的值
    而且環境變數的優先級必須高於配置檔
    而且必須支援至少以下環境變數
      | 環境變數 | 對應配置 |
      | DISCORD_TOKEN | platforms.discord.token |
      | MISSKEY_TOKEN | platforms.misskey.token |
      | MISSKEY_HOST | platforms.misskey.host |
      | AGENT_MODEL | agent.model |

  情境: Bot 提示詞使用獨立設定檔
    當系統組裝 Agent 初始脈絡或系統提示
    那麼必須從配置檔中的 agent.system_prompt_path 指定的路徑載入提示詞
    而且提示詞檔案必須支援純文字或 Markdown 格式
    而且預設路徑為 "./prompts/system_reply.md"
    而且提示詞檔案與程式碼必須分離
    而且允許在不修改程式碼的情況下調整 Bot 行為

  情境: 配置檔驗證與錯誤處理
    當系統載入配置檔發生錯誤
    那麼系統必須輸出清楚的錯誤訊息
    而且必須指出缺少的必要欄位或格式錯誤的位置
    而且系統不得使用預設值繼續執行
    而且必須立即終止程序並回傳非零錯誤碼

  情境: 支援多環境配置檔
    當系統需要在不同環境執行(開發、測試、正式)
    那麼可以透過環境變數 ENV 或 DENO_ENV 指定環境名稱
    而且系統會依序嘗試載入
      | 載入順序 | 檔案路徑範例 |
      | 1 | config.{ENV}.yaml (例如 config.production.yaml) |
      | 2 | config.yaml |
    而且環境特定配置會覆寫基礎配置
