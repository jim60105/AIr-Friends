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

AIr-Friends is a conversational AI bot designed to:

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
│                              AIr-Friends                                    │
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
- Agent subprocesses are wrapped with `dumb-init` for proper signal forwarding and zombie process reaping, preventing memory leaks from orphaned child processes
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

During an active session, the `SESSION_ID` environment variable is set for the agent subprocess, containing the session identifier that skills use via `--session-id "$SESSION_ID"`.

**Available Skills:**

| Skill             | Purpose                                 | HTTP Endpoint                   | Handler         |
| ----------------- | --------------------------------------- | ------------------------------- | --------------- |
| `memory-save`     | Save new memory                         | POST /api/skill/memory-save     | MemoryHandler   |
| `memory-search`   | Search existing memories                | POST /api/skill/memory-search   | MemoryHandler   |
| `memory-patch`    | Update memory attributes                | POST /api/skill/memory-patch    | MemoryHandler   |
| `memory-stats`    | Get memory statistics                   | POST /api/skill/memory-stats    | MemoryHandler   |
| `memory-export`   | Export memories                         | POST /api/skill/memory-export   | MemoryHandler   |
| `send-reply`      | Send reply to platform                  | POST /api/skill/send-reply      | ReplyHandler    |
| `edit-reply`      | Edit a previously sent reply            | POST /api/skill/edit-reply      | ReplyHandler    |
| `get-message`     | Get a specific message                  | POST /api/skill/get-message     | ReplyHandler    |
| `fetch-context`   | Get additional platform data            | POST /api/skill/fetch-context   | ContextHandler  |
| `react-message`   | Add reaction to a message               | POST /api/skill/react-message   | ReactionHandler |
| `set-reminder`    | Set a scheduled reminder (conditional)  | POST /api/skill/set-reminder    | ReminderHandler |
| `cancel-reminder` | Cancel an active reminder (conditional) | POST /api/skill/cancel-reminder | ReminderHandler |
| `list-reminders`  | List active reminders (conditional)     | POST /api/skill/list-reminders  | ReminderHandler |
| `send-file`       | Send a file to platform (conditional)   | POST /api/skill/send-file       | FileHandler     |

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
> The normal message flow does **not** perform inline memory compression or summarization.
> Context size is controlled through fixed quotas and retrieval limits. Optional background memory maintenance is configured separately.

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
- `edit-reply` allows the Agent to edit a previously sent reply (requires the `messageId` returned by `send-reply`)

### Retry on Missing Reply

**Single Reply Rule with Retry**: The system enforces one reply per session, but if the agent completes without sending any reply, the system will:

1. Clear the reply state (`ReplyHandler.clearReplyState`)
2. Send a retry prompt: `"System message: You have a special turn. Regardless of whether you have already sent-reply, please send another send-reply."`
3. Check again if the reply was sent

The retry uses the same ACP connection and session — it calls `connector.prompt()` again on the existing `sessionId`. This is standard ACP protocol usage.

**Retry limit**: Maximum 1 retry attempt per session to prevent infinite loops.

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

| Field        | Description                                      |
| ------------ | ------------------------------------------------ |
| `id`         | Unique identifier                                |
| `ts`         | ISO 8601 timestamp                               |
| `enabled`    | Whether memory is active                         |
| `visibility` | `public` or `private`                            |
| `importance` | `high` (always loaded) or `normal` (searched)    |
| `content`    | Memory content (plain text)                      |
| `relatedTo`  | IDs of semantically related memories (optional)  |
| `supersedes` | IDs of memories this entry supersedes (optional) |

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

- Can only modify: `enabled`, `visibility`, `importance`, `relatedTo`, `supersedes`
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

**Memory Statistics:**

The `memory-stats` skill provides aggregate statistics about a workspace's memories (total counts, enabled/disabled breakdown, importance distribution) without returning actual memory content.

**Private Memory Access:**

- Both memory files exist in every workspace
- In DM context: reads/searches **both** `memory.private.jsonl` and `memory.public.jsonl`; saves to `memory.private.jsonl`
- In non-DM context: reads/searches only `memory.public.jsonl`; saves to `memory.public.jsonl`
- Non-DM contexts must not load or search private memories

### Agent Global Workspace

In addition to per-user memory workspaces, the Agent has a global workspace at `{workspace.repoPath}/agent-workspace/` for long-term knowledge storage.

**Design Decisions:**

