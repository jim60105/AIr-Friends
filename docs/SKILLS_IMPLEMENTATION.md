# Agent Skills Implementation Summary

This document summarizes the implementation of SKILL.md definition files and skill handlers for the AIr-Friends project.

## Overview

We have implemented a complete Agent Skills system that allows the external OpenCode CLI ACP Agent to interact with our chatbot through standardized SKILL.md files.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     外部 ACP Agent                               │
│                        (OpenCode CLI)                            │
│                                                                  │
│  1. 讀取 skills/{name}/SKILL.md                                  │
│  2. 解析 SKILL.md YAML frontmatter                              │
│  3. 根據需要呼叫 skill                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Our Chatbot (ACP Client)                     │
│                                                                  │
│  SKILL.md 定義檔 (skills/{name}/SKILL.md)                        │
│  ├── memory-save/SKILL.md                                       │
│  ├── memory-search/SKILL.md                                     │
│  ├── memory-patch/SKILL.md                                      │
│  ├── memory-stats/SKILL.md                                      │
│  ├── memory-export/SKILL.md                                     │
│  ├── send-reply/SKILL.md                                        │
│  ├── edit-reply/SKILL.md                                        │
│  ├── get-message/SKILL.md                                       │
│  ├── send-file/SKILL.md                                         │
│  ├── fetch-context/SKILL.md                                     │
│  ├── react-message/SKILL.md                                     │
│  ├── set-reminder/SKILL.md                                      │
│  ├── cancel-reminder/SKILL.md                                   │
│  └── list-reminders/SKILL.md                                    │
│                              │                                   │
│  Skill 處理程式 (src/skills/)                                    │
│  ├── types.ts - Type definitions                                │
│  ├── memory-handler.ts - Memory operations                      │
│  ├── reply-handler.ts - Send/edit reply, get message             │
│  ├── reaction-handler.ts - Emoji reactions                       │
│  ├── context-handler.ts - Fetch platform context                │
│  ├── reminder-handler.ts - Reminder operations                  │
│  ├── file-handler.ts - Send file from workspace                  │
│  ├── registry.ts - Skill registration and execution             │
│  └── index.ts - Public exports                                  │
└─────────────────────────────────────────────────────────────────┘
```

## SKILL.md Files

Located in `skills/{name}/SKILL.md`, these files follow the [Agent Skills Standard](https://agentskills.io/) format:

### 1. memory-save.md

- **Purpose**: Save important information to persistent memory
- **Parameters**:
  - `content` (required): Memory content to save
  - `visibility`: "public" or "private" (default: "public")
  - `importance`: "high" or "normal" (default: "normal")
- **Key Features**:
  - Append-only (cannot be deleted)
  - Private memories only in DM contexts
  - High importance memories always loaded into context

### 2. memory-search.md

- **Purpose**: Search through saved memories
- **Parameters**:
  - `query` (required): Search keywords
  - `limit`: Maximum results (default: 10)
- **Returns**: Array of matching memories

### 3. send-reply.md

- **Purpose**: Send final reply to user
- **Parameters**:
  - `message` (required): Final message to send
- **Critical Rule**: Can only be called ONCE per interaction. After sending, use `edit-reply` to modify.
- **Reply Threading**: When triggered from a note (Misskey) or message, the reply is threaded to the original note/message using `replyToMessageId` from the SkillContext. For new conversations without a triggering message, a new note/message is created instead.
- **Content Processing**: Reply content is processed through `stripXmlTags()` (removes XML-like tags agents may emit) and `unescapeNewlines()` (converts literal `\n` sequences to actual newlines).
- **Doom-Loop Detection**: The Skill API Server tracks reply attempts per session. After `MAX_REPLIES_PER_SESSION` (1), subsequent send-reply calls return HTTP 429. After `MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE` (4) total attempts, the agent process is terminated to prevent infinite retry loops. Similarly, `edit-reply` has `MAX_EDIT_CALLS_BEFORE_TERMINATE` (3) — the 3rd edit attempt triggers agent termination.

### 4. fetch-context.md

- **Purpose**: Fetch additional context from platform
- **Parameters**:
  - `type` (required): "recent_messages", "search_messages", or "user_info"
  - `query`: Search query (for search_messages)
  - `limit`: Maximum items (default: 20)
- **Use Cases**: Get more history, search conversations, get user info

### 5. memory-patch.md

- **Purpose**: Modify memory metadata (not content)
- **Parameters**:
  - `memory_id` (required): ID of memory to modify
  - `enabled`: Enable/disable memory
  - `visibility`: Change visibility level
  - `importance`: Change importance level
  - `relatedTo`: Comma-separated IDs of semantically related memories
  - `supersedes`: Comma-separated IDs of memories this entry supersedes (maintenance lineage)
- **Limitations**: Cannot modify content, only disable

### 6. memory-stats.md

- **Purpose**: Get memory statistics for the current workspace
- **Parameters**: None
- **Returns**: Statistics object with public/private/summary counts (total, enabled, disabled, high-importance, normal-importance)
- **Privacy**: Private statistics only included in DM contexts

### 7. set-reminder

- **Purpose**: Set a one-time reminder to be delivered via DM at a future time
- **Parameters**:
  - `scheduledAt` (required): ISO 8601 UTC timestamp for when the reminder should fire
  - `message` (required): The reminder message content
- **Constraints**: DM-only, one per session, minimum 1 minute in the future, max 20 active per user
- **Returns**: `reminderId` and `scheduledAt` on success

### 8. cancel-reminder

- **Purpose**: Cancel a previously set reminder by its ID
- **Parameters**:
  - `reminderId` (required): The ID of the reminder to cancel (returned by set-reminder)
- **Constraints**: DM-only, can only cancel own reminders

### 9. list-reminders

- **Purpose**: List all active (pending) reminders for the current user
- **Parameters**: None
- **Constraints**: DM-only
- **Returns**: Array of active reminders with id, message, scheduledAt, createdAt

### 10. edit-reply

- **Purpose**: Edit the last reply message sent via send-reply
- **Parameters**:
  - `messageId` (required): The ID of the message to edit (obtained from send-reply result)
  - `message` (required): The new message content to replace the original
- **Key Features**:
  - Can be called multiple times within a session (up to 2 edits before termination)
  - Only edits messages sent by the bot in the current session
  - **Misskey**: Uses delete-and-recreate strategy; returned `messageId` will differ from original

### 11. react-message

- **Purpose**: Add an emoji reaction to the trigger message
- **Parameters**:
  - `emoji` (required): Emoji character (Unicode) or custom emoji name (`:name:` format)
- **Key Features**:
  - Can be used with or without send-reply
  - Only one reaction per session (replaces previous)
  - Requires a trigger message to react to (`replyToMessageId`)

### 12. memory-export

- **Purpose**: Export all memories for the current user as a file sent via DM
- **Parameters**:
  - `format`: Output format — `markdown` (default) or `json`
  - `importance`: Filter by importance — `high`, `normal`, or `all` (default: `all`)
  - `enabled-only`: Only include enabled memories — `true` (default) or `false`
- **Key Features**:
  - Always delivered via DM, even if requested in a public channel
  - Requires explicit user consent before execution

### 13. send-file

- **Purpose**: Send a file from the workspace to the user on the platform
- **Parameters**:
  - `file-path` (required): File path relative to the workspace root
  - `caption`: Optional text message to accompany the file
- **Key Features**:
  - Workspace boundary enforced (no path traversal)
  - Size limit (default 25 MB) and optional extension whitelist
  - Can be disabled by administrator via config

### 14. get-message

- **Purpose**: Get the content of a sent message by its ID
- **Parameters**:
  - `messageId`: The ID of the message to fetch. If omitted, returns the last message sent in the session.
- **Returns**: Message content, userId, username, timestamp, and isBot flag

## Skill Handlers Implementation

### Type Definitions (src/skills/types.ts)

- `SkillCall`: Structure of skill invocation
- `SkillResult`: Return value from skill execution
- `SkillContext`: Context passed to skill handlers, includes:
  - `workspace`: Workspace information
  - `platformAdapter`: Platform interface for sending messages
  - `channelId`: Target channel ID
  - `userId`: User who triggered the interaction
  - `replyToMessageId`: Optional original message ID for reply threading
- Parameter types for each skill

### Memory Handler (src/skills/memory-handler.ts)

Handles all memory-related operations:

- `handleMemorySave`: Validates parameters and saves memory using MemoryStore
- `handleMemorySearch`: Searches memories by keywords
- `handleMemoryPatch`: Patches memory metadata
- `handleMemoryStats`: Returns memory statistics
- `handleMemoryExport`: Exports memories as file via DM

**Key Features**:

- Parameter validation for all inputs
- Security check: private memories only in DM contexts
- Proper error handling and logging

### Reply Handler (src/skills/reply-handler.ts)

Manages reply sending with strict once-per-interaction enforcement:

- `handleSendReply`: Sends reply via platform adapter
- `handleEditReply`: Edits previously sent reply message
- `handleGetMessage`: Retrieves message content by ID
- Session tracking to prevent multiple replies
- `clearReplyState`: Clears state for new interactions
- Content processing: `stripXmlTags()` removes XML-like tags, `unescapeNewlines()` converts literal `\n` to newlines

**Critical Feature**: Maintains state map to ensure only one reply per session

### Context Handler (src/skills/context-handler.ts)

Fetches additional context from platform:

- `handleFetchContext`: Routes to appropriate context fetch method
- Supports:
  - Recent messages (via `fetchRecentMessages`)
  - Message search (via `searchRelatedMessages`)
  - User info (via `getUsername`)

### Reaction Handler (src/skills/reaction-handler.ts)

Manages emoji reactions on trigger messages:

- `handleReactMessage`: Adds emoji reaction via platform adapter
- Session tracking to prevent duplicate reactions
- `clearReactionState`: Clears state for new interactions
- Requires `replyToMessageId` (a trigger message to react to)

### Reminder Handler (src/skills/reminder-handler.ts)

Handles reminder CRUD operations (conditionally registered when reminders are enabled):

- `handleSetReminder`: Creates a one-time reminder (DM-only, one per session)
- `handleCancelReminder`: Cancels a reminder by ID (ownership verified)
- `handleListReminders`: Lists active pending reminders
- `clearSessionState`: Clears per-session tracking

### File Handler (src/skills/file-handler.ts)

Handles file sending from workspace (conditionally registered when send-file is enabled):

- `handleSendFile`: Reads file from workspace and sends via platform adapter
- Path security validation (no traversal, workspace boundary enforced)
- File size limit and extension whitelist checks

### Skill Registry (src/skills/registry.ts)

Central registry for all skills:

- `executeSkill`: Executes skill by name
- `getAvailableSkills`: Lists all registered skills
- `hasSkill`: Checks if skill exists
- `getReplyHandler`: Access to reply handler for state management
- `getReactionHandler`: Access to reaction handler for state management
- `getReminderHandler`: Access to reminder handler for session state management

## Testing

Comprehensive test suite in `tests/skills/`:

### memory-handler.test.ts

- Tests memory save with valid/invalid parameters
- Tests memory search functionality
- Tests memory patching

### reply-handler.test.ts

- Tests successful reply sending
- Tests once-per-interaction enforcement
- Tests parameter validation
- Tests state clearing

### registry.test.ts

- Tests skill registration
- Tests skill execution
- Tests unknown skill handling
- Tests access to reply handler

**All tests pass successfully!**

## Retry on Missing Reply

When an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without calling `send-reply` or `react-message`, the system automatically retries:

1. Clears the reply state (but not reaction state) to allow a new reply
2. Sends a retry prompt on the **same ACP session** requesting the agent to send a reply or reaction
3. Retry strategy is configured per agent type via `getRetryPromptStrategy()` in `src/acp/agent-factory.ts` (all agents: max 1 retry)
4. If the retry also fails to produce a reply or reaction, the system returns a failure response

## Integration Points

The skill system is integrated through the Skill API Server (`src/skill-api/server.ts`) which handles HTTP requests from shell-based skill scripts. The `SkillRegistry` is initialized with `MemoryStore` and optional `ReminderStore`/`SendFileSkillConfig`:

```typescript
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";

