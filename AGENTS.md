# AI Friend - Development Guide for AI Agents

This document provides comprehensive guidance for AI agents working on the AI Friend project. It covers architecture, coding standards, build processes, and key design decisions.

## Project Overview

AI Friend is a multi-platform conversational AI bot that acts as an **ACP (Agent Client Protocol) Client**, delegating AI reasoning to external agents (GitHub Copilot CLI, Gemini CLI) while maintaining persistent cross-conversation memory.

**Key Concepts:**

- **We are the ACP Client**: We spawn and communicate with external ACP Agents
- **External CLI tools are the Agents**: GitHub Copilot CLI, Gemini CLI execute AI tasks
- **Skills are shell-based**: We provide Deno TypeScript skill scripts that Agents can execute
- **Skill API Server**: HTTP server for skills to communicate back to the main bot
- **Workspace isolation**: Each conversation context has its own isolated working directory

## Technology Stack

| Component       | Technology               | Version       |
| --------------- | ------------------------ | ------------- |
| Runtime         | Deno                     | 2.x           |
| Language        | TypeScript               | (Deno native) |
| ACP SDK         | @agentclientprotocol/sdk | 0.13.1        |
| Discord Library | discord.js               | ^14.0.0       |
| Misskey Library | misskey-js               | ^2024.10.1    |
| Configuration   | YAML (via @std/yaml)     | -             |
| Testing         | Deno.test + @std/assert  | -             |

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                   AI Friend (ACP CLIENT)                    │
├─────────────────────────────────────────────────────────────┤
│  Platform Adapters (Discord/Misskey)                        │
│           ↓                                                 │
│  AgentCore → SessionOrchestrator                            │
│           ↓                                                 │
│  AgentConnector → ACP ClientSideConnection                  │
│           ↓ (spawn subprocess, stdio JSON-RPC)              │
├─────────────────────────────────────────────────────────────┤
│           External ACP AGENTS                               │
│  (GitHub Copilot CLI / Gemini CLI)                          │
│           ↓ (executes our shell-based skills)               │
├─────────────────────────────────────────────────────────────┤
│  Shell Skills (Deno scripts in skills/ directory)           │
│           ↓ (calls back via HTTP)                           │
│  Skill API Server (HTTP endpoint)                           │
│           ↓                                                 │
│  Skill Handlers (memory, reply, context)                    │
│  Memory Store, Workspace Manager                            │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

| Directory          | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `src/core/`        | Agent session, workspace manager, context assembly     |
| `src/acp/`         | ACP Client integration, agent connector                |
| `src/platforms/`   | Platform adapters (Discord, Misskey)                   |
| `src/skills/`      | Internal skill handlers (memory, reply, context)       |
| `src/skill-api/`   | HTTP server for shell-based skills                     |
| `src/types/`       | TypeScript type definitions                            |
| `src/utils/`       | Logging, configuration loading, utilities              |
| `skills/`          | Shell-based skill scripts (executed by external agent) |

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

| Permission      | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `--allow-net`   | Discord API, Misskey API, external connections    |
| `--allow-read`  | Configuration files, workspace files, memory logs |
| `--allow-write` | Memory log files in workspace directories         |
| `--allow-env`   | Environment variables (tokens, configuration)     |

#### YOLO Mode

The `--yolo` flag enables automatic approval of ALL permission requests from the ACP agent:

```bash
deno run --allow-net --allow-read --allow-write --allow-env src/main.ts --yolo
```

**Use cases**:
- Container environments (enabled by default in Containerfile)
- Testing and development
- Trusted execution environments

**Warning**: Only use YOLO mode in isolated/trusted environments. It bypasses all permission checks for agent actions.

## Code Style & Formatting

This project uses Deno's built-in formatter and linter. Configuration is in `deno.json`:

| Rule          | Setting  |
| ------------- | -------- |
| Line Width    | 100      |
| Indent        | 2 spaces |
| Tabs          | No       |
| Single Quotes | No       |
| Prose Wrap    | preserve |

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

| Source                   | Limit               |
| ------------------------ | ------------------- |
| High-importance memories | All enabled         |
| Recent channel messages  | 20 messages (fixed) |
| Guild-related context    | Configurable        |

**No automatic memory compression or summarization**.

### 3. Memory System (Feature 03)

Append-only JSONL files:

- `memory.public.jsonl` - Public memories (all workspaces)
- `memory.private.jsonl` - Private memories (DM workspaces only)