- **Not pre-loaded in context**: Workspace content is NOT included in the system prompt or initial context. The agent reads files on-demand using `$AGENT_WORKSPACE` env var and bash commands.
- **Index-guided search**: `notes/_index.md` serves as a quick-reference index so the agent can decide which notes to read without loading everything.
- **Integrated with memory-search**: The `memory-search` skill searches both user memories AND agent workspace notes, returning results in separate sections (`userMemories` and `agentNotes`).
- **Privacy boundary**: User private information must use `memory-save` skill (per-user workspace). The agent workspace is for agent's own knowledge only.
- **Markdown format**: All files use `.md` for token efficiency and structure.

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

Primary configuration file: `config.yaml` (YAML format)

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
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 4096

memory:
  searchLimit: 10
  maxChars: 2000

workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
```

### Environment Variables

| Variable                   | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| `DISCORD_ENABLED`          | Enable Discord integration (true/false)                                    |
| `MISSKEY_ENABLED`          | Enable Misskey integration (true/false)                                    |
| `DISCORD_TOKEN`            | Discord bot token                                                          |
| `MISSKEY_HOST`             | Misskey instance host                                                      |
| `MISSKEY_TOKEN`            | Misskey access token                                                       |
| `AGENT_MODEL`              | LLM model identifier (e.g., "gpt-5-mini")                                  |
| `AGENT_DEFAULT_TYPE`       | ACP agent type (opencode)                                                  |
| `REPLY_POLICY`             | Reply policy mode (`all`/`public`/`channels`) (REPLY_TO accepted as alias) |
| `CHANNELS`                 | Channel entries (JSON array, replaces config)                              |
| `LOG_LEVEL`                | Logging level (DEBUG/INFO/WARN/ERROR)                                      |
| `DENO_ENV`                 | Environment name (dev/prod)                                                |
| `GITHUB_TOKEN`             | GitHub token for git-backup / git-credential store                        |
| `GEMINI_API_KEY`           | API key for the OpenCode Gemini provider                                   |
| `OPENCODE_API_KEY`         | OpenCode API key                                                           |
| `OPENROUTER_API_KEY`       | OpenRouter API key                                                         |
| `MODEL_ROUTING_ENABLED`    | Enable model routing (true/false, default: false)                          |
| `MODEL_ROUTING_RULES`      | Model routing rules as JSON string                                         |
| `AGENT_EXTERNAL_SKILLS`    | External skills to install at startup (JSON string)                        |
| `GIT_BACKUP_AUTH_USER`     | Git backup HTTPS auth username (default: authorEmail)                      |
| `GIT_BACKUP_AUTH_PASSWORD` | Git backup HTTPS auth password/token (default: GITHUB_TOKEN)               |

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

- **opencode** - OpenCode CLI (latest release)
- **rg** (ripgrep 15.1.0) - For memory search operations
- **curl** - For health checks
- **dumb-init** - For proper signal handling as PID 1 and wrapping agent subprocesses

**Multi-Stage Build:**

```dockerfile
# Stage 1: Unpack binaries (opencode, ripgrep)
FROM base AS opencode-unpacker
# ... download and extract opencode

FROM base AS ripgrip-unpacker
# ... download and extract ripgrep

# Stage 2: Cache dependencies
FROM base AS cache
WORKDIR /app
COPY deno.json deno.lock ./
COPY src/ ./src/
RUN deno cache --lock=deno.lock src/main.ts