// Initialize with optional features
const skillRegistry = new SkillRegistry(
  memoryStore,
  remindersConfig, // optional
  reminderStore, // optional
  sendFileConfig, // optional
);

// Execute skill
const result = await skillRegistry.executeSkill(
  "memory-save",
  { content: "User likes hiking", visibility: "public" },
  context,
);
```

## Security Considerations

1. **Workspace Isolation**: All operations respect workspace boundaries
2. **Private Memory Protection**: Private memories only accessible in DM contexts
3. **Parameter Validation**: All inputs validated before processing
4. **Once-per-interaction**: Reply sending enforced to prevent spam
5. **Error Handling**: All errors caught and logged without crashing

## Skill Permissions

Skill permissions are enforced through a whitelist mechanism managed by `SkillAutoApproveList` in `src/acp/client.ts`. In restricted (non-YOLO) mode, only whitelisted skill commands are auto-approved; all other execution requests are rejected.

### Whitelist Matching

The auto-approve list uses two matching methods:

- **Script path matching** (`scriptPaths`): For skills with a `scripts/` directory, path suffixes like `skills/memory-save/scripts/memory-save.ts` are stored. A command is approved if any whitespace-delimited token exactly equals or ends with a stored path suffix.
- **Command prefix matching** (`commandPrefixes`): For command-based skills without a `scripts/` directory (e.g., `agent-browser`), the first whitespace-delimited token is checked for an exact match against stored prefixes.

### Configuration

The list can be configured explicitly via `agent.autoApproveSkills` in `config.yaml` or the `AGENT_AUTO_APPROVE_SKILLS` environment variable (comma-separated). When neither is configured, the system falls back to scanning the built-in `skills/` directory automatically.

For detailed documentation on permission layers and shell injection protection, see [Skill Auto-Approve List in AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md#skill-auto-approve-list).

## Future Enhancements

1. **Memory Compression**: Automatic memory summarization for large contexts
2. **Advanced Search**: Semantic search in memories using embeddings
3. **Skill Analytics**: Track skill usage and performance metrics

## Conclusion

This implementation provides a complete Agent Skills system that follows the Agent Skills Standard, integrates seamlessly with the existing codebase, and includes comprehensive tests. External ACP Agents can now read the SKILL.md files from the workspace and call our skill handlers to perform operations like memory management, context fetching, and reply sending.