Memory event structure:

```typescript
interface MemoryEvent {
  type: "memory";
  id: string; // Unique ID
  ts: string; // ISO 8601 timestamp
  enabled: boolean;
  visibility: "public" | "private";
  importance: "high" | "normal";
  content: string; // Plain text
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

**Shell-Based Skills Architecture**:

- Skills are Deno TypeScript scripts in `skills/` directory
- External Agents execute these scripts with `--session-id` parameter
- Scripts call back to main bot via HTTP API (Skill API Server)
- Session-based authentication ensures security

**Available Skills**:

| Skill             | Purpose                      | HTTP Endpoint              |
| ----------------- | ---------------------------- | -------------------------- |
| `memory-save`     | Save new memory              | POST /api/skill/memory-save     |
| `memory-search`   | Search existing memories     | POST /api/skill/memory-search   |
| `memory-patch`    | Update memory attributes     | POST /api/skill/memory-patch    |
| `fetch-context`   | Get additional platform data | POST /api/skill/fetch-context   |
| `send-reply`      | Send final reply (max 1)     | POST /api/skill/send-reply      |

**Single Reply Rule**:

- Only `send-reply` skill sends content externally
- Maximum **one reply per session** (enforced by SessionRegistry)
- Attempting second reply returns 409 Conflict error
- All other outputs (tool calls, reasoning) stay internal
- **Reply Threading**: When triggered from a message/note, replies are threaded to the original message using `replyToMessageId` from SkillContext

**Platform-Specific Reply Behavior**:

- **Misskey**: When triggered from a note, the reply is sent as a reply to that note (using `replyId`). For scheduled/time-triggered messages without a source note, a new note is created instead.
- **Discord**: Replies are sent to the same channel (threading not yet implemented).

**Skill API Implementation**:

```typescript
// Skill scripts call HTTP API with session ID and parameters
const result = await fetch("http://localhost:3001/api/skill/memory-save", {
  method: "POST",
  body: JSON.stringify({
    sessionId: "sess_abc123",
    parameters: { content: "User likes TypeScript", visibility: "public" }
  })
});
```

### 5. Platform Abstraction (Feature 05)

Normalized event model:

```typescript
interface NormalizedEvent {
  platform: string; // "discord" | "misskey"
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
- `sendReply(channelId, content, options?)`

**Misskey-Specific Notes**:

- **Username Format**: When building context, usernames are formatted as `@DisplayName (userId)` for better identification in conversation history
- **Note Channel ID**: Notes use `note:{noteId}` as channel ID for reply threading
- **DM Channel ID**: DMs use `dm:{userId}` as channel ID

### 6. ACP Client Integration

We use `@agentclientprotocol/sdk` for Client-side connection:

**AgentConnector** (`src/acp/agent-connector.ts`):

- Spawns external ACP agent as subprocess (copilot/gemini CLI)
- Creates bidirectional JSON-RPC stream (stdin/stdout)
- Manages agent lifecycle (connect, disconnect, cleanup)

**ChatbotClient** (`src/acp/client.ts`):

- Implements ACP `Client` interface
- Handles callbacks from external agents:
  - `requestPermission`: Permission requests (auto-approves registered skills, or all requests in YOLO mode)
  - `sessionUpdate`: Session state changes
  - `readTextFile`: Read files from workspace
  - `writeTextFile`: Write files to workspace

**Permission Handling**:

- **Normal mode**: Auto-approves registered skills and skills directory access
- **YOLO mode** (`--yolo` flag): Auto-approves ALL permission requests
  - Enabled by default in container deployments
  - Useful for trusted/isolated environments
  - Bypasses all permission validation

**Session Flow**:

```typescript
// 1. Create and connect agent
const connector = new AgentConnector({ agentConfig, clientConfig, skillRegistry });
await connector.connect();

// 2. Create session with workspace
const sessionId = await connector.createSession();
await connector.setSessionModel(sessionId, "gpt-4");

// 3. Send prompt and get response
const response = await connector.prompt(sessionId, assembledContext);

// 4. Disconnect when done
await connector.disconnect();
```

**Supported Agents**:

- **GitHub Copilot CLI** (`@github/copilot-cli`) - Default when `GITHUB_TOKEN` is set
- **Gemini CLI** - Alternative agent (requires separate configuration)

## Error Handling

Use the unified error class hierarchy:

| Error Class      | Use Case                    |
| ---------------- | --------------------------- |
| `ConfigError`    | Configuration issues        |
| `PlatformError`  | Platform API failures       |
| `AgentError`     | Agent execution errors      |
| `MemoryError`    | Memory file I/O errors      |
| `SkillError`     | Skill execution errors      |
| `WorkspaceError` | Workspace access violations |

```typescript
import { ConfigError, ErrorCode } from "@types/errors.ts";

throw new ConfigError(
  ErrorCode.CONFIG_MISSING_FIELD,
  "Missing required field: platforms.discord.token",
  { field: "platforms.discord.token" },
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
    token: "${DISCORD_TOKEN}" # Environment variable reference
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
ai-friend/
├── src/
│   ├── main.ts               # Entry point
│   ├── bootstrap.ts          # Application bootstrap
│   ├── shutdown.ts           # Graceful shutdown handler
│   ├── healthcheck.ts        # Health check server (optional)
│   ├── acp/                  # ACP Client integration
│   │   ├── agent-connector.ts # Manages ACP agent subprocess
│   │   ├── agent-factory.ts   # Creates agent configurations
│   │   ├── client.ts          # ChatbotClient (implements ACP Client)
│   │   └── types.ts           # ACP-related types
│   ├── core/
│   │   ├── agent-core.ts      # Main integration point
│   │   ├── session-orchestrator.ts # Conversation flow orchestration
│   │   ├── workspace-manager.ts    # Workspace isolation manager
│   │   ├── memory-store.ts         # Memory JSONL operations
│   │   ├── context-assembler.ts    # Initial context assembly
│   │   ├── message-handler.ts      # Platform event processing
│   │   ├── reply-dispatcher.ts     # Reply sending coordination
│   │   └── config-loader.ts        # Configuration loading
│   ├── platforms/
│   │   ├── platform-adapter.ts     # Platform adapter base class
│   │   ├── platform-registry.ts    # Platform management
│   │   ├── discord/                # Discord implementation
│   │   │   ├── discord-adapter.ts
│   │   │   ├── discord-config.ts
│   │   │   └── discord-utils.ts
│   │   └── misskey/                # Misskey implementation
│   │       ├── misskey-adapter.ts
│   │       ├── misskey-client.ts
│   │       ├── misskey-config.ts
│   │       └── misskey-utils.ts
│   ├── skills/               # Internal skill handlers
│   │   ├── registry.ts       # Skill handler registry
│   │   ├── memory-handler.ts # Memory operations
│   │   ├── reply-handler.ts  # Reply sending (single reply rule)
│   │   ├── context-handler.ts # Context fetching
│   │   └── types.ts          # Skill-related types
│   ├── skill-api/            # HTTP API for shell skills
│   │   ├── server.ts         # HTTP server implementation
│   │   └── session-registry.ts # Active session tracking
│   ├── types/
│   │   ├── config.ts         # Configuration types
│   │   ├── events.ts         # Event types
│   │   ├── memory.ts         # Memory types
│   │   ├── workspace.ts      # Workspace types
│   │   ├── platform.ts       # Platform types
│   │   ├── errors.ts         # Error classes
│   │   └── logger.ts         # Logger types
│   └── utils/
│       ├── logger.ts         # Structured JSON logging
│       └── env.ts            # Environment utilities
├── skills/                   # Shell-based skill scripts
│   ├── memory-save/
│   │   ├── SKILL.md          # Skill definition for agent
│   │   └── skill.ts          # Deno script
│   ├── memory-search/
│   │   ├── SKILL.md
│   │   └── skill.ts
│   ├── memory-patch/
│   │   ├── SKILL.md
│   │   └── skill.ts
│   ├── fetch-context/
│   │   ├── SKILL.md
│   │   └── skill.ts
│   ├── send-reply/
│   │   ├── SKILL.md
│   │   └── skill.ts
│   └── lib/
│       └── client.ts         # Shared skill API client
├── prompts/
│   └── system.md             # Bot system prompt
├── config/
│   └── config.example.yaml   # Example configuration
├── docs/
│   ├── DESIGN.md             # Detailed design document
│   ├── SKILLS_IMPLEMENTATION.md # Skills implementation guide
│   └── features/             # BDD feature specs (Gherkin)
├── tests/                    # Test files (mirrors src/ structure)
│   ├── core/
│   ├── acp/
│   ├── platforms/
│   ├── skills/
│   ├── skill-api/
│   ├── integration/
│   ├── mocks/
│   └── main.test.ts
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