# Stage 3: Final runtime
FROM base AS final
WORKDIR /app
# Copy binaries from unpack stages
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
# Copy OpenCode configuration (contains both "build" and "yolo" agents;
# default_agent: "build" ensures restricted mode by default)
COPY agent-config/opencode.json /home/deno/.config/opencode/opencode.json

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
├── src/
│   ├── main.ts              # Entry point
│   ├── bootstrap.ts         # Application bootstrap
│   ├── shutdown.ts          # Graceful shutdown handler
│   ├── healthcheck.ts       # Health check server
│   ├── acp/                 # ACP Client integration
│   │   ├── agent-connector.ts
│   │   ├── agent-factory.ts
│   │   ├── client.ts
│   │   └── types.ts
│   ├── core/                # Core logic (agent, memory, workspace)
│   │   ├── agent-core.ts
│   │   ├── session-orchestrator.ts
│   │   ├── workspace-manager.ts
│   │   ├── memory-store.ts
│   │   ├── context-assembler.ts
│   │   ├── message-handler.ts
│   │   ├── reply-dispatcher.ts
│   │   ├── reply-policy.ts
│   │   ├── config-loader.ts
│   │   ├── template-renderer.ts
│   │   ├── skill-installer.ts
│   │   ├── spontaneous-scheduler.ts
│   │   ├── spontaneous-target.ts
│   │   ├── channel-lurk-scheduler.ts
│   │   ├── self-research-scheduler.ts
│   │   ├── memory-maintenance-scheduler.ts
│   │   ├── reminder-scheduler.ts
│   │   ├── reminder-store.ts
│   │   ├── rate-limiter.ts
│   │   ├── model-router.ts
│   │   ├── event-router.ts
│   │   ├── error-handler.ts
│   │   ├── audit-logger.ts
│   │   ├── audit-retention.ts
│   │   ├── audit-retention-scheduler.ts
│   │   ├── git-backup-service.ts
│   │   ├── git-backup-scheduler.ts
│   │   ├── git-credential-setup.ts
│   │   └── scheduler-state-store.ts
│   ├── platforms/           # Platform adapters (Discord, Misskey)
│   │   ├── platform-adapter.ts
│   │   ├── platform-registry.ts
│   │   ├── discord/
│   │   └── misskey/
│   ├── skills/              # Skill handlers
│   │   ├── registry.ts
│   │   ├── memory-handler.ts
│   │   ├── reply-handler.ts
│   │   ├── context-handler.ts
│   │   ├── reaction-handler.ts
│   │   ├── reminder-handler.ts
│   │   ├── file-handler.ts
│   │   └── types.ts
│   ├── skill-api/           # HTTP API for shell skills
│   │   ├── server.ts
│   │   └── session-registry.ts
│   ├── types/               # TypeScript type definitions
│   │   ├── audit.ts
│   │   ├── config.ts
│   │   ├── context.ts
│   │   ├── errors.ts
│   │   ├── events.ts
│   │   ├── logger.ts
│   │   ├── memory.ts
│   │   ├── platform.ts
│   │   ├── reminder.ts
│   │   ├── template.ts
│   │   └── workspace.ts
│   └── utils/               # Utility functions
│       ├── logger.ts
│       ├── env.ts
│       ├── metrics.ts
│       ├── hash.ts
│       ├── rss-fetcher.ts
│       ├── gelf-transport.ts
│       ├── path-validator.ts
│       ├── text-search.ts
│       └── token-counter.ts
├── skills/                  # Shell-based skill scripts
│   ├── memory-save/
│   ├── memory-search/
│   ├── memory-patch/
│   ├── memory-stats/
│   ├── memory-export/
│   ├── send-reply/
│   ├── edit-reply/
│   ├── get-message/
│   ├── fetch-context/
│   ├── react-message/
│   ├── set-reminder/
│   ├── cancel-reminder/
│   ├── list-reminders/
│   ├── send-file/
│   ├── self-research/
│   ├── agent-browser/
│   ├── chinese-content-writing-guideline/
│   └── lib/                 # Shared skill client library
├── prompts/                 # Bot prompt files (template system)
│   ├── system_reply.md      # Normal message reply system prompt
│   ├── character_name.md    # Replaces {{character_name}}
│   ├── character_info.md    # Replaces {{character_info}}
│   └── ...                  # Any .md file becomes a placeholder source
├── config/                  # Configuration examples
├── docs/                    # Documentation & BDD features
│   ├── DESIGN.md            # Design document
│   ├── SKILLS_IMPLEMENTATION.md
│   └── features/            # Gherkin feature specs
└── tests/                   # Test files
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

| Permission  | Flag            | Purpose                                           |
| ----------- | --------------- | ------------------------------------------------- |
| Network     | `--allow-net`   | Discord API, Misskey API, web search              |
| Read        | `--allow-read`  | Local repo, working directories, config           |
| Write       | `--allow-write` | Memory log files in workspaces                    |
| Environment | `--allow-env`   | Read tokens and configuration                     |
| Run         | `--allow-run`   | Spawning ACP agent subprocesses and skill scripts |

> [!WARNING]
> Never use `--allow-all` or overly permissive settings. Permissions must be explicitly declared.

---

## Self-Research via RSS/Atom Feeds

The self-research feature allows the agent to autonomously build knowledge by periodically reading RSS feeds, selecting topics of interest (in character), and writing research notes to the agent workspace.

### Components

