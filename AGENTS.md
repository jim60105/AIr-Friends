# AIr-Friends - Development Guide for AI Agents

This document provides comprehensive guidance for AI agents working on the AIr-Friends project. It covers architecture, coding standards, build processes, and key design decisions.

## Project Overview

AIr-Friends is a multi-platform conversational AI bot that acts as an **ACP (Agent Client Protocol) Client**, delegating AI reasoning to the external OpenCode CLI agent while maintaining persistent cross-conversation memory.

**Key Concepts:**

- **We are the ACP Client**: We spawn and communicate with external ACP Agents
- **External CLI tool is the Agent**: OpenCode CLI executes AI tasks
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
│  (OpenCode CLI)                                             │
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

YOLO mode can also be configured per-channel via the `yolo` field in `channels` configuration:

```yaml
channels:
  - id: "discord/account/560842157351763989"
    enabled: true
    yolo: true # This account runs Agent in YOLO mode
```

**Effective YOLO logic**: `effectiveYolo = globalYoloFlag || channelConfig.yolo`

**Use cases**:

- Testing and development (global `--yolo` flag)
- Trusted channels/accounts (per-channel `yolo: true`)

**Account-Level YOLO (Account-Level YOLO):**

- When `channels` contains a `{platform}/account/{id}` entry with `yolo: true`,
  that account triggers YOLO mode regardless of whether it sends from a DM, any channel, or any other trigger method
- This differs from channel-level YOLO (`{platform}/channel/{id}` with `yolo: true`),
  which only activates within a specific channel
- The YOLO flag propagates through the full chain to `ChatbotClient.requestPermission()`,
  affecting all permission types (tool call, external directory, edit/write, etc.)

**Warning**: Only use YOLO mode in isolated/trusted environments. It bypasses all permission checks for agent actions.

#### Dry Run Mode

The `--dry-run` flag enables dry run / debug mode. The system assembles context but does NOT call the ACP Agent — instead, the assembled prompt is written to an output directory:

```bash
deno run --allow-net --allow-read --allow-write --allow-env --allow-run src/main.ts --dry-run
```

**Use cases**:

- Prompt engineering and context debugging
- CI/CD smoke tests (zero API cost)
- Verifying memory / context assembly output

**Configuration** (in `config.yaml` under `agent:`):

```yaml
agent:
  dryRun:
    enabled: false # Enable dry run mode (default: false)
    outputPath: "./data/dry-run/" # Output directory for assembled prompts
    mockReply: "（Dry run 模式 — 此為測試回覆）" # Mock reply text (empty = no reply)
```

**Environment Variable Overrides:**

- `DRY_RUN_ENABLED` → `agent.dryRun.enabled`
- `DRY_RUN_OUTPUT_PATH` → `agent.dryRun.outputPath`
- `DRY_RUN_MOCK_REPLY` → `agent.dryRun.mockReply`

**Behavior**: Steps 1-6 of the session flow (workspace, session registration, context assembly, prompt rendering) execute normally. The agent connector is never created. If `mockReply` is non-empty and a platform adapter is available, a test reply is sent to the platform. Output files are named `{sessionType}_{timestamp}.md`.

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
- The `SESSION_ID` environment variable is set for the agent subprocess during active sessions

```typescript
// Workspace path structure
const workspacePath = `${config.workspace.repo_path}/workspaces/${platform}/${userId}`;
// Each workspace includes a tmp/ subdirectory, exposed via TMPDIR env var to Agent
const tmpPath = `${workspacePath}/tmp`;
```

#### Agent Global Workspace (Feature 15)

In addition to per-user workspaces, the Agent has a global workspace at `{workspace.repoPath}/agent-workspace/` for storing cross-conversation knowledge, research notes, and reflections.

- **Not per-user**: Shared across all conversations and users
- **Markdown-based**: All files use `.md` format for token efficiency
- **Not pre-loaded**: Content is NOT included in initial context; Agent reads on-demand via `$AGENT_WORKSPACE` env var
- **Index-guided**: `notes/_index.md` serves as a quick-reference index
- **Privacy boundary**: User private data must NOT be stored here (use `memory-save` instead)
- **Write-gated (read-only by default)**: The shared workspace is a cross-user store, so WRITE access is restricted to sessions explicitly authorized via the `canWriteAgentWorkspace` flag — currently **only self-research sessions**. Ordinary user, spontaneous, channel-lurk, and memory-maintenance sessions have **read-only** access; their edit/write requests to the shared workspace are rejected at the ACP permission gate (both `requestPermission` and `writeTextFile`). Per-session `$TMPDIR` writes remain allowed regardless. Memory-maintenance operates on per-user memory JSONL via memory skills, not the shared workspace.
- **No auto-approved network egress**: `curl` / `wget` are NOT in the OpenCode restricted-mode bash allow-list; agents fetch web content via the dedicated `webfetch` / `agent-browser` skills (or run under YOLO / network isolation for research).

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

#### Tiered Memory Architecture

Memories are organized into three tiers:

| Tier      | Purpose                            | Decay Default | Working Limit      |
| --------- | ---------------------------------- | ------------- | ------------------ |
| `core`    | Persistent identity facts          | 1.0 (no decay)| N/A                |
| `working` | Active, recent conversation context| 0.8           | Configurable (default: 20) |
| `archive` | Long-term storage                  | 0.5           | N/A                |

When the working tier exceeds `memory.workingTierLimit`, the oldest working memories are automatically demoted to archive tier.

#### Memory Scope

- **`user`** (default): Per-user memories shared across all channels the user interacts in
- **`channel`**: Channel-scoped memories stored alongside the channel context (e.g., group conversation topics, channel-specific decisions)

#### Categories

Each memory has a category for classification:

| Category       | Description                                      |
| -------------- | ------------------------------------------------ |
| `fact`         | Objective information (default)                  |
| `preference`   | User preferences and likes/dislikes              |
| `episode`      | Specific conversation events or experiences      |
| `summary`      | Conversation summaries (auto-generated or manual)|
| `relationship` | Relationship information between people          |

#### Conversation Summaries

After each session, the system can automatically generate a conversation summary using the `system_summary.md` prompt template. This is controlled by `conversationSummary.enabled` (default: `true`). Summaries are saved as working-tier memories with category `summary`.

#### Storage Format

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
  tier: "core" | "working" | "archive"; // Memory tier (default: "archive")
  category: "fact" | "preference" | "episode" | "summary" | "relationship"; // Classification (default: "fact")
  scope: "user" | "channel"; // Memory scope (default: "user")
  decay: number; // 0.0–1.0 temporal relevance (default varies by tier)
  content: string; // Plain text
  relatedTo?: string[]; // IDs of semantically related memories
  supersedes?: string[]; // IDs of memories this entry supersedes
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
    tier?: "core" | "working" | "archive";
    category?: "fact" | "preference" | "episode" | "summary" | "relationship";
    decay?: number; // 0.0–1.0 (ignored for core tier)
    relatedTo?: string[]; // IDs of semantically related memories
    supersedes?: string[]; // IDs of memories this patch's target supersedes
  };
}
```

#### Configuration

```yaml
memory:
  searchLimit: 10
  maxChars: 2000
  recentMessageLimit: 20
  workingTierLimit: 20  # Max working-tier memories before demotion to archive

