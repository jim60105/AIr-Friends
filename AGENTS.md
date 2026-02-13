# AIr-Friends - Development Guide for AI Agents

This document provides comprehensive guidance for AI agents working on the AIr-Friends project. It covers architecture, coding standards, build processes, and key design decisions.

## Project Overview

AIr-Friends is a multi-platform conversational AI bot that acts as an **ACP (Agent Client Protocol) Client**, delegating AI reasoning to external agents (GitHub Copilot CLI, Gemini CLI, OpenCode CLI) while maintaining persistent cross-conversation memory.

**Key Concepts:**

- **We are the ACP Client**: We spawn and communicate with external ACP Agents
- **External CLI tools are the Agents**: GitHub Copilot CLI, Gemini CLI, OpenCode CLI execute AI tasks
- **Skills are shell-based**: We provide Deno TypeScript skill scripts that Agents can execute
- **Skill API Server**: HTTP server for skills to communicate back to the main bot
- **Workspace isolation**: Each conversation context has its own isolated working directory

## Technology Stack

| Component       | Technology               | Version       |
| --------------- | ------------------------ | ------------- |
| Runtime         | Deno                     | 2.x           |
| Language        | TypeScript               | (Deno native) |
| ACP SDK         | @agentclientprotocol/sdk | 0.14.1        |
| Discord Library | discord.js               | ^14.0.0       |
| Misskey Library | misskey-js               | 2025.12.2     |
| Configuration   | YAML (via @std/yaml)     | -             |
| Testing         | Deno.test + @std/assert  | -             |

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                 AIr-Friends (ACP CLIENT)                    │
├─────────────────────────────────────────────────────────────┤
│  Platform Adapters (Discord/Misskey)                        │
│           ↓                                                 │
│  AgentCore → SessionOrchestrator                            │
│           ↓                                                 │
│  AgentConnector → ACP ClientSideConnection                  │
│           ↓ (spawn subprocess, stdio JSON-RPC)              │
├─────────────────────────────────────────────────────────────┤
│           External ACP AGENTS                               │
│  (GitHub Copilot CLI / Gemini CLI / OpenCode CLI)           │
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

| Directory                  | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `src/core/`                | Agent session, workspace manager, context assembly     |
| `src/core/reply-policy.ts` | Access control and reply policy evaluation             |
| `src/acp/`                 | ACP Client integration, agent connector                |
| `src/platforms/`           | Platform adapters (Discord, Misskey)                   |
| `src/skills/`              | Internal skill handlers (memory, reply, context)       |
| `src/skill-api/`           | HTTP server for shell-based skills                     |
| `src/types/`               | TypeScript type definitions                            |
| `src/utils/`               | Logging, configuration loading, utilities              |
| `skills/`                  | Shell-based skill scripts (executed by external agent) |

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
deno run --allow-net --allow-read --allow-write --allow-env --allow-run src/main.ts
```

**Never use `--allow-all`**. Required permissions:

| Permission      | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `--allow-net`   | Discord API, Misskey API, external connections    |
| `--allow-read`  | Configuration files, workspace files, memory logs |
| `--allow-write` | Memory log files in workspace directories         |
| `--allow-env`   | Environment variables (tokens, configuration)     |
| `--allow-run`   | Spawning ACP agent subprocesses and skill scripts |

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

- `workspace_key = "{platform}/{user_id}"`
- **Workspace is per-user**, not per-channel — the same user's memories are shared across all channels/threads they interact in
- Each workspace is an isolated directory under `repo/workspaces/`
- Agent sessions use workspace path as current working directory (cwd)
- No cross-workspace file access allowed
- A `SESSION_ID` file is created in the workspace during active sessions

```typescript
// Workspace path structure
const workspacePath = `${config.workspace.repo_path}/workspaces/${platform}/${userId}`;
```

#### Agent Global Workspace (Feature 15)

In addition to per-user workspaces, the Agent has a global workspace at `{workspace.repoPath}/agent-workspace/` for storing cross-conversation knowledge, research notes, and reflections.

- **Not per-user**: Shared across all conversations and users
- **Markdown-based**: All files use `.md` format for token efficiency
- **Not pre-loaded**: Content is NOT included in initial context; Agent reads on-demand via `$AGENT_WORKSPACE` env var
- **Index-guided**: `notes/_index.md` serves as a quick-reference index
- **Privacy boundary**: User private data must NOT be stored here (use `memory-save` instead)

```
data/agent-workspace/
├── README.md              # Workspace usage guide
├── notes/                 # Knowledge notes by topic
│   ├── _index.md          # Notes index (agent-maintained)
│   └── {topic-slug}.md    # Individual topic files
└── journal/               # Daily reflections
    └── {YYYY-MM-DD}.md    # Daily entries