| Component    | File                                  | Purpose                                           |
| ------------ | ------------------------------------- | ------------------------------------------------- |
| Config types | `src/types/config.ts`                 | `SelfResearchConfig`, `RssFeedSource` interfaces  |
| RSS Fetcher  | `src/utils/rss-fetcher.ts`            | Fetch and parse RSS 2.0 / Atom feeds              |
| Scheduler    | `src/core/self-research-scheduler.ts` | Timer management (mirrors SpontaneousScheduler)   |
| Session Flow | `src/core/session-orchestrator.ts`    | `processSelfResearch()` method                    |
| Prompt       | `prompts/system_self_research.md`     | Research instructions with character placeholders |

### Flow

1. Scheduler triggers at random interval (default 12-24h)
2. RSS items fetched from configured sources
3. 20 random items selected as reference materials
4. Agent receives character-aware prompt with materials
5. Agent checks existing notes, picks new topic, researches via web
6. Agent writes notes to `agent-workspace/notes/` with character voice
7. No platform reply sent — internal operation only

### Configuration

See `config.example.yaml` for the `selfResearch` section. Environment variables: `SELF_RESEARCH_ENABLED`, `SELF_RESEARCH_MODEL`, `SELF_RESEARCH_RSS_FEEDS` (JSON), `SELF_RESEARCH_MIN_INTERVAL_MS`, `SELF_RESEARCH_MAX_INTERVAL_MS`.

### Untrusted-content delimiting (F16)

Self-research is the only session type that both ingests external RSS content and
is authorized to write shared agent-workspace notes, so feed text is treated as
untrusted. `formatUntrustedRssBlock` (`src/core/session-orchestrator.ts`) wraps each
interpolated item in distinctive `⟪UNTRUSTED_EXTERNAL_ARTICLE⟫ … ⟪END_UNTRUSTED_EXTERNAL_ARTICLE⟫`
markers and prefixes the block with a directive not to follow any instructions
contained within, so the model treats feed content as data rather than as prompt
instructions. Upstream markup stripping and 300-char truncation (`rss-fetcher.ts`)
limit an item's ability to forge the end marker. This is a proportionate mitigation
for a LOW-severity, default-off feature — not a guarantee against prompt injection.

Deferred future work (F16 D2): provenance-tag notes derived from external feed
content and optionally require operator review before such notes become readable
by user-facing sessions. This addresses the shared-store sink (the complement of
run-1's F3 session-type write-gate, and related to F15's channel-memory write path)
rather than only the source, and is left deferred given the LOW severity.

---

## Memory Maintenance

The memory maintenance feature periodically compacts old memories in each user workspace using the existing memory skills and append-only patch model.

### Components

| Component    | File                                       | Purpose                                                           |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| Config types | `src/types/config.ts`                      | `MemoryMaintenanceConfig` interface                               |
| Scheduler    | `src/core/memory-maintenance-scheduler.ts` | Fixed-interval timer management                                   |
| Session Flow | `src/core/session-orchestrator.ts`         | `processMemoryMaintenance()` method                               |
| Prompt       | `prompts/system_memory_maintenance.md`     | English maintenance instructions with placeholders                |
| Integration  | `src/bootstrap.ts`                         | Workspace iteration, threshold check, and per-workspace isolation |

### Flow

1. Scheduler triggers at fixed interval (`intervalMs`, default 7 days)
2. Bootstrap callback lists all workspaces
3. For each workspace, enabled-memory count is calculated
4. Workspaces below `minMemoryCount` are skipped
5. For eligible workspaces, one agent session runs maintenance
6. Agent saves high-importance summaries and disables covered originals via patch events
7. Failures are isolated per workspace; processing continues for others

### Configuration

See `config.example.yaml` for the `memoryMaintenance` section. Environment variables: `MEMORY_MAINTENANCE_ENABLED`, `MEMORY_MAINTENANCE_MODEL`, `MEMORY_MAINTENANCE_MIN_MEMORY_COUNT`, `MEMORY_MAINTENANCE_INTERVAL_MS`.

---

## Scheduled Reminders

Enables users to set one-time reminders via DM conversations. The bot polls for due reminders at fixed intervals and delivers them via DM using an ACP agent session.

### Components