conversationSummary:
  enabled: true          # Auto-generate conversation summaries (default: true)
  model: ""              # Model for summaries (defaults to agent.model)
```

**Environment Variable Overrides:**

- `MEMORY_WORKING_TIER_LIMIT` → `memory.workingTierLimit`
- `CONVERSATION_SUMMARY_ENABLED` → `conversationSummary.enabled`
- `CONVERSATION_SUMMARY_MODEL` → `conversationSummary.model`

### 4. Skills & Final Reply (Feature 04)

**Shell-Based Skills Architecture**:

- Skills are Deno TypeScript scripts in `skills/{skill-name}/scripts/` directories
- Each skill has a `SKILL.md` file describing its usage for the agent
- External Agents execute these scripts with `--session-id` parameter
- Scripts use shared client library in `skills/lib/client.ts`
- Scripts call back to main bot via HTTP API (Skill API Server on localhost:3001)
- Session-based authentication ensures security
- The `SESSION_ID` environment variable is set for the agent subprocess with the active session ID
- **Payload-file argument contract**: free-text content (reply text, memory content, search queries, captions, reminder text) MUST NEVER appear on a skill command line — the shell expands `$VAR` in it, corrupting content and leaking subprocess env vars into external channels. The agent writes the text to `$TMPDIR/$SESSION_ID/{name}.md` with its edit/write tool, then passes the path via the payload-file flag (`--message-file`, `--content-file`, `--query-file`, `--caption-file`). The shared helper `skills/lib/payload.ts` enforces session-scoped containment (`{workspace}/tmp/{sessionId}`, symlink-aware) and raises instructive typed errors (`SKILL_LEGACY_FLAG`, `SKILL_MISSING_PAYLOAD`, `SKILL_PAYLOAD_OUT_OF_BOUNDS`, `SKILL_PAYLOAD_NOT_FOUND`, `SKILL_SINGLE_FILE_FLAG`) that teach the correct pattern.

**Available Skills**:

| Skill           | Purpose                      | HTTP Endpoint                 |
| --------------- | ---------------------------- | ----------------------------- |
| `memory-save`   | Save new memory              | POST /api/skill/memory-save   |
| `memory-search` | Search existing memories     | POST /api/skill/memory-search |
| `memory-patch`  | Update memory attributes     | POST /api/skill/memory-patch  |
| `memory-stats`  | Get memory statistics        | POST /api/skill/memory-stats  |
| `fetch-context` | Get additional platform data | POST /api/skill/fetch-context |
| `send-reply`    | Send final reply (max 1)     | POST /api/skill/send-reply    |
| `edit-reply`    | Edit last sent reply         | POST /api/skill/edit-reply    |
| `send-file`     | Send 1+ workspace files (max 1 call/session) | POST /api/skill/send-file |

**Reply Rule**:

- Only `send-reply` and `send-file` skills send content externally (`react-message` sends a reaction)
- Multiple replies are allowed per session — each call sends a separate message
- At least **one reply, one reaction, or one file send per session** is required; if none occurred, the retry mechanism triggers
- `send-file` is limited to **1 successful call per session** (`MAX_FILE_SENDS_PER_SESSION = 1`; a multi-file batch counts as one call) with doom-loop protection at 4 attempts — it does NOT consume the reply quota, does NOT set `replySent`, and does NOT update `lastSentMessageId` (file messages are not `edit-reply`-able); on delivery it records the last delivered message ID in `lastFileMessageId` (never `lastSentMessageId`), and the session's reply anchor resolves to `lastFileMessageId ?? triggerMessageId` — a subsequent `send-reply` threads to the file message, while a per-reply anchor (`lastReplyAnchorMessageId`, recorded on `send-reply` success) keeps `edit-reply` on the edited reply's original thread parent
- `send-file` accepts a repeatable `--file-paths` flag (one occurrence per file, at least one required); the removed singular `--file-path` is rejected with `SKILL_SINGLE_FILE_FLAG`; captions follow the payload-file flow (`--caption-file`) and go through the same `stripXmlTags` → `unescapeNewlines` content pipeline as replies
- Delivery: Discord = one message with all attachments; Misskey note = one note with all `fileIds`; Misskey chat = one message per file (caption on the first), with partial-delivery reporting and best-effort Drive cleanup of unreferenced uploads on mid-batch failure — a successful file send marks `fileSent` and suppresses the missing-response retry
- Batch limits: `skills.sendFile.maxFilesPerInvocation` (default 10) and `skills.sendFile.maxTotalSizeMb` (default 50) are enforced **before reading file bytes**; preflight validation is all-or-nothing (one invalid path rejects the whole call with nothing sent)
- A file-only turn does NOT trigger conversation summary generation (the summary gate stays `replySent`)
- All other outputs (tool calls, reasoning) stay internal
- **Reply Threading**: When triggered from a message/note, replies are threaded to the resolved reply anchor (`lastFileMessageId ?? triggerMessageId`) from SkillContext — the original trigger message until `send-file` delivers files, the file message afterwards. `react-message` always targets the original trigger (`triggerMessageId`), never the bot's own messages; `edit-reply` preserves the edited reply's original thread parent via `lastReplyAnchorMessageId`

**Edit Reply**:

- `edit-reply` skill allows the Agent to edit a previously sent reply
- Requires the `messageId` returned by `send-reply`
- Can be called multiple times within the same session
- Only edits messages sent by the bot

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
- **Note Edit Strategy**: Misskey API has no `notes/update` endpoint. `editMessage()` uses a delete-and-recreate strategy (`notes/delete` → `notes/create`). The new note's `replyId` points to the edited reply's recorded thread parent (`lastReplyAnchorMessageId` — the message it was created as a reply to: the file message when the reply followed a file send, otherwise the trigger note), never the current anchor, so an edit never rewrites thread topology. The returned `messageId` will be different from the original.

**Misskey Channel Types**:

| Channel ID Format | Description                          | API Endpoint                                                  |
| ----------------- | ------------------------------------ | ------------------------------------------------------------- |
| `note:{noteId}`   | Public note conversation thread      | `notes/replies`, `notes/create`                               |
| `dm:{userId}`     | Direct message via specified notes   | `notes/mentions`                                              |
| `chat:{userId}`   | Private chat room with specific user | `chat/messages/user-timeline`, `chat/messages/create-to-user` |

### 6. ACP Client Integration

We use `@agentclientprotocol/sdk` for Client-side connection:

**AgentConnector** (`src/acp/agent-connector.ts`):

- Spawns external ACP agent as subprocess (opencode CLI)
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

- **Restricted mode**: Auto-approves registered skills, skills directory access, and skill auto-approve list matched commands (script paths + command prefixes). The auto-approve list can be configured via `agent.autoApproveSkills` in config or `AGENT_AUTO_APPROVE_SKILLS` env var (comma-separated). When not configured, falls back to scanning the built-in `skills/` directory. Edit/write requests are classified by the ACP tool `kind` (`"edit"` — what OpenCode v1.17.13+ sends for its `write`/`edit`/`apply_patch`/`patch` tools, whose `title` is the target file path) OR by legacy title values (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`); requests matching neither fall through to `Rejecting unknown tool call`.
- **Edit/Write Path Extraction**: When `locations` is empty in an edit/write permission request, the system attempts to extract file paths from `rawInput` (checking fields: `path`, `file_path`, `filePath`, `filepath`, `file`, `filename`, `paths`, `files` — covering both the OpenCode write shape `{filePath, content}` and edit shape `{filepath, diff}`). Extracted paths go through the standard workspace boundary and extension checks. If paths cannot be extracted from either `locations` or `rawInput`, the request is rejected (conservative approach to maintain security boundaries).
- **Permission rejection feedback (retry prompt)**: `ChatbotClient` records every permission denial (`requestPermission()` + `writeTextFile()`) in a bounded per-session ring buffer (max 10 entries, `commandOrPath` truncated to 200 chars). The missing-reply retry prompt includes the recent rejection reasons (`toolName`, `kind`, rejected command/path, reason) as a bounded diagnostic section so the Agent can self-correct. The buffer is NOT cleared by `reset()` (which runs at the start of every prompt, including the retry); it is cleared exactly once per logical session in `AgentConnector.createSession()`.
- **Generic-command gate (F12 D2)**: allow-listed read/media tools (`rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`) are approved only when every path argument — input and output — resolves inside the session workspace/TMPDIR, the agent workspace, or the session's OpenCode tool-output dir. The tool-output boundary is session-local: OpenCode runs with `XDG_DATA_HOME={workspace}/tmp/opencode-data/{sessionId}`, so truncated tool outputs land inside the session workspace; the shared home-rooted `~/.local/share/opencode/tool-output` is **never** within bounds (fail closed), and paths inside the data area that belong to sibling/previous sessions (or the enumerating root listing) are rejected. Home-anchored tokens (`~`, `~/`, `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}`, including attached option values like `-o$HOME/...`) are expanded and containment-checked; unexpandable forms (`~otheruser/...`) are rejected, as are attached short-option traversal values (`-f../sibling/file`, `-o../x`).
- **YOLO mode** (global `--yolo` flag or per-channel `yolo: true`): Auto-approves ALL permission requests
  - Useful for trusted/isolated environments
  - Bypasses all permission validation