```

The `memory-search` skill automatically searches both user memories and agent workspace notes, returning results in separate `userMemories` and `agentNotes` sections.

### 2. Context Assembly (Feature 02)

Initial context comprises:

| Source                   | Limit               |
| ------------------------ | ------------------- |
| High-importance memories | All enabled         |
| Recent channel messages  | 20 messages (fixed) |
| Guild-related context    | Configurable        |

**No automatic memory compression or summarization during normal message handling**.
Optional scheduled memory maintenance can be enabled separately.

**`/clear` Command:**

When a message starts with `/clear`, it acts as a context reset command:

- **If the trigger message itself is `/clear`**: The system immediately returns without executing the agent or sending any reply, as this is purely a command, not a conversation requiring a response.
- **If `/clear` appears in recent message history**: When assembling context, the system drops that message and everything before it—only messages after the last `/clear` are included. This lets users reset conversation context within the same channel (e.g., Discord DMs where switching channels is impractical).

The command only affects recent channel messages, not memories or guild-related context.

### 3. Memory System (Feature 03)

Append-only JSONL files (both exist in every workspace):

- `memory.public.jsonl` - Public memories
- `memory.private.jsonl` - Private memories

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

- Skills are Deno TypeScript scripts in `skills/{skill-name}/scripts/` directories
- Each skill has a `SKILL.md` file describing its usage for the agent
- External Agents execute these scripts with `--session-id` parameter
- Scripts use shared client library in `skills/lib/client.ts`
- Scripts call back to main bot via HTTP API (Skill API Server on localhost:3001)
- Session-based authentication ensures security
- A `SESSION_ID` file is created in the workspace with the active session ID

**Available Skills**:

| Skill           | Purpose                      | HTTP Endpoint                 |
| --------------- | ---------------------------- | ----------------------------- |
| `memory-save`   | Save new memory              | POST /api/skill/memory-save   |
| `memory-search` | Search existing memories     | POST /api/skill/memory-search |
| `memory-patch`  | Update memory attributes     | POST /api/skill/memory-patch  |
| `memory-stats`  | Get memory statistics        | POST /api/skill/memory-stats  |
| `fetch-context` | Get additional platform data | POST /api/skill/fetch-context |
| `send-reply`    | Send final reply (max 1)     | POST /api/skill/send-reply    |

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
    parameters: { content: "User likes TypeScript", visibility: "public" },
  }),
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
- **Chat Channel ID**: Private chat messages use `chat:{userId}` as channel ID, supporting Misskey's chat feature for 1-on-1 messaging
- **Bot Filtering**: `shouldRespondToNote()` and `shouldRespondToChatMessage()` check `user.isBot` / `fromUser?.isBot` to ignore messages from bot accounts, preventing multi-instance infinite loops. Bot messages in recent history are correctly marked as `[Bot]` via `isBot` in `noteToPlatformMessage()` and `chatMessageToPlatformMessage()`.

**Misskey Channel Types**:

| Channel ID Format | Description                          | API Endpoint                                                  |
| ----------------- | ------------------------------------ | ------------------------------------------------------------- |
| `note:{noteId}`   | Public note conversation thread      | `notes/replies`, `notes/create`                               |
| `dm:{userId}`     | Direct message via specified notes   | `notes/mentions`                                              |
| `chat:{userId}`   | Private chat room with specific user | `chat/messages/user-timeline`, `chat/messages/create-to-user` |

### 6. ACP Client Integration

We use `@agentclientprotocol/sdk` for Client-side connection:

**AgentConnector** (`src/acp/agent-connector.ts`):

- Spawns external ACP agent as subprocess (copilot/gemini/opencode CLI)
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

- **GitHub Copilot CLI** (`copilot`) - Commercial agent from GitHub, requires `GITHUB_TOKEN`
- **Gemini CLI** (`gemini`) - Google's Gemini CLI, requires `GEMINI_API_KEY`
- **OpenCode CLI** (`opencode`) - Open source coding agent that supports multiple providers:
  - Gemini provider (uses `GEMINI_API_KEY` env var)
  - OpenRouter provider (uses `OPENROUTER_API_KEY` env var)
  - Pre-configured in container with `opencode.json`

**Agent Selection**:

- Set via `agent.defaultAgentType` in config or `AGENT_DEFAULT_TYPE` env var
- Valid values: `"copilot"`, `"gemini"`, or `"opencode"`
- Container includes pre-installed binaries for all three agents

**Retry on Missing Reply**:

When an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without calling the `send-reply` skill, the system automatically retries:

1. Clears the reply state to allow a new reply
2. Sends a second prompt on the **same ACP session** with a system message requesting the agent to send a reply
3. If the retry also fails to produce a reply, the system returns a failure response

This retry mechanism uses `connector.prompt()` on the existing session — no CLI-level resume or `loadSession()`/`resumeSession()` is needed.

The retry strategy is configured per agent type via `getRetryPromptStrategy()` in `src/acp/agent-factory.ts`:

| Agent    | Max Retries | Retry Supported |
| -------- | ----------- | --------------- |
| Copilot  | 1           | Yes             |
| OpenCode | 1           | Yes             |
| Gemini   | 1           | Yes             |

### 7. Access Control & Reply Policy (Feature 13)

Controls bot reply behavior through the `accessControl` section in `config.yaml`.

**Reply Policy Modes:**

| Mode        | Behavior                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| `all`       | Reply to everyone in both public channels and DMs                             |
| `public`    | Reply in public channels only; DMs only if the account/channel is whitelisted |
| `whitelist` | Reply only to whitelisted accounts/channels (default)                         |

**Whitelist Format:**

```text
{platform}/account/{account_ID}
{platform}/channel/{channel_ID}
```

**Processing Order:**

1. Platform-level filters (bot self-check, `allowDm`, `respondToMention`)
2. Access control (`ReplyPolicyEvaluator.shouldReply()`)
3. Message handling and agent execution

**Configuration Example:**

```yaml
accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/123456789012345678"
    - "discord/channel/987654321098765432"
    - "misskey/account/abcdef1234567890"