| Component    | File                                                                        | Purpose                                     |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------- |
| Store        | `src/core/reminder-store.ts`                                                | Append-only JSONL persistence per workspace |
| Scheduler    | `src/core/reminder-scheduler.ts`                                            | Fixed-interval polling for due reminders    |
| Handler      | `src/skills/reminder-handler.ts`                                            | Skill handlers for set/cancel/list          |
| Orchestrator | `src/core/session-orchestrator.ts`                                          | `processReminder()` — ACP delivery session  |
| Shell Skills | `skills/set-reminder/`, `skills/cancel-reminder/`, `skills/list-reminders/` | Agent-facing skill scripts                  |
| Prompt       | `prompts/system_reminder.md`                                                | Delivery prompt template                    |

### Flow

1. User sends DM asking to set a reminder → Agent calls `set-reminder` skill
2. `ReminderHandler` validates, stores entry in `{workspace}/reminders.jsonl`
3. `ReminderScheduler` polls every `checkIntervalMs` (default: 30s)
4. Due reminders found → `SessionOrchestrator.processReminder()` creates ACP session
5. Agent delivers reminder via `send-reply` skill to user's DM
6. On success, reminder is disabled via patch event

### Key Constraints

- **DM-only**: All reminder operations require DM context
- **One-time**: No recurring/cron support
- **One per session**: Only one `set-reminder` call per conversation turn
- **Per-user limit**: Maximum active reminders configurable (default: 20)
- **Restart-safe**: Polling picks up overdue reminders automatically
- **Permanent failure**: If DM channel cannot be resolved, reminder is auto-cancelled

### Configuration

See `config.example.yaml` for the `reminders` section. Environment variables: `REMINDERS_ENABLED`, `REMINDERS_MAX_PER_USER`, `REMINDERS_MIN_INTERVAL_MS`, `REMINDERS_PERSIST_PATH`, `REMINDERS_CHECK_INTERVAL_MS`.

---

## Rate Limiting & Cooldown

Prevents excessive API usage per user via a sliding window + cooldown mechanism.

**Configuration:**

```yaml
rateLimit:
  enabled: false
  maxRequestsPerWindow: 10
  windowMs: 600000
  cooldownMs: 600000
```

Each user is tracked by `{platform}:{userId}`. When `maxRequestsPerWindow` is exceeded, the user enters a cooldown period where all requests are silently rejected. After cooldown expires, the counter resets. Whitelisted accounts (`{platform}/account/{id}`) automatically bypass rate limiting.

Environment variables: `RATE_LIMIT_ENABLED`, `RATE_LIMIT_MAX_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_COOLDOWN_MS`.

---

## Session Audit Log

Per-session JSONL audit trail for replay and debugging. Each session writes timestamped entries tracking the full lifecycle: context assembly, agent connection, prompt, skill calls, reply, and session end.

**Configuration:**

```yaml
audit:
  enabled: false
  retentionDays: 7
  hashContent: true
  includedPhases:
    - "skill_call"
    - "reply_sent"
    - "session_end"
```

Audit files are written to `data/audit/{platform}/{userId}/{sessionId}.jsonl`. Phase filtering controls which events are recorded. Content hashing (SHA-256) protects user content in audit entries. Retention cleanup runs at startup and every 24 hours.

Environment variables: `AUDIT_ENABLED`, `AUDIT_RETENTION_DAYS`, `AUDIT_HASH_CONTENT`, `AUDIT_INCLUDED_PHASES` (comma-separated).

**Key Components:** `src/core/audit-logger.ts`, `src/core/audit-retention.ts`, `src/core/audit-retention-scheduler.ts`, `src/types/audit.ts`.

---

## Channel Lurk Reply

Periodically checks whitelisted Discord channels and auto-replies when conditions are met. Discord only.

**Configuration:**

```yaml
platforms:
  discord:
    channelLurk:
      enabled: false
      intervalMs: 1800000
```

**Trigger conditions** (all must be true): last message sender is not the bot, message does not mention the bot, bot has not reacted to the message, and message has not been processed before. Uses the normal reply prompt template (`system_reply.md`).

Environment variables: `DISCORD_CHANNEL_LURK_ENABLED`, `DISCORD_CHANNEL_LURK_INTERVAL_MS`.

---

## External Skill Auto-Installation

Enables automatic installation of external Agent Skills at startup via `deno x -y skills add`.

**Configuration:**

```yaml
agent:
  externalSkills:
    - repo: "jim60105/copilot-prompt"
      skill: "create-blog-post"
```

Skills are installed sequentially during `bootstrap()`. Individual failures are logged but do not block startup.

