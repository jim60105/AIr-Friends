# MCP 伺服器整合

AIr-Friends 支援透過 **Model Context Protocol (MCP)** 將標準化工具集掛載至 ACP 代理人中。

---

## 什麼是 MCP

MCP（模型脈絡協定）是由 Anthropic 發起的一項開放標準，讓 AI 模型能以統一的協議連線至外部資料庫、API 與開發工具。

---

## 在 AIr-Friends 中配置 MCP 伺服器

可以在 `config.yaml` 的 `agent.mcpServers` 區段配置伺服器清單。每個條目以 `name` 識別，並以 `transport` 區分連線方式。

```yaml
agent:
  mcpServers:
    # Stdio 傳輸（預設）：啟動子行程
    - name: "github"
      command: "npx"
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: "${GITHUB_TOKEN}"

    # HTTP 傳輸：連線至既有伺服器
    - name: "database"
      transport: "http"
      url: "http://localhost:3002/mcp"
      headers:
        Authorization: "Bearer ${API_TOKEN}"
```

| 欄位 | 說明 |
| :--- | :--- |
| `name` | 伺服器識別名稱，必須唯一 |
| `transport` | 傳輸類型，`stdio`（預設）、`http` 或 `sse` |
| `command` / `args` / `env` | stdio 傳輸所需的命令、參數與環境變數 |
| `url` / `headers` | http 與 sse 傳輸所需的網址與標頭 |

所有欄位皆支援 `${ENV_VAR}` 語法進行環境變數展開。啟動後，ACP 代理人會在建立工作階段時連線並探索 MCP 伺服器提供的工具清單，並可在對話推理中呼叫這些工具。