**Session Flow**:

```typescript
// 1. Create and connect agent
const connector = new AgentConnector({ agentConfig, clientConfig, skillRegistry });
await connector.connect();

// 2. Create session with workspace and optional MCP servers
const sessionId = await connector.createSession(mcpServers);
await connector.setSessionModel(sessionId, "gpt-4");

// 3. Switch to YOLO mode agent for OpenCode when YOLO is enabled
const modeOverride = getSessionModeOverride(agentType, yolo);
if (modeOverride) {
  await connector.setSessionMode(sessionId, modeOverride);
}

// 4. Apply resolved reasoning effort (best-effort; no-op if unsupported)
await connector.setReasoningEffort(sessionId, resolvedReasoningEffort);

// 5. Send prompt and get response
const response = await connector.prompt(sessionId, assembledContext);

// 6. Disconnect when done
await connector.disconnect();
```

**Reasoning Effort (ACP `thought_level`)**:

Reasoning effort controls how hard the model "thinks" and is applied to the ACP session via the
Session Config Options API (`session/set_config_option` with the `thought_level` category) after
the model is set. It is resolved **per session** through a chain parallel to model selection:

1. **Per-routing-rule** `reasoningEffort` on a matching `agent.modelRouting.rules[]` entry
2. **Per-section** `reasoningEffort` on `selfResearch` / `memoryMaintenance` / `conversationSummary`
3. **Global** `agent.reasoningEffort` (default `"default"`)

`resolveReasoningEffort()` (in `src/core/model-router.ts`) mirrors `resolveModel()`: it stops at the
**first matching rule**; if that rule sets `reasoningEffort` it wins, otherwise resolution falls back
to the section/global value (it does NOT continue to later rules). This lets a rule route the model
and the effort independently while keeping them tied to the same matched rule.

| Value | Meaning |
| ----- | ------- |
| `"none"` / `"low"` / `"medium"` / `"high"` / `"xhigh"` / `"max"` | Normalized effort levels |
| `"default"` (or empty/unset global) | Do not configure — let the agent/model decide |
| any other token | Agent-specific passthrough (sent as-is, warned at load) |

**Behavior**:

- Best-effort and non-fatal: if the agent does not advertise a `thought_level` option, or rejects the
  value, the session continues. Outcomes (`applied` / `unsupported` / `skipped` / `skipped_unavailable`
  / `failed`) are logged, and the resolved effort is recorded in the `session_start` audit entry.
- The connector caches the session's `configOptions` (from `newSession`, refreshed by
  `config_option_update` notifications and `set_config_option` responses) and re-discovers the
  `thought_level` option from the latest cache at apply time — important because a model change can
  alter the available reasoning options.
- For known-vocabulary values not offered by the model, the call is skipped with a structured warning
  (rather than sending an invalid value); agent-specific passthrough tokens are sent as-is.

**Environment Variable Override**:

- `AGENT_REASONING_EFFORT` → `agent.reasoningEffort` (global default only). Per-rule values ride in
  `MODEL_ROUTING_RULES` JSON; per-section values come from the config file.

**Supported Agent**:

- **OpenCode CLI** (`opencode`) - Open source coding agent that supports multiple providers:
  - OpenRouter provider (uses `OPENROUTER_API_KEY` env var)
  - Gemini provider (uses `GEMINI_API_KEY` env var)
  - Pre-configured in container with `agent-config/opencode.json`

**Agent Selection**:

- Set via `agent.defaultAgentType` in config or `AGENT_DEFAULT_TYPE` env var
- Valid value: `"opencode"`
- Container includes the pre-installed `opencode` binary

**External MCP Servers**:

- Configured via `agent.mcpServers` in config or `AGENT_MCP_SERVERS` env var (JSON string)
- MCP servers are registered with the Agent during session creation
- All agents support stdio transport; HTTP/SSE support depends on Agent capabilities
- Values in `env`, `headers`, and `url` support `${ENV_VAR}` expansion

**Agent Sandbox Hardening**:

Agent subprocesses run with configurable sandbox isolation via `SandboxManager`:

| Setting                                | Default           | Description                                                                    |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `agent.sandbox.filterEnv`              | `true`            | Filter subprocess env vars to an allowed list only                             |
| `agent.sandbox.networkIsolation`       | `false`           | Wrap command with `unshare --net` for network namespace isolation (Linux only) |
| `agent.sandbox.allowedEnvVars`         | `[]`              | Additional env var names to pass through the filter                            |
| `agent.sandbox.allowedWriteExtensions` | `[".md", ".txt"]` | Allowed file extensions for agent workspace writes in restricted mode          |

