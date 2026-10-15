# 範本引擎 (Vento)

AIr-Friends 整合了輕量且功能強大的 **[Vento](https://vento.js.org/)** 作為系統提示詞的樣板渲染引擎。

---

## 為什麼選擇 Vento

- **與 Deno 生態原生相容**：極致輕量、無須複雜編譯器工具鏈。
- **靈活的語法表達**：支援變數替換、條件判斷、迴圈迭代以及樣板包含（`include`）。
- **非同步支援**：可在渲染階段非同步取得資料。

---

## 內建變數與資料注入

在工作階段組裝提示詞時，系統會將以下核心變數自動注入 Vento 範本：

| 變數名稱 | 型別 | 說明 |
| :--- | :--- | :--- |
| `botName` | `string` | 機器人顯示名稱 |
| `platform` | `string` | 當前平台代碼（`discord` 或 `misskey`） |
| `channelId` | `string` | 當前對話所在的頻道識別碼 |
| `userId` | `string` | 觸發使用者的識別碼 |
| `userName` | `string` | 觸發使用者的暱稱 |
| `sessionId` | `string` | 當前 ACP 工作階段唯一識別碼 |
| `skillsDir` | `string` | 已解析並受信任的技能腳本絕對路徑 |
| `stagingDir` | `string` | 當前會話的暫存檔案目錄路徑 |
| `coreMemories` | `Array` | 核心層長期記憶清單 |
| `recentMessages`| `Array` | 近期頻道歷史訊息陣列 |

---

## 語法範例與常用過濾器

### 1. 檔案包含 (Include)
```vento
{{ include "./soul.md" }}
```

### 2. 條件判斷 (If-Else)
```vento
{{ if platform == "discord" }}
請注意回覆內容不要超過 Discord 2000 字元上限。
{{ else if platform == "misskey" }}
你可以善用 MFM (Misskey Flavored Markdown) 特殊語法豐富排版。
{{ /if }}
```

### 3. 記憶清單迭代 (For Loop)
```vento
{{ if coreMemories.length > 0 }}
## 關於使用者的核心記憶
{{ for memory of coreMemories }}
- [{{ memory.category }}] {{ memory.content }}
{{ /for }}
{{ /if }}
```

藉由 Vento 引擎的彈性組合，AIr-Friends 能夠針對每次會話動態生成高度聚焦且語意完整的提示詞，協助外部代理人精確掌握推理脈絡。