```

**Environment Variable Overrides:**

- `REPLY_TO` -> sets `accessControl.replyTo`
- `WHITELIST` -> sets `accessControl.whitelist` (comma-separated, fully replaces config file value)

```bash
REPLY_TO=public
WHITELIST=discord/account/123456789,discord/channel/987654321,misskey/account/abcdef123
```

### 7a. Rate Limiting & Cooldown

Prevents excessive API usage per user via a sliding window + cooldown mechanism. Complements access control: access control decides "who can", rate limiting decides "how often".

**Configuration:**

```yaml
rateLimit:
  enabled: false
  maxRequestsPerWindow: 10
  windowMs: 600000        # 10-minute sliding window
  cooldownMs: 600000      # Cooldown after limit exceeded
```

**How It Works:**

1. Each user is tracked independently by `{platform}:{userId}` key
2. Requests within the sliding window are counted
3. When `maxRequestsPerWindow` is exceeded, the user enters a cooldown period
4. During cooldown, all requests are silently rejected (no reply, no session started)
5. After cooldown expires, the counter resets and the user can send requests again
6. Rate limit check runs **after** duplicate event detection and **before** any resource allocation

**Environment Variable Overrides:**

- `RATE_LIMIT_ENABLED` → `rateLimit.enabled`
- `RATE_LIMIT_MAX_REQUESTS_PER_WINDOW` → `rateLimit.maxRequestsPerWindow`
- `RATE_LIMIT_WINDOW_MS` → `rateLimit.windowMs`
- `RATE_LIMIT_COOLDOWN_MS` → `rateLimit.cooldownMs`

### 8. Spontaneous Posting (Feature 14)

Enables the bot to post messages/notes on its own schedule without user triggers.

**Configuration (per-platform):**

```yaml
platforms:
  discord:
    spontaneousPost:
      enabled: false # Enable spontaneous posting (default: false)
      minIntervalMs: 10800000 # Minimum interval: 3 hours (default)
      maxIntervalMs: 43200000 # Maximum interval: 12 hours (default)
      contextFetchProbability: 0.5 # Probability of including recent messages (0.0-1.0)