The base env allowlist includes `XDG_DATA_HOME`; agent-factory sets it per session to
`{workspace}/tmp/opencode-data/{sessionId}` (session id when present, else the workspace
root) so OpenCode's data dir (truncated tool outputs, logs) stays inside the session
workspace instead of the shared `~/.local/share/opencode/`.

Environment variable overrides:

| Environment Variable                     | Config Path                            | Type                 |
| ---------------------------------------- | -------------------------------------- | -------------------- |
| `AGENT_SANDBOX_FILTER_ENV`               | `agent.sandbox.filterEnv`              | `"true"` / `"false"` |
| `AGENT_SANDBOX_NETWORK_ISOLATION`        | `agent.sandbox.networkIsolation`       | `"true"` / `"false"` |
| `AGENT_SANDBOX_ALLOWED_ENV_VARS`         | `agent.sandbox.allowedEnvVars`         | Comma-separated      |
| `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` | `agent.sandbox.allowedWriteExtensions` | Comma-separated      |

Degradation strategy:

- `filterEnv: true` works on all platforms (pure TypeScript logic)
- `networkIsolation: true` falls back gracefully on non-Linux or when `unshare` is unavailable (warns and skips)
- Sandbox config errors do not prevent Agent startup

**Git Credential Store for Agent**:

When `agent.gitCredential.enabled` is true, bootstrap writes a `~/.git-credentials` file and runs
`git config --global credential.helper store` so YOLO-mode Agent subprocesses can use plain
`git push` / `git pull` / `git clone` without embedding credentials in command strings.

- Credential source is shared with `gitBackup`: `gitBackup.authPassword` → `GITHUB_TOKEN` for the password, and `gitBackup.authUser` → `gitBackup.authorEmail` → `x-access-token` for the username
- Host resolution order is: `agent.gitCredential.host` → parsed from `gitBackup.remoteUrl` → `github.com`
- The credential file lives under `$HOME`, so it is outside ACP workspace file reads and is not injected into prompt context
- In restricted mode this configuration is effectively dormant because git shell access is still blocked by the existing defense layers
- The credential store keeps git auth behavior consistent for OpenCode and avoids constructing tokenized git URLs in prompts
- Known limitation: in YOLO mode, the Agent can still read `~/.git-credentials` directly if it chooses to run `cat ~/.git-credentials`; this is an inherent YOLO trust-boundary tradeoff

Environment variable overrides:

| Environment Variable           | Config Path                   | Type                 |
| ------------------------------ | ----------------------------- | -------------------- |
| `AGENT_GIT_CREDENTIAL_ENABLED` | `agent.gitCredential.enabled` | `"true"` / `"false"` |
| `AGENT_GIT_CREDENTIAL_HOST`    | `agent.gitCredential.host`    | String               |

**OpenCode YOLO Mode (Agent Mode Switching)**:

When YOLO mode is enabled for an OpenCode session, the system switches to the `yolo` agent
defined in `agent-config/opencode.json` via ACP `setSessionMode("yolo")`. This agent has
`"*": "allow"` permissions, granting the agent unrestricted access.

| Mode       | OpenCode Agent    | Permission Default        |
| ---------- | ----------------- | ------------------------- |
| Restricted | `build` (default) | `"*": "deny"` + whitelist |
| YOLO       | `yolo`            | `"*": "allow"`            |