Environment variable: `AGENT_EXTERNAL_SKILLS` (JSON string, e.g. `[{"repo":"owner/repo","skill":"skill-name"}]`).

---

## Model Routing

Enables dynamic model selection based on channel, session type, or message content keywords. First-match-wins evaluation with fallback to the default model.

**Configuration:**

```yaml
agent:
  modelRouting:
    enabled: false
    rules:
      - match:
          channel: "discord/account/123456"
        model: "claude-opus-4.6"
      - match:
          sessionType: "self-research"
        model: "gpt-5-mini"
      - match:
          contentKeywords: ["code", "programming"]
        model: "claude-sonnet-4"
```

Match conditions use AND logic across fields; `contentKeywords` uses OR within the array (case-insensitive). `contentKeywords` is only effective for `sessionType: "message"`.

Environment variables: `MODEL_ROUTING_ENABLED`, `MODEL_ROUTING_RULES` (JSON string).

**Key Component:** `src/core/model-router.ts`.

---

## Multimedia Message Handling

Supports passing image and file attachments from platform messages to the ACP Agent.

Attachment metadata (URL, mimeType, filename, size) is extracted by platform adapters and carried in `NormalizedEvent` / `PlatformMessage`. Attachment info is always included as text descriptions in context. When the Agent supports `promptCapabilities.image`, trigger message images are downloaded and sent as image `ContentBlock`. History message images are described by URL only. Images over 20 MB or failing download (10s timeout) are described by URL instead.

**Platform sources:** Discord `message.attachments` + `message.stickers`; Misskey `note.files` + `message.file`.

---

## Dry Run Mode

When enabled, the system assembles context but does NOT call the ACP Agent. The assembled prompt is written to an output directory for prompt engineering and CI/CD smoke testing.

**Configuration:**

```yaml
agent:
  dryRun:
    enabled: false
    outputPath: "./data/dry-run/"
    mockReply: "（Dry run 模式 — 此為測試回覆）"
```

Environment variables: `DRY_RUN_ENABLED`, `DRY_RUN_OUTPUT_PATH`, `DRY_RUN_MOCK_REPLY`.

---

## Git Backup

Periodically backs up the `data/` directory to a remote GitHub repository using Git.

**Configuration:**

```yaml
gitBackup:
  enabled: false
  remoteUrl: ""
  intervalMs: 3600000
  authorName: "AIr-Friends Backup"
  authorEmail: "airfriends-backup@noreply.github.com"
```

Initialization is intelligent: handles empty directories (clone), non-Git directories (init + push), and existing repos (commit + push). Push conflicts trigger automatic rebase retry with `backup-{datetime}` fallback branch. A final backup runs during graceful shutdown.

Environment variables: `GIT_BACKUP_ENABLED`, `GIT_BACKUP_REMOTE_URL`, `GIT_BACKUP_INTERVAL_MS`, `GIT_BACKUP_AUTHOR_NAME`, `GIT_BACKUP_AUTHOR_EMAIL`, `GIT_BACKUP_AUTH_USER`, `GIT_BACKUP_AUTH_PASSWORD`.

**Key Components:** `src/core/git-backup-service.ts`, `src/core/git-backup-scheduler.ts`.

---

## Agent Sandbox Hardening

Agent subprocesses run with configurable sandbox isolation via `SandboxManager`.

| Setting                                | Default           | Description                                        |
| -------------------------------------- | ----------------- | -------------------------------------------------- |
| `agent.sandbox.filterEnv`              | `true`            | Filter subprocess env vars to an allowed list only |
| `agent.sandbox.networkIsolation`       | `false`           | Wrap command with `unshare --net` (Linux only)     |
| `agent.sandbox.allowedEnvVars`         | `[]`              | Additional env var names to pass through           |
| `agent.sandbox.allowedWriteExtensions` | `[".md", ".txt"]` | Allowed file extensions for workspace writes       |

Environment variables: `AGENT_SANDBOX_FILTER_ENV`, `AGENT_SANDBOX_NETWORK_ISOLATION`, `AGENT_SANDBOX_ALLOWED_ENV_VARS` (comma-separated), `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` (comma-separated).

---

## Idle Timeout Detection

Detects silently unresponsive ACP Agent connections and handles recovery. All Agent callbacks update a `lastActivityTimestamp`. A periodic monitor checks for inactivity, performs liveness checks (subprocess alive + `cancel()` probe), and throws on dead connections.

