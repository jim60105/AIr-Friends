# AIr-Friends Design Document

This document describes the architecture and design decisions for the AIr-Friends project—an AI-powered conversational agent that operates across multiple platforms (Discord, Misskey) with persistent cross-conversation memory and a clean separation between internal reasoning and external communication.

## Table of Contents

- [AIr-Friends Design Document](#air-friends-design-document)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
    - [Design Principles](#design-principles)
  - [Architecture](#architecture)
    - [High-Level Architecture](#high-level-architecture)
    - [Trust Boundary Model](#trust-boundary-model)
  - [Core Components](#core-components)
    - [Workspace Manager](#workspace-manager)
    - [Platform Adapters](#platform-adapters)
    - [Agent Session](#agent-session)
    - [Memory System](#memory-system)
    - [Skills System](#skills-system)
  - [Data Flow](#data-flow)
    - [Message Processing Pipeline](#message-processing-pipeline)
    - [Context Assembly](#context-assembly)
    - [Reply Flow](#reply-flow)
  - [Memory System Design](#memory-system-design)
    - [Storage Format](#storage-format)
    - [Memory Types](#memory-types)
    - [Memory Retrieval](#memory-retrieval)
  - [Platform Abstraction](#platform-abstraction)
    - [Event Model](#event-model)
    - [Platform Capabilities](#platform-capabilities)
    - [Adapter Interface](#adapter-interface)
  - [Configuration](#configuration)
    - [Configuration File Format](#configuration-file-format)
    - [Environment Variables](#environment-variables)
    - [Multi-Environment Support](#multi-environment-support)
  - [Deployment](#deployment)
    - [Container Image](#container-image)
    - [Volume Mounts](#volume-mounts)
    - [Health Checks](#health-checks)
  - [Error Handling and Logging](#error-handling-and-logging)
    - [Structured Logging](#structured-logging)
    - [Error Classification](#error-classification)
    - [Resilience Patterns](#resilience-patterns)
  - [Testing Strategy](#testing-strategy)
    - [Test Types](#test-types)
    - [Test Framework](#test-framework)
    - [CI/CD Pipeline](#cicd-pipeline)
  - [Project Structure](#project-structure)
    - [deno.json Configuration](#denojson-configuration)
    - [Deno Permissions](#deno-permissions)
  - [Appendix: Performance Metrics](#appendix-performance-metrics)

---

## Overview

AI Friend is a conversational AI bot designed to:

1. **Operate across multiple platforms** (Discord, Misskey) with a unified abstraction layer
2. **Maintain cross-conversation memory** using append-only log files
3. **Isolate different conversation contexts** through workspace-based trust boundaries
4. **Keep reasoning processes internal** while only exposing final replies externally
5. **Run in containerized environments** with Deno as the execution runtime

### Design Principles

- **Trust Boundary Isolation**: Each conversation context (platform/user combination) has its own isolated workspace
- **Clean Thought Process**: Agent's intermediate reasoning and tool calls remain internal; only final replies are sent externally
- **Append-Only Memory**: Memory cannot be deleted, only disabled—ensuring audit trail integrity
- **Platform Agnostic**: Core logic is decoupled from platform-specific implementations
- **Configuration-Driven**: Bot behavior and credentials are externalized to configuration files

---

## Architecture

### High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                                AI Friend                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Discord    │    │   Misskey    │    │   (Future)   │   Platform        │
│  │   Adapter    │    │   Adapter    │    │   Adapters   │   Layer           │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                   │                            │
│         └───────────────────┼───────────────────┘                            │
│                             ▼                                                │
│                   ┌─────────────────────┐                                    │
│                   │   Normalized Event  │   Event Normalization              │
│                   │   (platform, user,  │                                    │
│                   │    channel, guild)  │                                    │
│                   └──────────┬──────────┘                                    │
│                              ▼                                               │
│                   ┌─────────────────────┐                                    │
│                   │  Workspace Manager  │   Trust Boundary                   │
│                   │  (working directory │   Enforcement                      │
│                   │   selection/creation)│                                   │
│                   └──────────┬──────────┘                                    │
│                              ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────┐      │
│  │                      Agent Session                                 │      │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │      │
│  │  │ Context Assembly │  │   Agent Core    │  │  Skills Layer   │    │      │
│  │  │ (memory, recent │  │   (reasoning,   │  │  (tools for     │    │      │
│  │  │  messages, etc.) │  │   planning)     │  │   agent calls)  │    │      │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘    │      │
│  └───────────────────────────────────────────────────────────────────┘      │
│                              │                                               │
│                              ▼                                               │
│                   ┌─────────────────────┐                                    │
│                   │   Final Reply Only  │   Output Gate                      │
│                   │   (send-reply skill)│                                    │
│                   └──────────┬──────────┘                                    │
│                              ▼                                               │
│                      External Platform                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Trust Boundary Model

The system uses working directories to enforce trust boundaries:

```text
repo/
└── workspaces/
    ├── discord/
    │   ├── user123/                     # Per-user workspace
    │   │   ├── memory.public.jsonl
    │   │   └── memory.private.jsonl
    │   └── user456/
    │       ├── memory.public.jsonl
    │       └── memory.private.jsonl
    └── misskey/
        └── user789/
            ├── memory.public.jsonl
            └── memory.private.jsonl
```

**Key Rules:**

- `workspace_key = "{platform}/{user_id}"`
- Same user across different channels shares one workspace
- Each workspace is isolated—no cross-workspace file access allowed
- Both `memory.public.jsonl` and `memory.private.jsonl` exist in every workspace
- In DM context: saves to private, reads from **both** private and public
- In non-DM context (guild/public thread): saves/reads from public only
- Each agent session uses its workspace as the current working directory (cwd)

---

## Core Components

### Workspace Manager

**Responsibility:** Manages workspace creation, selection, and access control.

```typescript
interface WorkspaceManager {
  // Calculate workspace key from event
  getWorkspaceKey(event: NormalizedEvent): string;

  // Ensure workspace directory exists and return path
  ensureWorkspace(key: string): Promise<string>;

  // Validate that a path is within the workspace boundary
  validatePath(workspacePath: string, targetPath: string): boolean;
}
```

**Constraints:**

- Workspace paths must not overlap
- File operations outside the workspace must be rejected
- Directory creation must be idempotent

### Platform Adapters

**Responsibility:** Handle platform-specific communication and event translation.

Each adapter must implement:

| Capability              | Description                             |
| ----------------------- | --------------------------------------- |
| `fetch_recent_messages` | Retrieve recent messages from a channel |
| `search_messages`       | Search messages by keyword              |
| `send_reply`            | Send a reply to the platform            |

**Adapter Interface:**

```typescript
interface PlatformAdapter {
  readonly platform: string;

  // Connect to platform and start receiving events
  connect(): Promise<void>;

  // Disconnect gracefully
  disconnect(): Promise<void>;

  // Subscribe to normalized events
  onEvent(handler: (event: NormalizedEvent) => void): void;

  // Platform capabilities (exposed as skills)
  fetchRecentMessages(channelId: string, limit: number): Promise<Message[]>;
  searchMessages(channelId: string, query: string): Promise<Message[]>;
  sendReply(channelId: string, content: string): Promise<void>;
}
```

### Agent Session

**Responsibility:** Execute a single interaction cycle with isolated state.

```typescript
interface AgentSession {
  // Session is initialized with workspace path as cwd
  readonly workspacePath: string;

  // Run the agent with assembled context
  run(initialContext: Context): Promise<SessionResult>;

  // Sessions are not reusable - create new instance for each interaction
}
```

**Key Behaviors:**

- Each trigger creates a new session (no state reuse)
- Internal outputs (tool calls, reasoning) stay within the session
- Only `send-reply` skill can emit external responses
- Maximum one external reply per session

### Memory System

**Responsibility:** Persist and retrieve cross-conversation memory.

See [Memory System Design](#memory-system-design) for detailed specifications.

### Skills System

**Responsibility:** Provide callable capabilities to the Agent.

**Architecture:**

Skills are implemented as shell-based Deno TypeScript scripts that external ACP Agents can execute. Each skill:
- Has a `SKILL.md` file describing its usage and parameters for the agent
- Contains executable scripts in a `scripts/` subdirectory
- Receives a `--session-id` parameter identifying the active session
- Calls back to the main bot via HTTP API (Skill API Server on localhost:3001)
- Uses session-based authentication for security

During an active session, a `SESSION_ID` file is created in the workspace containing the session identifier that skills must use.

**Available Skills:**

| Skill           | Purpose                      | HTTP Endpoint                 | Handler             |
| --------------- | ---------------------------- | ----------------------------- | ------------------- |
| `memory-save`   | Save new memory              | POST /api/skill/memory-save   | MemoryHandler       |
| `memory-search` | Search existing memories     | POST /api/skill/memory-search | MemoryHandler       |
| `memory-patch`  | Update memory attributes     | POST /api/skill/memory-patch  | MemoryHandler       |
| `fetch-context` | Get additional platform data | POST /api/skill/fetch-context | ContextHandler      |
| `send-reply`    | Send final reply (max 1)     | POST /api/skill/send-reply    | ReplyHandler        |

> [!IMPORTANT]
> Only `send-reply` can send content externally. All other skills inject results into the agent's session context only.

---

## Data Flow

### Message Processing Pipeline

```text
1. Platform Event Received
         │
         ▼
2. Event Normalization
   (extract platform, user_id, channel_id, is_dm, guild_id)
         │
         ▼
3. Workspace Resolution
   (compute workspace_key, ensure directory exists)
         │
         ▼
4. Context Assembly
   - Load high-importance memories (full)
   - Load recent channel messages (up to 20)
   - Load related guild interactions (configurable)
   - Search normal-importance memories (on demand)
         │
         ▼
5. Agent Session Creation
   (new session with cwd = workspace path)
         │
         ▼
6. Agent Reasoning Loop
   - Process context
   - Call skills as needed
   - Build response
         │
         ▼
7. Final Reply (via send-reply skill)
         │
         ▼
8. Session Cleanup
```

### Context Assembly

Initial context comprises three data sources:

| Source          | Content                                 | Limit        |
| --------------- | --------------------------------------- | ------------ |
| Memory          | High-importance memories from workspace | All enabled  |
| Recent Messages | Last N messages from same channel       | 20 (fixed)   |
| Guild Context   | Related interactions from same guild    | Configurable |

**`/clear` Command:**

When a message starts with `/clear`, it acts as a context reset command:

- **If the trigger message itself is `/clear`**: The system immediately exits without executing the agent or sending any reply, as this is purely a command, not a conversation requiring a response.
- **If `/clear` appears in recent message history**: The system drops that message and all messages before it. Only messages after the last `/clear` are included in the context.

This allows users to reset the conversation context within the same channel (useful for DMs or long-lived threads where creating a new channel is not practical). The `/clear` command only affects recent channel messages — it does not affect memory retrieval or guild-related message searches.

**Dynamic Context Expansion:**

The Agent can request additional context during reasoning by calling:

- `fetch-context` — Fetch more messages from the platform
- `memory-search` — Search memory by keywords

> [!NOTE]
> The system does **not** perform automatic memory compression or summarization. Context size is controlled through fixed quotas and retrieval limits.

### Reply Flow

```text
Agent Output (internal)
        │
        ├─── Tool call results ──► Injected to session context
        │
        ├─── Reasoning text ────► Internal only (not sent externally)
        │
        └─── send-reply call ───► Sent to platform (max 1 per session)
                   │
                   └─── Uses replyToMessageId to thread replies
                        (for Misskey: replies to original note)
```

**Constraints:**

- Only one `send-reply` call allowed per session
- Second `send-reply` call must be rejected/error
- All non-reply outputs remain internal
- Replies are threaded to the original message when applicable (platform-dependent)

---

## Memory System Design

### Storage Format

Memory uses append-only JSONL (JSON Lines) files:

| File                   | Purpose          |
| ---------------------- | ---------------- |
| `memory.public.jsonl`  | Public memories  |
| `memory.private.jsonl` | Private memories |

Both files exist in every workspace. Each line is a JSON event. No new files are created for new memories.

### Memory Types

**Memory Event (type=memory):**

```json
{
  "type": "memory",
  "id": "mem_abc123",
  "ts": "2024-01-15T10:30:00Z",
  "enabled": true,
  "visibility": "public",
  "importance": "high",
  "content": "User prefers formal communication style"
}
```

| Field        | Description                                   |
| ------------ | --------------------------------------------- |
| `id`         | Unique identifier                             |
| `ts`         | ISO 8601 timestamp                            |
| `enabled`    | Whether memory is active                      |
| `visibility` | `public` or `private`                         |
| `importance` | `high` (always loaded) or `normal` (searched) |
| `content`    | Memory content (plain text)                   |

**Patch Event (type=patch):**

```json
{
  "type": "patch",
  "target_id": "mem_abc123",
  "ts": "2024-01-16T08:00:00Z",
  "changes": {
    "enabled": false
  }
}
```

**Patch Constraints:**

- Can only modify: `enabled`, `visibility`, `importance`
- Cannot modify: `content`, `id`, `ts`
- Delete operations are forbidden—use `enabled: false` instead

### Memory Retrieval

**High-Importance Memories:**

- Automatically loaded during context assembly
- Sorted by timestamp (oldest to newest)
- No search required

**Normal-Importance Memories:**

- Retrieved via full-text search using `rg` (ripgrep)
- Results limited by hit count and total characters
- Searched on demand or during initial assembly

**Private Memory Access:**

- Both memory files exist in every workspace
- In DM context: reads/searches **both** `memory.private.jsonl` and `memory.public.jsonl`; saves to `memory.private.jsonl`
- In non-DM context: reads/searches only `memory.public.jsonl`; saves to `memory.public.jsonl`
- Non-DM contexts must not load or search private memories

---

## Platform Abstraction

### Event Model

All platform events are normalized to:

```typescript
interface NormalizedEvent {
  platform: string; // "discord" | "misskey" | ...
  channel_id: string; // Channel/chat room identifier
  user_id: string; // Message author identifier
  message_id: string; // Original message identifier
  is_dm: boolean; // Whether this is a direct message
  guild_id?: string; // Server/group identifier (if applicable)
  content: string; // Message content
  timestamp: string; // ISO 8601 timestamp
}
```

### Platform Capabilities

Each platform adapter must provide these methods:

| Method                  | Signature                         | Description                 |
| ----------------------- | --------------------------------- | --------------------------- |
| `fetch_recent_messages` | `(channel_id, limit) → Message[]` | Get recent channel messages |
| `search_messages`       | `(channel_id, query) → Message[]` | Keyword search in channel   |
| `send_reply`            | `(channel_id, content) → void`    | Send reply to channel       |

### Adapter Interface

**Discord Adapter:**

- Uses Discord.js or similar library
- Handles gateway connection and events
- Maps Discord-specific IDs to normalized format

**Misskey Adapter:**

- Uses REST API for queries and replies
- Uses WebSocket streaming for real-time events
- Authentication via `i` parameter (access token)
- **Reply Threading**: When triggered from a note, replies are sent as threaded replies to the same note using `replyId`
- **Username Format**: User names in context include both display name and ID (e.g., `@DisplayName (userId)`) for better identification
- Creates new notes only when there's no previous note context (e.g., time-triggered messages)
- **Chat Messages**: Supports Misskey chat (private messaging) via `chat/messages/user-timeline` for fetching history and `chat/messages/create-to-user` for sending replies. Chat channels use `chat:{userId}` prefix.

**Misskey Channel Types:**

| Channel ID Format | Description                          | Message Type |
| ----------------- | ------------------------------------ | ------------ |
| `note:{noteId}`   | Public note conversation thread      | Note         |
| `dm:{userId}`     | Direct message via specified notes   | Note (DM)    |
| `chat:{userId}`   | Private chat room with specific user | Chat Message |

---

## Configuration

### Configuration File Format

Primary configuration file: `config.yaml` (YAML or JSON5 supported)

```yaml
# config.yaml
platforms:
  discord:
    token: "${DISCORD_TOKEN}" # Can reference env vars
    enabled: true
  misskey:
    host: "misskey.example.com"
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

### Environment Variables

Environment variables override configuration file values:

| Variable             | Config Path                | Description                               |
| -------------------- | -------------------------- | ----------------------------------------- |
| `DISCORD_TOKEN`      | `platforms.discord.token`  | Discord bot token                         |
| `MISSKEY_TOKEN`      | `platforms.misskey.token`  | Misskey access token                      |
| `MISSKEY_HOST`       | `platforms.misskey.host`   | Misskey instance host                     |
| `AGENT_MODEL`        | `agent.model`              | LLM model identifier                      |
| `AGENT_DEFAULT_TYPE` | `agent.default_agent_type` | Default ACP agent (copilot/gemini/opencode) |
| `GITHUB_TOKEN`       | `agent.github_token`       | GitHub token for Copilot/OpenCode         |
| `GEMINI_API_KEY`     | `agent.gemini_api_key`     | Gemini API key for Gemini CLI/OpenCode    |
| `OPENCODE_API_KEY`   | `agent.opencode_api_key`   | OpenCode API key                          |
| `OPENROUTER_API_KEY` | `agent.open_router_api_key`| OpenRouter API key                        |
| `LOG_LEVEL`          | `logging.level`            | Logging level                             |
| `ENV` / `DENO_ENV`   | -                          | Environment name                          |

### Multi-Environment Support

Configuration loading order:

1. `config.{ENV}.yaml` (e.g., `config.production.yaml`)
2. `config.yaml` (base configuration)

Environment-specific config overrides base config.

> [!WARNING]
> If configuration loading fails due to missing required fields or format errors, the system must output clear error messages, indicate the problem location, and terminate with a non-zero exit code. No default values should be used to continue execution.

---

## Deployment

### Container Image

**Base Image:** `denoland/deno:debian` (Debian-based for better compatibility)

**Included Binaries:**

- **copilot** - GitHub Copilot CLI (latest release)
- **opencode** - OpenCode CLI (latest release)
- **rg** (ripgrep 15.1.0) - For memory search operations
- **curl** - For health checks
- **dumb-init** - For proper signal handling as PID 1

**Multi-Stage Build:**

```dockerfile
# Stage 1: Unpack binaries (copilot, opencode, ripgrep)
FROM base AS copilot-unpacker
# ... download and extract copilot

FROM base AS opencode-unpacker
# ... download and extract opencode

FROM base AS ripgrip-unpacker
# ... download and extract ripgrep

# Stage 2: Cache dependencies
FROM base AS cache
WORKDIR /app
COPY deno.json deno.lock ./
COPY src/ ./src/
RUN deno cache --lock=deno.lock src/main.ts npm:@google/gemini-cli

# Stage 3: Final runtime
FROM base AS final
WORKDIR /app
# Copy binaries from unpack stages
COPY --from=copilot-unpacker /copilot/copilot /usr/local/bin/copilot
COPY --from=opencode-unpacker /opencode/opencode /usr/local/bin/opencode
COPY --from=ripgrip-unpacker /ripgrip/.../rg /usr/local/bin/rg
# Copy cached dependencies
COPY --from=cache /deno-dir/ /deno-dir/
# Copy application files
COPY deno.json deno.lock /app/
COPY config.example.yaml /app/config.yaml
COPY src/ /app/src/
COPY prompts/ /app/prompts/
# Copy skills to ~/.agents/skills/ for agent discovery
COPY skills/ /home/deno/.agents/skills/
# Copy OpenCode configuration
COPY opencode.json /home/deno/.config/opencode/opencode.json

USER deno
ENTRYPOINT ["dumb-init", "--"]
# Default command includes --yolo flag (safe in container environment)
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "src/main.ts", "--yolo"]
```

**Required Labels:**

```dockerfile
LABEL org.opencontainers.image.title="air-friends"
LABEL org.opencontainers.image.description="AI-powered multi-platform chatbot"
LABEL org.opencontainers.image.source="https://github.com/..."
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.licenses="MIT"
```

### Volume Mounts

| Mount Point        | Purpose                                |
| ------------------ | -------------------------------------- |
| `/app/data`        | Local repo (workspaces, memory files)  |
| `/app/config.yaml` | Configuration file (optional override) |
| `/app/prompts/`    | Prompt files (optional override)       |

**Persistence Requirements:**

- `/app/data` volume must persist across container restarts
- Memory files must remain intact after restart

### Health Checks

**Endpoint:** `GET /health` or `GET /healthz`

**Response Codes:**

| Code | Condition                                 |
| ---- | ----------------------------------------- |
| 200  | Bot running, platform connections healthy |
| 503  | Starting up or platform connection lost   |

**Graceful Shutdown:**

- Handle `SIGTERM` signal properly
- Complete in-progress agent sessions before stopping
- Close WebSocket connections gracefully

---

## Error Handling and Logging

### Structured Logging

**Format:** JSON Lines to stdout/stderr

```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "INFO",
  "module": "discord-adapter",
  "message": "Connected to Discord gateway",
  "context": {
    "guild_count": 5,
    "latency_ms": 45
  }
}
```

**Output Streams:**

- `DEBUG`, `INFO`, `WARN` → stdout
- `ERROR`, `FATAL` → stderr

**Log Levels:** Controlled by `LOG_LEVEL` environment variable

- `DEBUG` — Verbose debugging information
- `INFO` — Normal operational events (default)
- `WARN` — Warning conditions
- `ERROR` — Error conditions (recoverable)
- `FATAL` — Critical errors (program termination)

> [!CAUTION]
> Sensitive information (tokens, private message content, passwords) must **never** be logged, even at DEBUG level. The logging layer must automatically detect and mask common token patterns.

### Error Classification

| Error Class     | Use Case                         | Behavior                          |
| --------------- | -------------------------------- | --------------------------------- |
| `ConfigError`   | Configuration loading/validation | Fatal, terminate                  |
| `PlatformError` | Platform API failures            | Retry with backoff                |
| `AgentError`    | Agent execution errors           | Log, send error message, continue |
| `MemoryError`   | Memory file I/O errors           | Log, may retry                    |
| `SkillError`    | Skill execution errors           | Log, inject error to context      |

### Resilience Patterns

**Single Session Isolation:**

- Errors in one session must not affect other sessions
- Log full stack trace internally
- Send simplified error message externally (no internal details)

**Platform Reconnection:**

Exponential backoff for connection failures:

| Attempt | Wait Time     |
| ------- | ------------- |
| 1-3     | 1-5 seconds   |
| 4-6     | 10-30 seconds |
| 7+      | 60 seconds    |

After configurable max failures → log FATAL and terminate.

---

## Testing Strategy

### Test Types

| Type        | Naming                          | Purpose                              |
| ----------- | ------------------------------- | ------------------------------------ |
| Unit        | `{module}.test.ts`              | Test individual modules in isolation |
| Integration | `{feature}.integration.test.ts` | Test end-to-end flows                |

### Test Framework

- Use Deno's built-in `Deno.test()`
- Assertions via `@std/assert`
- Mocks/stubs for external dependencies

### CI/CD Pipeline

All checks must pass before merge:

| Check             | Command                          |
| ----------------- | -------------------------------- |
| Format            | `deno fmt --check`               |
| Lint              | `deno lint`                      |
| Type Check        | `deno check src/main.ts`         |
| Unit Tests        | `deno test`                      |
| Integration Tests | `deno test --filter integration` |

---

## Project Structure

```text
AIr-Friends/
├── deno.json                 # Deno configuration (imports, tasks, fmt, lint)
├── deno.lock                 # Dependency lock file
├── config.yaml               # Default configuration
├── .env.example              # Environment variable template
├── Containerfile             # Container build definition
├── src/
│   ├── main.ts               # Entry point
│   ├── core/                 # Core logic
│   │   ├── workspace.ts      # Workspace manager
│   │   ├── session.ts        # Agent session
│   │   ├── context.ts        # Context assembly
│   │   └── memory.ts         # Memory operations
│   ├── platforms/            # Platform adapters
│   │   ├── adapter.ts        # Adapter interface
│   │   ├── discord/          # Discord implementation
│   │   └── misskey/          # Misskey implementation (stub)
│   ├── skills/               # Skill implementations
│   │   ├── platform.ts       # Platform skills
│   │   ├── memory.ts         # Memory skills
│   │   └── web.ts            # Web search skills
│   ├── types/                # TypeScript type definitions
│   │   ├── config.ts         # Configuration types
│   │   ├── event.ts          # Event types
│   │   └── memory.ts         # Memory types
│   └── utils/                # Utility functions
│       ├── logger.ts         # Structured logging
│       └── config.ts         # Configuration loading
├── prompts/                  # Bot prompt files
│   └── system.md             # System prompt
├── config/                   # Example configurations
│   └── config.example.yaml
├── docs/                     # Documentation
│   ├── DESIGN.md             # This document
│   └── features/             # Feature specifications (Gherkin)
└── tests/                    # Test files
    ├── core/
    ├── platforms/
    └── skills/
```

### deno.json Configuration

```json
{
  "imports": {
    "@core/": "./src/core/",
    "@platforms/": "./src/platforms/",
    "@skills/": "./src/skills/",
    "@types/": "./src/types/",
    "@utils/": "./src/utils/"
  },
  "tasks": {
    "dev": "deno run --watch --allow-net --allow-read --allow-write --allow-env src/main.ts",
    "start": "deno run --allow-net --allow-read --allow-write --allow-env src/main.ts",
    "test": "deno test --allow-read --allow-write",
    "fmt": "deno fmt src/",
    "lint": "deno lint src/",
    "check": "deno check src/main.ts"
  },
  "fmt": {
    "lineWidth": 100,
    "indentWidth": 2,
    "useTabs": false,
    "singleQuote": false,
    "proseWrap": "preserve"
  },
  "compilerOptions": {
    "strict": true
  }
}
```

### Deno Permissions

Required permissions for production:

| Permission  | Flag            | Purpose                                 |
| ----------- | --------------- | --------------------------------------- |
| Network     | `--allow-net`   | Discord API, Misskey API, web search    |
| Read        | `--allow-read`  | Local repo, working directories, config |
| Write       | `--allow-write` | Memory log files in workspaces          |
| Environment | `--allow-env`   | Read tokens and configuration           |

> [!WARNING]
> Never use `--allow-all` or overly permissive settings. Permissions must be explicitly declared.

---

## Appendix: Performance Metrics

The system should collect:

| Metric                   | Description               |
| ------------------------ | ------------------------- |
| `agent_session_duration` | Time per agent execution  |
| `platform_api_latency`   | Platform API call latency |
| `memory_file_size`       | Memory file sizes         |
| `active_sessions`        | Concurrent session count  |

Metrics can be exposed via logs or optional Prometheus integration.