Note: The `OPENCODE_YOLO` env var has been removed since upstream OpenCode YOLO mode
(PR anomalyco/opencode#11833) was never functional. YOLO is fully handled via
ACP `setSessionMode("yolo")`.

**Retry on Missing Reply**:

When an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without calling the `send-reply` skill, the `react-message` skill, or the `send-file` skill (a file send counts as a response — `hasResponded = replySent || reactionSent || fileSent`), the system automatically retries:

1. Clears the reply state to allow a new reply
2. Sends a second prompt on the **same ACP session** with a system message requesting the agent to send a reply (the retry prompt names all three communication tools and embeds the `send-file` SKILL.md alongside the others). When the session recorded permission rejections, the retry prompt additionally carries a bounded `Recent permission rejections in this session:` diagnostic section (snapshotted BEFORE the retry `prompt()` call, which runs `reset()` at its start)
3. If the retry also fails to produce a reply, reaction, or file send, the system returns a failure response

This retry mechanism uses `connector.prompt()` on the existing session — no CLI-level resume or `loadSession()`/`resumeSession()` is needed.

The retry strategy is configured per agent type via `getRetryPromptStrategy()` in `src/acp/agent-factory.ts`:

| Agent    | Max Retries | Retry Supported |
| -------- | ----------- | --------------- |
| OpenCode | 1           | Yes             |

**OpenCode Version Contract**:

The ACP permission request shape changed in OpenCode v1.17.13 (PR #34079 "enrich permission prompts"): edit/write requests now carry `kind: "edit"` with `title` = the target file path (the ACP `ToolKind` vocabulary has no `"write"` kind). The permission gate accepts both the new shape and the legacy title shapes (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`).

- **Container pin**: `Containerfile` downloads a pinned `OPENCODE_VERSION` (default `1.17.13`) with per-arch SHA-256 checksum verification (`OPENCODE_SHA256_X64` / `OPENCODE_SHA256_ARM64`) instead of `releases/latest`, so ACP contract changes cannot silently degrade the harness. Bump deliberately and re-verify the request shape + checksums.
- **Bootstrap check**: `verifyOpenCodeVersion()` (in `src/utils/opencode-version.ts`) runs at bootstrap, spawns `opencode --version` (5s timeout, no network, never starts an ACP session) and logs a structured, greppable marker: `OpenCode version check: OK|BELOW_MINIMUM|UNKNOWN`. Below-minimum or undeterminable versions only WARN — startup never blocks. The known-good minimum is `1.17.13`, overridable via `AGENT_OPENCODE_MIN_VERSION` (documented in `config.example.yaml`, `.env.example`, `helm/values.yaml`). This is an observability measure, NOT a functional gate.

**Idle Timeout Detection**:

When an ACP Agent connection becomes silently unresponsive (no session updates for a configurable period), the system automatically detects and handles it:

1. **Activity Tracking**: All Agent callbacks (sessionUpdate, requestPermission, readTextFile, writeTextFile) update a `lastActivityTimestamp` in ChatbotClient
2. **Idle Monitor**: During `prompt()`, a periodic check runs every `checkIntervalMs` (default: 30s)
3. **Liveness Check**: After `timeoutMs` (default: 5 min) of inactivity:
   - Checks if the Agent subprocess is still alive via `process.status`
   - Attempts `connection.cancel()` as a connectivity probe
   - If alive → resets timer and continues waiting
   - If dead → throws error for upstream handling
4. **Session Resumption**: On connection death, `SessionOrchestrator` attempts to reconnect and reload the same session via `loadSession()` (requires Agent support). Currently, no agents support `loadSession`, so this is a forward-looking design.

| Setting                             | Default  | Description                   |
| ----------------------------------- | -------- | ----------------------------- |
| `agent.idleTimeout.enabled`         | `true`   | Enable idle timeout detection |
| `agent.idleTimeout.timeoutMs`       | `300000` | Idle timeout in ms (5 min)    |
| `agent.idleTimeout.checkIntervalMs` | `30000`  | Check interval in ms (30s)    |

Environment variable overrides:

- `AGENT_IDLE_TIMEOUT_ENABLED`
- `AGENT_IDLE_TIMEOUT_MS`
- `AGENT_IDLE_TIMEOUT_CHECK_INTERVAL_MS`

### 7. Reply Policy (Feature 13)

Controls bot reply behavior through the top-level `replyPolicy` and `channels` list in `config.yaml`.

**Reply Policy Modes:**

| Mode       | Behavior                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------- |
| `all`      | Reply to everyone in both public channels and DMs                                        |
| `public`   | Reply in public channels only; DMs only if the account/channel has `rateLimitBypass` set |
| `channels` | Reply only to configured channels/accounts in the `channels` list (default)              |

**Channel ID Format:**

```text
{platform}/account/{account_ID}
{platform}/channel/{channel_ID}
```

**Processing Order:**

1. Platform-level filters (bot self-check, `allowDm`, `respondToMention`)
2. Reply policy (`ReplyPolicyEvaluator.shouldReply()`)
3. Message handling and agent execution

**Configuration Example:**

```yaml
replyPolicy: "channels"
channels:
  - id: "discord/account/123456789012345678"
    enabled: true
    spontaneousPost: false
    channelLurk: false
    rateLimitBypass: false
    yolo: true # Run Agent in YOLO mode for this account
  - id: "discord/channel/987654321098765432"
    enabled: true
    spontaneousPost: true
    channelLurk: true
    rateLimitBypass: false
    yolo: false # Default: restricted mode
  - id: "misskey/account/abcdef1234567890"
    enabled: true
    spontaneousPost: false
    channelLurk: false
    rateLimitBypass: true
```

**Environment Variable Overrides:**

- `REPLY_POLICY` -> sets `replyPolicy` (REPLY_TO is still accepted as an alias)
- `CHANNELS` -> sets `channels` (JSON array, fully replaces config file value)

```bash
REPLY_POLICY=public
CHANNELS='[{"id":"discord/account/12345678901234567","enabled":true}]'
```

### 7a. Rate Limiting & Cooldown

Prevents excessive API usage per user via a sliding window + cooldown mechanism. Complements access control: access control decides "who can", rate limiting decides "how often".

**Configuration:**

```yaml
rateLimit:
  enabled: false
  maxRequestsPerWindow: 10
  windowMs: 600000 # 10-minute sliding window
  cooldownMs: 600000 # Cooldown after limit exceeded
```

**How It Works:**

1. Each user is tracked independently by `{platform}:{userId}` key
2. Requests within the sliding window are counted
3. When `maxRequestsPerWindow` is exceeded, the user enters a cooldown period
4. During cooldown, all requests are silently rejected (no reply, no session started)
5. After cooldown expires, the counter resets and the user can send requests again
6. Rate limit check runs **after** duplicate event detection and **before** any resource allocation
7. Whitelisted accounts (`{platform}/account/{id}`) automatically bypass rate limiting. Whitelisted channels (`{platform}/channel/{id}`) do not affect rate limiting — users in whitelisted channels are still subject to rate limits.

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
   - Determines a target from channels configured with `spontaneousPost: true`
   - Randomly decides whether to fetch recent messages based on `contextFetchProbability`
   - Calls `SessionOrchestrator.processSpontaneousPost()` to run the agent
4. The agent receives a special prompt instructing it to create original content
5. Errors never crash the bot — the next execution is always scheduled

**Platform Target Selection:**

| Platform | Target Selection                                                                                |
| -------- | ----------------------------------------------------------------------------------------------- |
| Discord  | Random channel from `channels` with `spontaneousPost: true` (account entries create DM targets) |
| Misskey  | Random channel from `channels` with `spontaneousPost: true` (supports `misskey/timeline/self`)  |

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

### 8a. Channel Lurk Reply (Feature 26)

Periodically checks whitelisted Discord channels and auto-replies when conditions are met. Discord only.

**Configuration:**

```yaml
platforms:
  discord:
    channelLurk:
      enabled: false # Enable channel lurk reply (default: false)
      intervalMs: 1800000 # Check interval: 30 minutes (default)
```

**Environment Variable Overrides:**

| Environment Variable               | Config Path                                |
| ---------------------------------- | ------------------------------------------ |
| `DISCORD_CHANNEL_LURK_ENABLED`     | `platforms.discord.channelLurk.enabled`    |
| `DISCORD_CHANNEL_LURK_INTERVAL_MS` | `platforms.discord.channelLurk.intervalMs` |

**Trigger Conditions (all must be true):**

1. Last message sender is not the bot itself (`isSelf()`)
2. Last message does not mention the bot (`hasBotMention()`)
3. Bot has not reacted to the last message (`hasBotReaction()`)
4. Message has not been processed before (`lastProcessedMessageId` map)

**Differences from Spontaneous Posting:**

| Aspect           | Spontaneous Post        | Channel Lurk Reply               |
| ---------------- | ----------------------- | -------------------------------- |
| Trigger          | Random interval         | Fixed interval + condition check |
| Target           | Random whitelist entry  | All whitelist channels           |
| Trigger message  | None (self-initiated)   | Last message in channel          |
| Session type     | `spontaneous`           | `channelLurk`                    |
| Prompt template  | `system_spontaneous.md` | `system_reply.md` (reuse)        |
| Platform support | Discord + Misskey       | Discord only                     |

**Key Components:**

- `src/core/channel-lurk-scheduler.ts` — Timer and condition checking
- `SessionOrchestrator.processChannelLurkMessage()` — Reuses normal message flow

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
  minIntervalMs: 43200000 # 12 hours
  maxIntervalMs: 86400000 # 24 hours
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

> **Note**: Self-research sessions set `canWriteAgentWorkspace: true` in template variables, allowing
> the prompt template to show write instructions (instead of "read-only") when rendering
> `agent_workspace.md`. Combined with the rawInput path extraction in `requestPermission()`,
> the agent can write research notes to `$AGENT_WORKSPACE/notes/` even in restricted (non-YOLO)
> mode, as long as the edit/write permission request includes file path information.

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
  intervalMs: 604800000 # 7 days
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

### 11. Multimedia Message Handling (Feature 18)

Supports passing image and file attachments from platform messages to the ACP Agent.

**Flow:**

```
Trigger/history message → Platform adapter extracts attachment metadata (URL, mimeType, filename, size)
→ NormalizedEvent / PlatformMessage carry attachments[]
→ ContextAssembler formats attachment info as text descriptions (always)
→ SessionOrchestrator builds image ContentBlock (when Agent supports promptCapabilities.image)
→ AgentConnector.prompt() sends mixed content (text + image ContentBlock)
```

**Key Design Points:**

- **Attachment type**: `Attachment` interface in `src/types/events.ts` with `isImage` flag (MIME starts with `image/`)
- **Capability negotiation**: Only sends image `ContentBlock` when Agent reports `promptCapabilities.image === true`
- **Text description always present**: Attachment URLs and metadata are always included as text in context, regardless of image capability
- **Only trigger message images downloaded**: History message images are described by URL only (no download)
- **Size limit**: Images over 20MB are not downloaded; described by URL instead
- **Download timeout**: 10 seconds per image; failures are non-fatal
- **SSRF protection**: Every attachment URL is validated at the download sink via `safeFetch` (`src/utils/ssrf.ts`) before each request: scheme must be http/https; the host must resolve to a public address (loopback / private / link-local / ULA / unspecified / multicast are rejected); redirects are followed manually with per-hop re-validation up to a max of 5 hops. Validation failures are non-fatal and fall back to the URL-only text description.
- **Backward compatible**: `attachments` field is optional; no changes to existing behavior for text-only messages

**Platform Attachment Sources:**

| Platform     | Source                             | Field                                              |
| ------------ | ---------------------------------- | -------------------------------------------------- |
| Discord      | `message.attachments` (Collection) | id, url, contentType, name, size, width, height    |
| Discord      | `message.stickers` (Collection)    | Formatted as `[Sticker: name (tags)]` in content   |
| Misskey Note | `note.files` (DriveFile[])         | id, url, type, name, size, properties.width/height |
| Misskey Chat | `message.file` (DriveFile \| null) | Same as above                                      |

### 12. Prometheus Metrics Export (Feature 19)

Exposes operational metrics via a Prometheus-compatible `/metrics` endpoint on the existing Health Check Server.

**Configuration:**

```yaml
metrics:
  enabled: false # Enable Prometheus metrics endpoint (default: false)
  path: "/metrics" # Metrics endpoint path (default: "/metrics")
```

**Environment Variable Overrides:**

- `METRICS_ENABLED` → `metrics.enabled`
- `METRICS_PATH` → `metrics.path`

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

**Key Design Points:**

- Uses `prom-client` (npm) with a dedicated Registry for test isolation
- Shares the Health Check Server port — no additional port needed
- All metric operations are pure in-memory O(1) with no I/O overhead
- Metrics endpoint only exposes aggregate numbers, never user content or tokens

### 13. Git Backup (Feature 21)

Periodically backs up the `data/` directory to a remote GitHub repository using Git.

**Configuration:**

```yaml
gitBackup:
  enabled: false
  remoteUrl: ""
  intervalMs: 3600000
  authorName: "AIr-Friends Backup"
  authorEmail: "airfriends-backup@noreply.github.com"
  authUser: ""
  authPassword: ""
```

**Environment Variable Overrides:**

- `GIT_BACKUP_ENABLED` → `gitBackup.enabled`
- `GIT_BACKUP_REMOTE_URL` → `gitBackup.remoteUrl`
- `GIT_BACKUP_INTERVAL_MS` → `gitBackup.intervalMs`
- `GIT_BACKUP_AUTHOR_NAME` → `gitBackup.authorName`
- `GIT_BACKUP_AUTHOR_EMAIL` → `gitBackup.authorEmail`
- `GIT_BACKUP_AUTH_USER` → `gitBackup.authUser`
- `GIT_BACKUP_AUTH_PASSWORD` → `gitBackup.authPassword`

**How It Works:**

1. `GitBackupScheduler` triggers backup at fixed intervals
2. `GitBackupService.initialize()` intelligently initializes based on directory state at startup:
   - Empty directory: clone the remote repository
   - Non-empty non-Git directory: git init + commit + push
   - Existing Git repo: commit uncommitted changes + push
3. Push conflicts during initialization trigger automatic rebase retry; if that also fails, a `backup-{datetime}` fallback branch is created and pushed
4. `GitBackupService.performBackup()` executes add → commit → push
5. Authentication uses configurable credentials (`GIT_BACKUP_AUTH_USER` / `GIT_BACKUP_AUTH_PASSWORD`), falling back to `GITHUB_TOKEN` for backward compatibility
6. A final backup is performed during graceful shutdown
7. Push conflicts during periodic backup trigger an automatic `pull --rebase` and one retry

**Key Components:**

- `src/core/git-backup-service.ts` — Git operation encapsulation
- `src/core/git-backup-scheduler.ts` — Fixed-interval scheduling

### 15. External Skill Auto-Installation (Feature 27)

Enables automatic installation of external Agent Skills at startup via `npx --yes --package=skills skills add`.

**Configuration:**

```yaml
agent:
  externalSkills:
    - repo: "jim60105/copilot-prompt"
      skill: "create-blog-post"
```

**Environment Variable Override:**

- `AGENT_EXTERNAL_SKILLS` → `agent.externalSkills` (JSON string, e.g. `[{"repo":"owner/repo","skill":"skill-name"}]`)

**How It Works:**

1. Configured in `config.yaml` under `agent.externalSkills` or via `AGENT_EXTERNAL_SKILLS` env var
2. `installExternalSkills()` runs during `bootstrap()`, after config loading and before `AgentCore` initialization
3. Skills are installed sequentially to avoid filesystem conflicts in `~/.agents/skills/`
4. Each skill is installed via `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y`
5. Individual installation failures are logged but do **not** block application startup

**Key Components:**

- `src/core/skill-installer.ts` — Sequential skill installation logic
- `src/types/config.ts` — `ExternalSkillConfig` interface
- `src/utils/env.ts` — `AGENT_EXTERNAL_SKILLS` JSON parsing
- `src/core/config-loader.ts` — Validation (filters invalid entries, defaults to empty array)

### 14. Session Audit Log (Feature 25)

Per-session JSONL audit trail for replay and debugging. Each session writes timestamped entries tracking the full lifecycle from trigger receipt through context assembly, agent interaction, skill calls, replies, and session end.

**Audit Phases:**

| Phase                    | Description                          |
| ------------------------ | ------------------------------------ |
| `trigger_received`       | Incoming trigger event recorded      |
| `session_start`          | Session registered and configured    |
| `rate_limit_checked`     | Rate limit evaluation result         |
| `context_assembly`       | Context assembly completed           |
| `yolo_resolution`        | YOLO mode resolution                 |
| `agent_connect`          | Agent subprocess connected           |
| `prompt_sent`            | Prompt sent to agent                 |
| `agent_message`          | Full prompt/context sent to agent    |
| `skill_call`             | Skill API invoked                    |
| `memory_operation`       | Memory skill operation               |
| `agent_response`         | Agent response received              |
| `agent_complete_message` | Agent complete buffered response     |
| `reply_sent`             | Reply sent to platform               |
| `reply_edited`           | Reply edited on platform             |
| `retry_triggered`        | Missing-reply retry activated        |
| `session_end`            | Session lifecycle completed          |
| `permission_approved`    | Permission request approved          |
| `permission_denied`      | Permission request denied            |

**Configuration:**

```yaml
audit:
  enabled: false
  retentionDays: 7
  hashContent: true
  includedPhases:
    - "trigger_received"
    - "skill_call"
    - "reply_sent"
    - "session_end"
```

**Environment Variable Overrides:**

| Environment Variable    | Config Path            | Type                 |
| ----------------------- | ---------------------- | -------------------- |
| `AUDIT_ENABLED`         | `audit.enabled`        | `"true"` / `"false"` |
| `AUDIT_RETENTION_DAYS`  | `audit.retentionDays`  | Integer string       |
| `AUDIT_HASH_CONTENT`    | `audit.hashContent`    | `"true"` / `"false"` |
| `AUDIT_INCLUDED_PHASES` | `audit.includedPhases` | Comma-separated      |

**How It Works:**

1. `SessionAuditWriter` is created per-session when audit is enabled
2. Entries are written as append-only JSONL to `data/audit/{platform}/{userId}/{sessionId}.jsonl`
3. `write()` is fire-and-forget — I/O errors never crash the session
4. Phase filtering: when `includedPhases` is non-empty, only matching phases are recorded
5. Content hashing: when `hashContent` is true, user content fields are SHA-256 hashed via `sanitizeSkillParams()`
6. Retention cleanup runs at startup and every 24 hours, deleting files older than `retentionDays`
7. Skill call auditing is done in the Skill API Server (`src/skill-api/server.ts`)

**Phase-Specific `SessionAuditEntry.data` Fields:**

- `trigger_received`: `platform`, `channelId`, `userId`, `messageId`, `isDm`, `contentLength`, `attachmentCount`
- `session_start`: `sessionId`, `sessionType`, `workspaceKey`, `agentType`, `model`, `yolo`
- `rate_limit_checked`: `decision`, `userId`, `platform`, `requestCount`, `maxRequests`, `cooldownRemainingMs`
- `context_assembly`: `memoriesCount`, `recentMessagesCount`, `relatedMessagesCount`, `estimatedTokens`
- `agent_connect`: `agentType`, `capabilities`
- `prompt_sent`: `promptLength`, `imageCount`, `modelId`
- `agent_message`: `promptContentHash`, `promptLength`
- `skill_call`: `skillName`, `skillParams`, `skillResult`, `skillDurationMs`
- `memory_operation`: `operation`, `memoryId`, `visibility`, `tier`, `category`, `resultCount`
- `agent_response`: `stopReason`, `isRetry`
- `agent_complete_message`: `messageContentHash`, `messageLength`, `chunkCount`
- `reply_sent`: `replyContentHash`, `replyLength`, `platform`
- `reply_edited`: `originalMessageId`, `newMessageId`, `replyContentHash`, `replyLength`, `platform`
- `retry_triggered`: `retryCount`, `maxRetries`, `reason`
- `session_end`: `success`, `replySent`, `reactionSent`, `durationMs`, `error`, `repliesCount`, `skillCallsCount`, `memoryOpsCount`, `permissionDecisionsCount`
- `permission_approved` / `permission_denied`: `toolName`, `permissionKind`, `command`, `decision`, `reason`

**Key Components:**

- `src/types/audit.ts` — `AuditPhase` and `SessionAuditEntry` types
- `src/core/audit-logger.ts` — `SessionAuditWriter` (per-session JSONL writer)
- `src/core/audit-retention.ts` — `cleanupAuditLogs()` (retention cleanup)
- `src/core/audit-retention-scheduler.ts` — `AuditRetentionScheduler` (24h periodic cleanup)
- `src/utils/hash.ts` — `sha256Hash()` and `sanitizeSkillParams()`

## Prompt Template System

The system uses [Vento](https://vento.js.org/) as its prompt template engine, allowing easy customization without rebuilding containers.

### How It Works

The main system prompt (`prompts/system_reply.md`) uses Vento syntax. Fragment files are loaded via `{{ include }}` and assigned to variables with `{{ set }}`. The `loadSystemPrompt` function (in `src/core/config-loader.ts`) creates a Vento environment pointing at the prompts directory, then renders the template with context variables (platform, isDm, sessionId, etc.).

**Example:**

```markdown
<!-- prompts/system_reply.md -->

{{- set charName }}{{ include "./character_name.md" }}{{ /set -}}

You are {{ charName }}. {{ if isDm }}This is a private chat.{{ /if }}
```

```markdown
<!-- prompts/character_name.md -->

Yuna
```

**Result (isDm=true):**

```
You are Yuna. This is a private chat.
```

### Template Processing Rules

| Rule             | Behavior                                                            |
| ---------------- | ------------------------------------------------------------------- |
| Variable format  | `{{ variableName }}` outputs a variable value                       |
| Include syntax   | `{{ include "./filename.md" }}` loads a file from prompts directory |
| Conditionals     | `{{ if condition }}...{{ else }}...{{ /if }}`                       |
| Set variables    | `{{ set name }}...{{ /set }}` assigns content to a variable         |
| Content trimming | `{{- ... -}}` removes surrounding whitespace                        |
| Missing includes | Throws an error with the missing file name                          |
| Final result     | Rendered output is trimmed of leading/trailing whitespace           |
| Comments         | `{{# comment #}}` is excluded from output                           |

### Available Template Variables

| Variable                 | Type      | Description                                                      |
| ------------------------ | --------- | ---------------------------------------------------------------- |
| `isDm`                   | `boolean` | Whether this is a direct message conversation                    |
| `platform`               | `string`  | Platform name (`"discord"` / `"misskey"`)                        |
| `userId`                 | `string`  | User's platform ID                                               |
| `channelId`              | `string`  | Channel/conversation ID                                          |
| `guildId`                | `string`  | Server/guild ID (empty string if N/A)                            |
| `sessionId`              | `string`  | Current skill API session ID                                     |
| `agentType`              | `string`  | ACP agent type (`"opencode"`)                                    |
| `model`                  | `string`  | Model identifier (e.g., `"openrouter/deepseek/deepseek-v4-pro"`)   |
| `rssItems`               | `string`  | RSS items (self-research prompt only)                            |
| `workspaceKey`           | `string`  | Workspace key (memory maintenance prompt only)                   |
| `memoriesDump`           | `string`  | Memory JSON dump (memory maintenance only)                       |
| `minMemoryCount`         | `number`  | Minimum memory count threshold (memory maintenance prompt only)  |
| `recentMessagesFetched`  | `boolean` | Whether recent messages were fetched (spontaneous post only)     |
| `importantMemories`      | `string`  | Formatted important memories text (spontaneous post only)        |
| `recentMessages`         | `string`  | Formatted recent messages text (spontaneous post only)           |
| `availableEmojis`        | `string`  | Formatted available emojis text (spontaneous post only)          |
| `yolo`                   | `boolean` | Whether YOLO mode is enabled (bypasses permission restrictions)  |
| `canWriteAgentWorkspace` | `boolean` | Whether this session allows writing to agent workspace           |
| `userContextMessage`     | `string`  | Pre-formatted user context message (normal message prompt only)  |

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

### Adding New Template Features

To use new variables or conditionals in your templates:

1. Use `{{ variableName }}` directly in your template — available variables are listed above
2. Use `{{ include "./fragment.md" }}` to include other files from the prompts directory
3. Use `{{ if condition }}...{{ /if }}` for conditional rendering
4. No code changes needed — Vento supports arbitrary JavaScript expressions
5. Test locally before deploying to containers

### File References

- Template Renderer: `src/core/template-renderer.ts` (`createTemplateEngine`, `renderTemplate`, `renderTemplateString`)
- Config Loader: `src/core/config-loader.ts` (`loadSystemPrompt`)
- Type Definitions: `src/types/template.ts` (`TemplateVariables`)
- Tests: `tests/core/template-renderer.test.ts`, `tests/core/config-loader.test.ts`
- OpenSpec Spec: `openspec/specs/prompt-template-system/spec.md`

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

### Message Template 語法

日誌訊息應使用 [Message Template](https://messagetemplates.org/) 語法 `{PropertyName}` 引用 context 中的結構化屬性。Logger 會自動將 `{PropertyName}` 替換為 context 中對應的值，同時保留原始模板作為 `messageTemplate` 欄位供日誌系統分類使用。

```typescript
// ✅ 正確 — 使用 {PropertyName} 引用 context 屬性
logger.info("Session {sessionId} model set to {modelId}", { sessionId, modelId });

// ❌ 錯誤 — 靜態訊息未包含主要識別符
logger.info("Session model set", { sessionId, modelId });

// ❌ 錯誤 — 使用 template literal 而非 message template（會破壞事件分類）
logger.info(`Session ${sessionId} model set to ${modelId}`, { sessionId, modelId });
```

**規則：**

- `{PropertyName}` 中的名稱必須與 context 物件的 key 完全一致
- 未匹配的佔位符保持原樣不替換
- 使用 `{{` 和 `}}` 來跳脫字面大括號
- 不包含 `{PropertyName}` 的訊息不會產生 `messageTemplate` 欄位（完全向後相容）
- `null`/`undefined` 值替換為空字串；物件型別使用 `JSON.stringify()` 序列化

### GELF Output

When `logging.gelf.enabled` is `true` and `logging.gelf.endpoint` is set, all log entries are also sent to a GELF HTTP endpoint via fire-and-forget `fetch()`. The GELF transport is initialized in `bootstrap.ts` and injected into the global logger config. The transport module is at `src/utils/gelf-transport.ts`.

GELF 輸出中，`messageTemplate` 會作為 `_messageTemplate` 自訂欄位傳送。

## Testing

- Unit tests: `{module}.test.ts`
- Integration tests: `{feature}.integration.test.ts`
- Use `Deno.test()` with `@std/assert`
- **Test coverage MUST be over 75%** — CI enforces this threshold; PRs below 75% coverage will fail

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
  system_prompt_path: "./prompts/system_reply.md"
  token_limit: 4096
  # External skills to install at startup (optional)
  # externalSkills:
  #   - repo: "jim60105/copilot-prompt"
  #     skill: "create-blog-post"
  # External MCP servers (optional, see config.example.yaml for full examples)
  # mcpServers:
  #   - name: "github"
  #     command: "npx"
  #     args: ["-y", "@modelcontextprotocol/server-github"]
  #     env:
  #       GITHUB_TOKEN: "${GITHUB_TOKEN}"

memory:
  search_limit: 10
  max_chars: 2000

workspace:
  repo_path: "./data"
  workspaces_dir: "workspaces"

replyPolicy: "channels"
channels:
  - id: "discord/account/12345678901234567"
    rateLimitBypass: true
    yolo: true # Run Agent in YOLO mode for this account

dashboard:
  enabled: false
  port: 8090
  host: "127.0.0.1"        # Bind host; default localhost. Set "0.0.0.0" to expose on all interfaces (DASHBOARD_HOST)
  passphrase: ""            # Required when enabled; minimum 16 characters (DASHBOARD_PASSPHRASE)
  behindHttpsProxy: false   # Enables the Secure cookie flag; NOT derived from X-Forwarded-Proto (DASHBOARD_BEHIND_HTTPS_PROXY)
  trustedProxies: []        # Real connection addresses whose X-Forwarded-For is trusted for login rate-limit keying (DASHBOARD_TRUSTED_PROXIES)
```

**Dashboard security defaults:** the dashboard binds to `127.0.0.1` by default and requires an explicit `0.0.0.0` to expose on all interfaces. The login rate limit keys on the real connection address (not the spoofable `X-Forwarded-For`) unless the peer is in `trustedProxies`, with an additional global backoff. A minimum 16-character passphrase is enforced at config load when the dashboard is enabled. The session cookie's `Secure` flag is driven by `behindHttpsProxy`, never by request headers.

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
│   │   ├── channel-lurk-scheduler.ts # Channel lurk reply scheduler (Discord only)
│   │   ├── self-research-scheduler.ts # Self-research scheduling
│   │   ├── memory-maintenance-scheduler.ts # Memory maintenance scheduling
│   │   ├── audit-logger.ts          # Session audit JSONL writer
│   │   ├── audit-retention.ts       # Audit log retention cleanup
│   │   ├── audit-retention-scheduler.ts # Audit retention scheduling
│   │   ├── skill-installer.ts           # External skill auto-installation
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
│   │   ├── audit.ts          # Audit log types
│   │   └── logger.ts         # Logger types
│   └── utils/
│       ├── logger.ts         # Structured JSON logging
│       ├── rss-fetcher.ts    # RSS/Atom feed fetching and parsing
│       ├── hash.ts           # SHA-256 hashing and content sanitization
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
│   ├── edit-reply/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── edit-reply.ts
│   └── lib/
│       └── client.ts         # Shared skill API client
├── prompts/
│   └── system_reply.md             # Bot system prompt
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
├── agent-config/             # Agent CLI configuration files
│   └── opencode.json         # OpenCode CLI configuration
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
5. ✅ Test coverage is over 75%
6. ✅ All CI checks pass — PRs will only be merged after all CI jobs succeed
7. ✅ No sensitive data in code or logs
8. ✅ When adding new configuration or environment variables, update **all** of:
   - `config.example.yaml`
   - `.env.example`
   - `helm/values.yaml` (under `env:` section)

## Related Documentation

- [docs/DESIGN.md](docs/DESIGN.md) - Detailed design document
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development setup and customization guide
- [docs/PLATFORM_INTEGRATION.md](docs/PLATFORM_INTEGRATION.md) - Guide for adding new platform support
- [openspec/specs/](openspec/specs/) - OpenSpec specifications
- [ACP Protocol Spec](https://agentclientprotocol.org/) - Agent Client Protocol
- [Agent Skills Standard](https://agentskills.io/) - SKILL.md format
