# Agent Chatbot - Development Guide for AI Agents

This document provides comprehensive guidance for AI agents working on the Agent Chatbot project. It covers architecture, coding standards, build processes, and key design decisions.

## Project Overview

Agent Chatbot is a multi-platform conversational AI bot that acts as an **ACP (Agent Client Protocol) Client**, delegating AI reasoning to external agents (GitHub Copilot CLI, Gemini CLI) while maintaining persistent cross-conversation memory.

**Key Concepts:**

- **We are the ACP Client**: We spawn and communicate with external ACP Agents
- **External CLI tools are the Agents**: GitHub Copilot CLI, Gemini CLI execute AI tasks
- **Skills are our capabilities**: We expose SKILL.md files that external Agents can invoke
- **Workspace isolation**: Each conversation context has its own isolated working directory

## Technology Stack

| Component         | Technology                 | Version      |
| ----------------- | -------------------------- | ------------ |
| Runtime           | Deno                       | 2.x          |
| Language          | TypeScript                 | (Deno native)|
| ACP SDK           | @agentclientprotocol/sdk   | 0.13.1       |
| Discord Library   | discord.js                 | ^14.0.0      |
| Configuration     | YAML (via @std/yaml)       | -            |
| Testing           | Deno.test + @std/assert    | -            |

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                 Agent Chatbot (ACP CLIENT)                  │
├─────────────────────────────────────────────────────────────┤
│  Platform Adapters (Discord/Misskey)                        │
│           ↓                                                 │
│  Agent Core (SessionOrchestrator)                           │
│           ↓                                                 │
│  ACP Client SDK (ClientSideConnection)                      │
│           ↓ (spawn subprocess, stdio JSON-RPC)              │
├─────────────────────────────────────────────────────────────┤
│           External ACP AGENTS                               │
│  (GitHub Copilot CLI / Gemini CLI)                          │
│           ↓ (reads our SKILL.md, invokes our skills)        │
├─────────────────────────────────────────────────────────────┤
│  Skill Handlers (in our chatbot)                            │
│  - memory-save, memory-search                               │
│  - send-reply, fetch-context                                │
│  Memory Store, Workspace Manager                            │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

| Directory           | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `src/core/`         | Agent session, workspace manager, context assembly   |
| `src/platforms/`    | Platform adapters (Discord, Misskey)                 |
| `src/skills/`       | Skill handlers invoked by external Agents            |
| `src/types/`        | TypeScript type definitions                          |
| `src/utils/`        | Logging, configuration loading, utilities            |

## Build & Development Commands

Always run these commands from the project root:

```bash
# Development (with hot reload)
deno task dev

# Production
deno task start

# Run all tests
deno task test

# Format code (REQUIRED before commit)
deno fmt src/ tests/

# Lint code (REQUIRED before commit)
deno lint src/ tests/

# Type check
deno check src/main.ts

# Format check only (CI uses this)
deno fmt --check src/ tests/
```

### Deno Permissions

When running manually, use these explicit permissions:

```bash
deno run --allow-net --allow-read --allow-write --allow-env src/main.ts
```

**Never use `--allow-all`**. Required permissions:

| Permission       | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `--allow-net`    | Discord API, Misskey API, external connections       |
| `--allow-read`   | Configuration files, workspace files, memory logs    |
| `--allow-write`  | Memory log files in workspace directories            |
| `--allow-env`    | Environment variables (tokens, configuration)        |

## Code Style & Formatting

This project uses Deno's built-in formatter and linter. Configuration is in `deno.json`:

| Rule          | Setting   |
| ------------- | --------- |
| Line Width    | 100       |
| Indent        | 2 spaces  |
| Tabs          | No        |
| Single Quotes | No        |
| Prose Wrap    | preserve  |

### Import Conventions

Use path aliases defined in `deno.json`:

```typescript
// ✅ Correct - use aliases
import { Logger } from "@utils/logger.ts";
import { WorkspaceManager } from "@core/workspace.ts";
import { NormalizedEvent } from "@types/event.ts";

// ❌ Wrong - avoid relative paths
import { Logger } from "../../../utils/logger.ts";
```

Available aliases:

