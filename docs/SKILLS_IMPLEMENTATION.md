# Agent Skills Implementation Summary

This document summarizes the implementation of SKILL.md definition files and skill handlers for the AIr-Friends project.

## Overview

We have implemented a complete Agent Skills system that allows external ACP Agents (like GitHub Copilot CLI, Gemini CLI, and OpenCode CLI) to interact with our chatbot through standardized SKILL.md files.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     外部 ACP Agent                               │
│              (GitHub Copilot CLI / Gemini CLI / OpenCode CLI)    │
│                                                                  │
│  1. 讀取 working_dir/.github/skills/*.md                         │
│  2. 解析 SKILL.md YAML frontmatter                              │
│  3. 根據需要呼叫 skill                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Our Chatbot (ACP Client)                     │
│                                                                  │
│  SKILL.md 定義檔 (.github/skills/)                               │
│  ├── memory-save.md                                             │
│  ├── memory-search.md                                           │
│  ├── send-reply.md                                              │
│  ├── fetch-context.md                                           │
│  └── memory-patch.md                                            │
│  └── memory-stats.md                                            │
│                              │                                   │
│  Skill 處理程式 (src/skills/)                                    │
│  ├── types.ts - Type definitions                                │
│  ├── memory-handler.ts - Memory operations                      │
│  ├── reply-handler.ts - Send reply (once per interaction)       │
│  ├── context-handler.ts - Fetch platform context                │
│  ├── registry.ts - Skill registration and execution             │
│  └── index.ts - Public exports                                  │
└─────────────────────────────────────────────────────────────────┘
```

## SKILL.md Files

Located in `.github/skills/`, these files follow the [Agent Skills Standard](https://agentskills.io/) format:

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
  - `attachments`: Optional attachments (not fully implemented yet)
- **Critical Rule**: Can only be called ONCE per interaction
- **Reply Threading**: When triggered from a note (Misskey) or message, the reply is threaded to the original note/message using `replyToMessageId` from the SkillContext. For new conversations without a triggering message, a new note/message is created instead.

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
- **Limitations**: Cannot modify content, only disable

### 6. memory-stats.md

- **Purpose**: Get memory statistics for the current workspace
- **Parameters**: None
- **Returns**: Statistics object with public/private/summary counts (total, enabled, disabled, high-importance, normal-importance)
- **Privacy**: Private statistics only included in DM contexts

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

**Key Features**:

- Parameter validation for all inputs
- Security check: private memories only in DM contexts
- Proper error handling and logging

### Reply Handler (src/skills/reply-handler.ts)

Manages reply sending with strict once-per-interaction enforcement:

- `handleSendReply`: Sends reply via platform adapter
- Session tracking to prevent multiple replies
- `clearReplyState`: Clears state for new interactions

**Critical Feature**: Maintains state map to ensure only one reply per session

### Context Handler (src/skills/context-handler.ts)

Fetches additional context from platform:

- `handleFetchContext`: Routes to appropriate context fetch method
- Supports:
  - Recent messages (via `fetchRecentMessages`)
  - Message search (via `searchRelatedMessages`)
  - User info (via `getUsername`)

### Skill Registry (src/skills/registry.ts)

Central registry for all skills:

- `executeSkill`: Executes skill by name
- `getAvailableSkills`: Lists all registered skills
- `hasSkill`: Checks if skill exists
- `getReplyHandler`: Access to reply handler for state management

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

## Integration Points

To use the SkillRegistry in the main application:

```typescript
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";

// Initialize
const skillRegistry = new SkillRegistry(memoryStore);

// Execute skill
const result = await skillRegistry.executeSkill(
  "memory-save",
  { content: "User likes hiking", visibility: "public" },
  context,
);

// Clear reply state for new interaction
const replyHandler = skillRegistry.getReplyHandler();
replyHandler.clearReplyState(workspaceKey, channelId);
```

## Security Considerations

1. **Workspace Isolation**: All operations respect workspace boundaries
2. **Private Memory Protection**: Private memories only accessible in DM contexts
3. **Parameter Validation**: All inputs validated before processing
4. **Once-per-interaction**: Reply sending enforced to prevent spam
5. **Error Handling**: All errors caught and logged without crashing

## Future Enhancements

1. **Attachment Support**: Full implementation of file/image attachments in send-reply
2. **Memory Compression**: Automatic memory summarization for large contexts
3. **Advanced Search**: Semantic search in memories using embeddings
4. **Skill Permissions**: Fine-grained control over which skills can be called
5. **Skill Analytics**: Track skill usage and performance metrics

## Conclusion

This implementation provides a complete Agent Skills system that follows the Agent Skills Standard, integrates seamlessly with the existing codebase, and includes comprehensive tests. External ACP Agents can now read the SKILL.md files from the workspace and call our skill handlers to perform operations like memory management, context fetching, and reply sending.