| Setting                             | Default  | Description                   |
| ----------------------------------- | -------- | ----------------------------- |
| `agent.idleTimeout.enabled`         | `true`   | Enable idle timeout detection |
| `agent.idleTimeout.timeoutMs`       | `300000` | Idle timeout (5 min)          |
| `agent.idleTimeout.checkIntervalMs` | `30000`  | Check interval (30s)          |

Environment variables: `AGENT_IDLE_TIMEOUT_ENABLED`, `AGENT_IDLE_TIMEOUT_MS`, `AGENT_IDLE_TIMEOUT_CHECK_INTERVAL_MS`.

---

## Connect-Time Handshake Timeout

Bounds how long `connect()` may wait for the ACP handshake (`connection.initialize()`) to complete, independent of idle-timeout (which only covers `prompt()`). Also, every outbound ACP call (`initialize`, `createSession`, `setSessionModel`, `setSessionMode`, `setSessionConfigOption`, `prompt`, `cancel`) is raced against a per-subprocess crash signal that rejects immediately if the agent subprocess exits unexpectedly, instead of leaving the call pending forever — see `openspec/changes/handle-agent-process-crash/design.md` for the full rationale.

| Setting                   | Default | Description                                          |
| -------------------------- | ------- | ----------------------------------------------------- |
| `agent.connectTimeoutMs`   | `30000` | Max time to wait for the ACP handshake during `connect()` (30s) |

Environment variable: `AGENT_CONNECT_TIMEOUT_MS`.

The 30s default is chosen by convention (matching the idle-timeout default), not from measured production connect-latency data. A `WARN` is logged once elapsed time passes 80% of the timeout, giving operators an early signal before a hard failure; the default should be revisited once real rollout data accumulates.

---

## Git Credential Store for Agent

When `agent.gitCredential.enabled` is true, bootstrap writes a `~/.git-credentials` file and configures `git config --global credential.helper store` so Agent subprocesses can use plain `git push`/`git pull` without embedding credentials in command strings. Credential source is shared with `gitBackup` config. Host resolution order: `agent.gitCredential.host` → parsed from `gitBackup.remoteUrl` → `github.com`.

Environment variables: `AGENT_GIT_CREDENTIAL_ENABLED`, `AGENT_GIT_CREDENTIAL_HOST`.

---

## Prometheus Metrics Export

Operational metrics are exposed via a Prometheus-compatible `/metrics` endpoint on the Health Check Server (shared port, no additional port needed). Uses `prom-client` with a dedicated Registry for test isolation.

**Configuration:**

```yaml
metrics:
  enabled: false
  path: "/metrics"
```

Environment variables: `METRICS_ENABLED`, `METRICS_PATH`.

**Exposed Metrics:**

| Metric Name                              | Type      | Labels                       | Description                      |
| ---------------------------------------- | --------- | ---------------------------- | -------------------------------- |
| `airfriends_sessions_total`              | Counter   | `platform`, `type`, `status` | Total sessions (success/failure) |
| `airfriends_session_duration_seconds`    | Histogram | `platform`, `type`, `status` | Session processing time          |
| `airfriends_active_sessions`             | Gauge     | —                            | Currently active sessions        |
| `airfriends_messages_received_total`     | Counter   | `platform`                   | Messages received from platforms |
| `airfriends_replies_sent_total`          | Counter   | `platform`                   | Replies sent to platforms        |
| `airfriends_memory_operations_total`     | Counter   | `operation`, `visibility`    | Memory operations count          |
| `airfriends_skill_api_calls_total`       | Counter   | `skill`, `status`            | Skill API call count             |
| `airfriends_rate_limit_rejections_total` | Counter   | `platform`                   | Rate limit rejections            |
| `airfriends_audit_entries_total`         | Counter   | `phase`                      | Audit log entries written        |
| `airfriends_skill_readiness`             | Gauge     | `skill`                      | Skill readiness (0/1)            |
| `airfriends_files_sent_total`            | Counter   | `platform`                   | Files sent to platforms          |
| `airfriends_reminders_set_total`         | Counter   | `platform`                   | Reminders set                    |
| `airfriends_reminders_delivered_total`   | Counter   | `platform`, `status`         | Reminders delivered              |
| `airfriends_reminders_cancelled_total`   | Counter   | `platform`                   | Reminders cancelled              |
| `airfriends_idle_timeout_total`          | Counter   | `platform`, `outcome`        | Idle timeout detections          |