```

**How It Works:**

1. `SpontaneousScheduler` manages per-platform independent timers
2. Each execution picks a random interval between min and max
3. On trigger, the scheduler:
   - Determines a target (Discord: random whitelist entry; Misskey: `timeline:self`)
   - Randomly decides whether to fetch recent messages based on `contextFetchProbability`
   - Calls `SessionOrchestrator.processSpontaneousPost()` to run the agent
4. The agent receives a special prompt instructing it to create original content
5. Errors never crash the bot — the next execution is always scheduled

**Platform Target Selection:**

| Platform | Target Selection                                               |
| -------- | -------------------------------------------------------------- |
| Discord  | Random channel/account from whitelist (DM for account entries) |
| Misskey  | Bot's own timeline (`timeline:self`) — creates a new note      |

**Environment Variable Overrides:**

- `DISCORD_SPONTANEOUS_ENABLED` → `platforms.discord.spontaneousPost.enabled`
- `DISCORD_SPONTANEOUS_MIN_INTERVAL_MS` → `platforms.discord.spontaneousPost.minIntervalMs`
- `DISCORD_SPONTANEOUS_MAX_INTERVAL_MS` → `platforms.discord.spontaneousPost.maxIntervalMs`
- `DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` → `platforms.discord.spontaneousPost.contextFetchProbability`
- Same pattern for Misskey with `MISSKEY_SPONTANEOUS_*` prefix

**Key Components:**

- `src/core/spontaneous-scheduler.ts` — Timer management and execution
- `src/core/spontaneous-target.ts` — Platform-specific target determination
- `SessionOrchestrator.processSpontaneousPost()` — Triggerless session flow
- `ContextAssembler.assembleSpontaneousContext()` — Context assembly without trigger message

### 9. Self-Research via RSS/Atom Feeds (Feature 16)

Enables the agent to periodically read RSS feeds, pick a topic as its character, research it, and write study notes to the agent workspace.

**Configuration:**

```yaml
selfResearch:
  enabled: false
  model: "gpt-5-mini"
  rssFeeds:
    - url: "https://example.com/feed.xml"
      name: "Tech News"
  minIntervalMs: 43200000  # 12 hours
  maxIntervalMs: 86400000  # 24 hours
```

**Environment Variable Overrides:**

- `SELF_RESEARCH_ENABLED` → `selfResearch.enabled`
- `SELF_RESEARCH_MODEL` → `selfResearch.model`
- `SELF_RESEARCH_RSS_FEEDS` → `selfResearch.rssFeeds` (JSON string)
- `SELF_RESEARCH_MIN_INTERVAL_MS` → `selfResearch.minIntervalMs`
- `SELF_RESEARCH_MAX_INTERVAL_MS` → `selfResearch.maxIntervalMs`

**How It Works:**

1. `SelfResearchScheduler` manages a timer with random intervals (12-24h default)
2. On trigger: fetch RSS items → randomly pick 20 → build research prompt
3. Agent receives prompt with character personality and RSS materials
4. Agent checks existing notes, picks a new topic, researches via web tools
5. Agent writes notes to `$AGENT_WORKSPACE/notes/` and updates `_index.md`
6. Agent self-reviews for hallucinations and privacy
7. No reply is sent to any platform — purely internal research

**Key Components:**

- `src/core/self-research-scheduler.ts` — Timer management
- `src/utils/rss-fetcher.ts` — RSS/Atom feed fetching and parsing
- `SessionOrchestrator.processSelfResearch()` — Research session flow
- `prompts/system_self_research.md` — Research prompt template

### 10. Memory Maintenance (Feature 17)

Enables periodic, agent-driven memory summarization/compaction per user workspace to control long-term memory growth.

**Configuration:**

```yaml
memoryMaintenance:
  enabled: false
  model: "gpt-5-mini"
  minMemoryCount: 50
  intervalMs: 604800000  # 7 days
```

**Environment Variable Overrides:**

- `MEMORY_MAINTENANCE_ENABLED` → `memoryMaintenance.enabled`
- `MEMORY_MAINTENANCE_MODEL` → `memoryMaintenance.model`
- `MEMORY_MAINTENANCE_MIN_MEMORY_COUNT` → `memoryMaintenance.minMemoryCount`
- `MEMORY_MAINTENANCE_INTERVAL_MS` → `memoryMaintenance.intervalMs`

**How It Works:**

1. `MemoryMaintenanceScheduler` triggers at fixed intervals
2. All workspaces are scanned, and low-memory workspaces are skipped by threshold
3. `SessionOrchestrator.processMemoryMaintenance()` runs one ACP session per workspace
4. Agent uses existing memory skills (`memory-search`, `memory-save`, `memory-patch`)
5. Original memories are disabled via patch events (append-only preserved)
6. Failures are isolated per workspace and do not stop the full maintenance cycle

## Prompt Template System

The system uses a template-based prompt system that allows easy customization without rebuilding containers.

### How It Works

The main system prompt (`prompts/system.md`) uses `{{placeholder}}` syntax to reference content from separate fragment files. During startup, `loadSystemPrompt` (in `src/core/config-loader.ts`) scans the prompts directory and replaces all placeholders with the corresponding file contents.

**Example:**

```markdown
<!-- prompts/system.md -->

