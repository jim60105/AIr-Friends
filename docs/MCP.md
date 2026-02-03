# MCP Tool Provider

Agent Chatbot exposes its skills as [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) tools, enabling external AI agents (like GitHub Copilot CLI, VS Code Copilot, Cursor, etc.) to interact with the chatbot's memory system and context features.

## Overview

The MCP tool provider implements an MCP server using stdio transport, which can be integrated with any MCP-compatible host. This allows external agents to:

- Save and search memories across conversations
- Modify memory metadata (enable/disable, change visibility/importance)
- Send replies to users
- Fetch additional context

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│           MCP Host (VS Code, Copilot CLI, etc.)             │
│                          ↓                                  │
│              MCP Protocol (stdio JSON-RPC)                  │
│                          ↓                                  │
├─────────────────────────────────────────────────────────────┤
│          Agent Chatbot MCP Server (src/mcp/server.ts)       │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   MCP Tools                          │   │
│  │  memory_save   memory_search   memory_patch          │   │
│  │  send_reply    fetch_context                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│        MemoryStore  /  WorkspaceManager                     │
└─────────────────────────────────────────────────────────────┘
```

## Available Tools

| Tool Name | Description |
|-----------|-------------|
| `memory_save` | Save important information to persistent memory |
| `memory_search` | Search through saved memories using keywords |
| `memory_patch` | Modify memory metadata (enable/disable, visibility, importance) |
| `send_reply` | Return the final reply message (in MCP mode, returns as tool result) |
| `fetch_context` | Fetch additional context (user info in MCP mode) |

For detailed tool specifications, see the individual [SKILL.md](../skills/) files.

## Configuration

### VS Code / GitHub Copilot

Create or update `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "agentChatbot": {
      "type": "stdio",
      "command": "deno",
      "args": [
        "task",
        "mcp:start"
      ],
      "cwd": "/path/to/agent-chatbot"
    }
  }
}
```

### GitHub Copilot CLI

Add to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "agentChatbot": {
      "type": "stdio",
      "command": "deno",
      "args": [
        "task",
        "mcp:start"
      ],
      "cwd": "/path/to/agent-chatbot",
      "tools": [
        "memory_save",
        "memory_search",
        "memory_patch",
        "send_reply",
        "fetch_context"
      ]
    }
  }
}
```

### Cursor IDE

Configure in Cursor's MCP settings with the same command format.

## Environment Variables

The MCP server uses environment variables to configure workspace context:

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_PLATFORM` | Platform identifier | `mcp` |
| `MCP_USER_ID` | User identifier for workspace isolation | `default` |
| `MCP_CHANNEL_ID` | Channel identifier for workspace isolation | `default` |
| `MCP_IS_DM` | Whether this is a DM context (affects private memories) | `false` |

### Example with Environment Variables

```json
{
  "servers": {
    "agentChatbot": {
      "type": "stdio",
      "command": "deno",
      "args": ["task", "mcp:start"],
      "cwd": "/path/to/agent-chatbot",
      "env": {
        "MCP_USER_ID": "my-user-id",
        "MCP_CHANNEL_ID": "my-channel"
      }
    }
  }
}
```

## Running the MCP Server

### Development Mode

```bash
deno task mcp:dev
```

### Production Mode

```bash
deno task mcp:start
```

### Manual Execution

```bash
deno run --allow-net --allow-read --allow-write --allow-env src/mcp/server.ts
```

## Workspace Isolation

Each MCP session uses workspace isolation based on the configured environment:

- Workspace key: `{platform}/{user_id}/{channel_id}`
- Default: `mcp/default/default`
- Memories are stored in: `data/workspaces/{workspace_key}/`

## Limitations in MCP Mode

1. **send_reply**: Returns the message as tool result instead of sending to a platform. The MCP host must handle message delivery.

2. **fetch_context**: Only `user_info` type is fully supported. `recent_messages` and `search_messages` require a real platform connection.

3. **No real-time platform events**: MCP mode is request/response only; it doesn't receive live messages from Discord/Misskey.

## Tool Usage Examples

### Save a Memory

```json
{
  "tool": "memory_save",
  "arguments": {
    "content": "User's favorite programming language is TypeScript",
    "visibility": "public",
    "importance": "normal"
  }
}
```

### Search Memories

```json
{
  "tool": "memory_search",
  "arguments": {
    "query": "favorite programming",
    "limit": 5
  }
}
```

### Disable a Memory

```json
{
  "tool": "memory_patch",
  "arguments": {
    "memory_id": "mem_abc123",
    "enabled": false
  }
}
```

### Send a Reply

```json
{
  "tool": "send_reply",
  "arguments": {
    "message": "Hello! I remember your favorite language is TypeScript."
  }
}
```

### Fetch User Info

```json
{
  "tool": "fetch_context",
  "arguments": {
    "type": "user_info"
  }
}
```

## Debugging

To debug MCP communication, you can use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector deno task mcp:start
```

## Related Documentation

- [MCP Protocol Specification](https://modelcontextprotocol.io/specification)
- [TypeScript SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Skills Implementation](./SKILLS_IMPLEMENTATION.md)
- [Design Document](./DESIGN.md)
