# 範本引擎 (Vento)

AIr-Friends 整合輕量且功能完整的 **[Vento](https://vento.js.org/)** 作為系統提示詞的樣板渲染引擎，版本固定為 2.2.0。

---

## 為什麼選擇 Vento

- **與 Deno 生態原生相容**：極致輕量、無須複雜編譯器工具鏈。
- **靈活的語法表達**：支援變數替換、條件判斷、迴圈迭代以及樣板包含（`include`）。
- **非同步支援**：可在渲染階段非同步取得資料。

---

## 內建變數與資料注入

在工作階段組裝提示詞時，系統會將下列核心變數注入 Vento 範本，定義於 `src/types/template.ts` 的 `TemplateVariables`。

| 變數名稱 | 型別 | 說明 |
| :--- | :--- | :--- |
| `isDm` | `boolean` | 是否為私訊對話 |
| `platform` | `string` | 當前平台程式碼（`discord`、`misskey` 或 `internal`） |
| `userId` | `string` | 觸發使用者的識別碼 |
| `channelId` | `string` | 當前對話所在的頻道識別碼 |
| `guildId` | `string` | 伺服器識別碼（不適用時為空字串） |
| `agentType` | `string` | 本次工作階段使用的代理人引擎（例如 `opencode`） |
| `skillsDir` | `string` | 已解析並受信任的技能腳本絕對路徑 |
| `tmpDir` | `string` | 本次工作階段的絕對酬載暫存目錄 |
| `sessionId` | `string` | 本次 Skill API 工作階段識別碼（`sess_...`） |
| `model` | `string` | 本次工作階段使用的模型識別碼 |
| `yolo` | `boolean` | 本次工作階段是否啟用 YOLO 模式 |
| `canWriteAgentWorkspace` | `boolean` | 本次工作階段是否可寫入全域知識庫 |
| `recentMessages` | `string` | 已格式化的近期訊息文字（自發貼文） |
| `importantMemories` | `string` | 已格式化的重要記憶文字（自發貼文） |
| `availableEmojis` | `string` | 已格式化的可用表情符號（自發貼文） |
| `userContextMessage` | `string` | 已格式化的使用者脈絡訊息（一般訊息） |
| `reminderMessage` | `string` | 提醒內容（提醒推播） |

完整欄位以 `src/types/template.ts` 為準，各流程僅注入其所需的變數。

---

## 語法範例與常用過濾器

### 1. 檔案包含 (Include)

```vento
{{ include "./character_name.md" }}
```

### 2. 條件判斷 (If-Else)

```vento
{{ if platform == "discord" }}
請注意回覆內容不要超過 Discord 2000 字元上限。
{{ else if platform == "misskey" }}
你可以善用 MFM (Misskey Flavored Markdown) 特殊語法豐富排版。
{{ /if }}
```

透過 Vento 引擎的彈性組合，AIr-Friends 能針對每次會話動態生成高度聚焦且語意完整的提示詞，協助外部代理人精確掌握推理脈絡。
