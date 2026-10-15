# MCP 伺服器整合

AIr-Friends 支援透過 **Model Context Protocol (MCP)** 將標準化工具集掛載至 ACP 代理人中。

---

## 什麼是 MCP

MCP（模型脈絡協定）是由 Anthropic 發起的一項開放標準，讓 AI 模型能以統一的協議連線至外部資料庫、API 與開發工具。

---

## 在 AIr-Friends 中配置 MCP 伺服器

可以在 `config.yaml` 中配置 `mcpServers` 區段：

```yaml
mcpServers:
  github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"

  sqlite:
    command: "uvx"
    args:
      - "mcp-server-sqlite"
      - "--db-path"
      - "./data/app.db"
```

啟動後，ACP 代理人會在建立工作階段時自動連線並探索 MCP 伺服器提供的工具清單，並可在對話推理中自動呼叫這些工具。