| Alias         | Path               |
| ------------- | ------------------ |
| `@core/`      | `./src/core/`      |
| `@platforms/` | `./src/platforms/` |
| `@skills/`    | `./src/skills/`    |
| `@types/`     | `./src/types/`     |
| `@utils/`     | `./src/utils/`     |

### Code Comments

- Write comments in **English**
- Use JSDoc for public APIs
- Avoid obvious comments; explain "why", not "what"

## Key Design Decisions (from BDD Features)

### 1. Workspace Trust Boundary (Feature 01)

- `workspace_key = "{platform}/{user_id}/{channel_id}"`
- Each workspace is an isolated directory under `repo/workspaces/`
- Agent sessions use workspace path as current working directory (cwd)
- No cross-workspace file access allowed

```typescript
// Workspace path structure
const workspacePath = `${config.workspace.repo_path}/workspaces/${platform}/${userId}/${channelId}`;
```

### 2. Context Assembly (Feature 02)

Initial context comprises:

| Source             | Limit                    |
| ------------------ | ------------------------ |
| High-importance memories | All enabled          |
| Recent channel messages  | 20 messages (fixed)  |
| Guild-related context    | Configurable         |

**No automatic memory compression or summarization**.

### 3. Memory System (Feature 03)

Append-only JSONL files:

- `memory.public.jsonl` - Public memories (all workspaces)
- `memory.private.jsonl` - Private memories (DM workspaces only)

Memory event structure:

```typescript
interface MemoryEvent {
  type: "memory";
  id: string;           // Unique ID
  ts: string;           // ISO 8601 timestamp
  enabled: boolean;
  visibility: "public" | "private";
  importance: "high" | "normal";
  content: string;      // Plain text
}
```

**Memory cannot be deleted**, only disabled via patch events:

```typescript
interface PatchEvent {
  type: "patch";
  target_id: string;
  ts: string;
  changes: {
    enabled?: boolean;
    visibility?: "public" | "private";
    importance?: "high" | "normal";
  };
}
```

### 4. Skills & Final Reply (Feature 04)

- Only `send_reply` skill can send content externally
- Maximum **one reply per session**
- All other outputs (tool calls, reasoning) stay internal

```typescript
// Skills exposed to external Agents via SKILL.md
const skills = {
  "memory-save": saveMemory,      // Save new memory
  "memory-search": searchMemory,  // Search memories
  "send-reply": sendReply,        // Send final reply (max 1)
  "fetch-context": fetchContext,  // Get more context
};
```

### 5. Platform Abstraction (Feature 05)

Normalized event model:

```typescript
interface NormalizedEvent {
  platform: string;       // "discord" | "misskey"
  channel_id: string;
  user_id: string;
  message_id: string;
  is_dm: boolean;
  guild_id?: string;
  content: string;
  timestamp: string;
}
```

Platform adapters must implement:

- `fetchRecentMessages(channelId, limit)`
- `searchMessages(channelId, query)`
- `sendReply(channelId, content)`

### 6. ACP Client Integration

We use `@agentclientprotocol/sdk` for Client-side connection:

```typescript
import { ClientSideConnection, Client } from "@agentclientprotocol/sdk";

// Our chatbot implements the Client interface
const client: Client = {
  requestPermission: async (request) => { /* handle permission */ },
  sessionUpdate: async (update) => { /* handle session updates */ },
  readTextFile: async (path) => { /* read file in workspace */ },
  writeTextFile: async (path, content) => { /* write file */ },
};

// Connect to external Agent (e.g., GitHub Copilot CLI)
const connection = new ClientSideConnection(client, ndJsonStream);
await connection.initialize({ protocolVersion: PROTOCOL_VERSION });

// Create session and send prompts
const session = await connection.newSession({ workingDirectory: workspacePath });
const response = await connection.prompt(session.id, userMessage);
```

## Error Handling

Use the unified error class hierarchy:

| Error Class      | Use Case                        |
| ---------------- | ------------------------------- |
| `ConfigError`    | Configuration issues            |
| `PlatformError`  | Platform API failures           |
| `AgentError`     | Agent execution errors          |
| `MemoryError`    | Memory file I/O errors          |
| `SkillError`     | Skill execution errors          |
| `WorkspaceError` | Workspace access violations     |