You are {{character_name}}. {{character_info}}
```

```markdown
<!-- prompts/character_name.md -->

Yuna
```

```markdown
<!-- prompts/character_info.md -->

An AI assistant
```

**Result after loading:**

```
You are Yuna. An AI assistant
```

### Template Processing Rules

| Rule                  | Behavior                                                         |
| --------------------- | ---------------------------------------------------------------- |
| Placeholder format    | `{{name}}` where name matches a `.md` filename                   |
| Fragment files        | Any `.md` file in prompts directory (except `system.md`)         |
| Content trimming      | All fragment content is trimmed before replacement               |
| Repeated placeholders | All occurrences are replaced with the same content               |
| Missing fragments     | Placeholders without matching files are preserved with a warning |
| Self-exclusion        | `system.md` itself is never used as a fragment                   |

### Container Deployment Considerations

**Default Prompts:**

- Default prompt files are bundled in the container at `/app/prompts/`
- The container declares `/app/prompts` as a VOLUME for optional overrides

**Custom Prompts:**

- Users can mount individual prompt files to `/app/prompts/<filename>:ro` without rebuilding
- Only the files you mount will be overridden; others keep their container defaults
- No need to provide all files — unmounted files retain the bundled defaults

**Container Binaries:**

- The container includes pre-installed binaries:
  - `copilot` - GitHub Copilot CLI (latest release)
  - `opencode` - OpenCode CLI (latest release)
  - `rg` - ripgrep 15.1.0 for memory search
  - `dumb-init` - Used as PID 1 and to wrap agent subprocesses for proper signal forwarding
- OpenCode configuration is pre-configured at `/home/deno/.config/opencode/opencode.json`
- Skills are copied to `/home/deno/.agents/skills/` for agent discovery

**Example compose.yml:**

```yaml
volumes:
  - ./data:/app/data:Z
  - ./config.yaml:/app/config.yaml:ro,Z
  # Mount only the prompt files you want to override
  - ./my-prompts/character_name.md:/app/prompts/character_name.md:ro,Z
  - ./my-prompts/character_info.md:/app/prompts/character_info.md:ro,Z
```

### Adding New Placeholders

To add a new placeholder:

1. Add `{{new_placeholder}}` to `prompts/system.md`
2. Create `prompts/new_placeholder.md` with the content
3. No code changes needed - the system auto-discovers fragment files
4. Test locally before deploying to containers

### File References

- Implementation: `src/core/config-loader.ts:213-312` (`loadSystemPrompt`, `loadPromptFragments`, `replacePlaceholders`)
- Tests: `tests/core/config-loader.test.ts` (9 test cases covering template system)
- BDD Spec: `docs/features/12-prompt-template-system.feature`

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

### GELF Output

When `logging.gelf.enabled` is `true` and `logging.gelf.endpoint` is set, all log entries are also sent to a GELF HTTP endpoint via fire-and-forget `fetch()`. The GELF transport is initialized in `bootstrap.ts` and injected into the global logger config. The transport module is at `src/utils/gelf-transport.ts`.

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
  });
  assertEquals(key, "discord/123");
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

accessControl:
  replyTo: "whitelist"
  whitelist:
    - "discord/account/123456789"
```

Environment variables override config file values.

## File Layout Quick Reference

```text
AIr-Friends/
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
│   │   ├── reply-policy.ts         # Access control & reply policy
│   │   ├── spontaneous-scheduler.ts # Spontaneous posting scheduler
│   │   ├── spontaneous-target.ts    # Platform-specific target selection
│   │   ├── self-research-scheduler.ts # Self-research scheduling
│   │   ├── memory-maintenance-scheduler.ts # Memory maintenance scheduling
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
│       ├── rss-fetcher.ts    # RSS/Atom feed fetching and parsing
│       └── env.ts            # Environment utilities
├── skills/                   # Shell-based skill scripts
│   ├── memory-save/
│   │   ├── SKILL.md         # Skill definition for agent
│   │   └── scripts/
│   │       └── send-reply.ts # Deno script
│   ├── memory-search/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── memory-search.ts
│   ├── memory-patch/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── memory-patch.ts
│   ├── memory-stats/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── memory-stats.ts
│   ├── fetch-context/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── fetch-context.ts
│   ├── send-reply/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── send-reply.ts
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
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development setup and customization guide
- [docs/features/](docs/features/) - BDD feature specifications
- [ACP Protocol Spec](https://agentclientprotocol.org/) - Agent Client Protocol
- [Agent Skills Standard](https://agentskills.io/) - SKILL.md format