```typescript
import { ConfigError, ErrorCode } from "@types/errors.ts";

throw new ConfigError(
  ErrorCode.CONFIG_MISSING_FIELD,
  "Missing required field: platforms.discord.token",
  { field: "platforms.discord.token" }
);
```

**Important**: Single session errors must NOT crash the entire bot.

## Logging

Use structured JSON logging via `@utils/logger.ts`:

```typescript
import { createLogger } from "@utils/logger.ts";

const logger = createLogger("ModuleName");
logger.info("Operation completed", { userId, channelId });
logger.error("Operation failed", { error: err.message });
```

**Never log sensitive information** (tokens, passwords, private message content).

## Testing

- Unit tests: `{module}.test.ts`
- Integration tests: `{feature}.integration.test.ts`
- Use `Deno.test()` with `@std/assert`

```typescript
import { assertEquals } from "@std/assert";

Deno.test("WorkspaceManager - generates correct workspace key", () => {
  const key = getWorkspaceKey({
    platform: "discord",
    user_id: "123",
    channel_id: "456",
  });
  assertEquals(key, "discord/123/456");
});
```

## Configuration

Configuration file: `config.yaml`

```yaml
platforms:
  discord:
    token: "${DISCORD_TOKEN}"   # Environment variable reference
    enabled: true
  misskey:
    host: "${MISSKEY_HOST}"
    token: "${MISSKEY_TOKEN}"
    enabled: false

agent:
  model: "gpt-4"
  system_prompt_path: "./prompts/system.md"
  token_limit: 4096

memory:
  search_limit: 10
  max_chars: 2000

workspace:
  repo_path: "./data"
  workspaces_dir: "workspaces"
```

Environment variables override config file values.

## File Layout Quick Reference

```text
agent-chatbot/
├── src/
│   ├── main.ts               # Entry point
│   ├── core/
│   │   ├── workspace.ts      # Workspace manager
│   │   ├── session.ts        # Agent session orchestration
│   │   ├── context.ts        # Context assembly
│   │   ├── memory.ts         # Memory operations
│   │   └── error-handler.ts  # Global error handling
│   ├── platforms/
│   │   ├── adapter.ts        # Platform adapter interface
│   │   ├── discord/          # Discord implementation
│   │   └── misskey/          # Misskey implementation (stub)
│   ├── skills/
│   │   ├── memory-save.ts    # memory-save skill handler
│   │   ├── memory-search.ts  # memory-search skill handler
│   │   ├── send-reply.ts     # send-reply skill handler
│   │   └── fetch-context.ts  # fetch-context skill handler
│   ├── types/
│   │   ├── config.ts         # Configuration types
│   │   ├── event.ts          # Event types
│   │   ├── memory.ts         # Memory types
│   │   ├── errors.ts         # Error classes
│   │   └── logger.ts         # Logger types
│   └── utils/
│       ├── logger.ts         # Structured logging
│       └── config.ts         # Configuration loading
├── prompts/
│   └── system.md             # Bot system prompt
├── skills/                   # SKILL.md definitions (read by external Agents)
│   ├── memory-save.SKILL.md
│   ├── memory-search.SKILL.md
│   ├── send-reply.SKILL.md
│   └── fetch-context.SKILL.md
├── config/
│   └── config.example.yaml
├── docs/
│   ├── DESIGN.md             # Detailed design document
│   └── features/             # BDD feature specs (Gherkin)
├── tests/                    # Test files (mirrors src/ structure)
├── deno.json                 # Deno configuration
├── deno.lock                 # Dependency lock file
├── config.yaml               # Runtime configuration
└── Containerfile             # Container build definition
```

## CI/CD Checklist

Before committing, ensure:

1. ✅ `deno fmt --check src/ tests/` passes
2. ✅ `deno lint src/ tests/` passes
3. ✅ `deno check src/main.ts` passes
4. ✅ `deno test` passes
5. ✅ No sensitive data in code or logs

## Related Documentation

- [docs/DESIGN.md](docs/DESIGN.md) - Detailed design document
- [docs/features/](docs/features/) - BDD feature specifications
- [ACP Protocol Spec](https://agentclientprotocol.org/) - Agent Client Protocol
- [Agent Skills Standard](https://agentskills.io/) - SKILL.md format
