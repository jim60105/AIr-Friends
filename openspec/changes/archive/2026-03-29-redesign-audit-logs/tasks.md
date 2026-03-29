## 1. Type Definitions

- [x] 1.1 Add 8 new phase literals (`trigger_received`, `session_start`, `rate_limit_checked`, `reply_edited`, `memory_operation`, `retry_triggered`, `agent_message`, `agent_complete_message`) to the `AuditPhase` union type in `src/types/audit.ts`
- [x] 1.2 Add phase-specific data fields to `SessionAuditEntry` in `src/types/audit.ts`: trigger fields (`platform`, `channelId`, `userId`, `messageId`, `isDm`, `contentLength`, `attachmentCount`), session start fields (`sessionType`, `workspaceKey`, `agentType`, `model`, `yolo`), rate limit fields (`decision`, `requestCount`, `maxRequests`, `cooldownRemainingMs`), reply edited fields (`originalMessageId`, `newMessageId`, `replyContentHash`, `replyLength`), memory operation fields (`operation`, `memoryId`, `visibility`, `tier`, `category`, `resultCount`), retry fields (`retryCount`, `maxRetries`, `reason`), agent message fields (`promptContentHash`, `promptLength`, `model`), agent complete message fields (`messageContentHash`, `messageLength`, `chunkCount`)
- [x] 1.3 Add summary counter fields (`repliesCount`, `skillCallsCount`, `memoryOpsCount`, `permissionDecisionsCount`) to the `session_end` data shape in `SessionAuditEntry`

## 2. Session Orchestrator — New Phase Writes

- [x] 2.1 Add `trigger_received` audit write as the first audit entry in each `process*` method in `src/core/session-orchestrator.ts` (message, spontaneous, self-research, memory-maintenance, channel-lurk, reminder), populating `platform`, `channelId`, `userId`, `messageId`, `isDm`, `contentLength`, `attachmentCount`
- [x] 2.2 Add `session_start` audit write immediately after session registration in each `process*` method, populating `sessionId`, `sessionType`, `workspaceKey`, `agentType`, `model`, `yolo`
- [x] 2.3 Add `retry_triggered` audit write in the retry logic (where missing-reply retry prompt is sent), populating `retryCount`, `maxRetries`, `reason`
- [x] 2.4 Add `agent_message` audit write after sending prompt to ACP agent via `connector.prompt()`, populating `promptContentHash` (SHA-256 when hashContent enabled), `promptLength`, `model`

## 2a. ChatbotClient — Agent Complete Message Audit

- [x] 2a.1 Inject `SessionAuditWriter` into `ChatbotClient` via `setAuditWriter()` method (or reuse existing pattern from session-orchestrator)
- [x] 2a.2 Add `agent_complete_message` audit write in `ChatbotClient.flushMessageBuffer()`, populating `messageContentHash` (SHA-256 when hashContent enabled), `messageLength`, `chunkCount`; skip when buffer is empty

## 3. Session Summary Counters

- [x] 3.1 Implement in-memory session counter tracking (repliesCount, skillCallsCount, memoryOpsCount, permissionDecisionsCount) — add counter state to session registry entry or audit writer
- [x] 3.2 Increment `skillCallsCount` in `src/skill-api/server.ts` at the existing `skill_call` audit write point
- [x] 3.3 Increment `repliesCount` in `src/skill-api/server.ts` at the existing `reply_sent` audit write point
- [x] 3.4 Increment `memoryOpsCount` at the `memory_operation` audit write point (Task 4.2)
- [x] 3.5 Increment `permissionDecisionsCount` in `src/acp/client.ts` at the permission audit write point
- [x] 3.6 Include all 4 summary counters in the `session_end` audit entry in `src/core/session-orchestrator.ts`

## 4. Skill API Server — New Phase Writes

- [x] 4.1 Add `reply_edited` audit write in the `edit-reply` handler in `src/skill-api/server.ts`, populating `originalMessageId`, `newMessageId`, `replyContentHash`, `replyLength`, `platform`
- [x] 4.2 Add `memory_operation` audit write for `memory-save`, `memory-search`, `memory-patch`, `memory-stats` handlers in `src/skill-api/server.ts`, populating `operation`, `memoryId`, `visibility`, `tier`, `category`, `resultCount`

## 5. Rate Limit Audit

- [x] 5.1 Add `rate_limit_checked` audit write after rate-limit evaluation in the message handling flow (likely in `src/core/agent-core.ts` or `src/core/session-orchestrator.ts`), populating `decision`, `userId`, `platform`, `requestCount`, `maxRequests`, `cooldownRemainingMs`

## 6. Content Hashing Updates

- [x] 6.1 Add `originalMessageId`, `newMessageId` to the non-hashed field list in `sanitizeSkillParams()` in `src/utils/hash.ts` (these are IDs, not user content)
- [x] 6.2 Verify `query` field in memory-search params is hashed correctly by existing content hashing logic

## 7. Documentation Updates

- [x] 7.1 Update the audit phase table in `AGENTS.md` to include all 18 phases with descriptions
- [x] 7.2 Update the `SessionAuditEntry` documentation in `AGENTS.md` to include new phase-specific fields and summary counters
- [x] 7.3 Update `config.example.yaml` `includedPhases` example to reference new phases

## 8. Tests

- [x] 8.1 Add unit tests for new `AuditPhase` literals in `src/types/audit.ts`
- [x] 8.2 Add unit tests for `trigger_received` and `session_start` audit writes in session orchestrator tests
- [x] 8.3 Add unit tests for `rate_limit_checked` audit write
- [x] 8.4 Add unit tests for `reply_edited` audit write in skill-api server tests
- [x] 8.5 Add unit tests for `memory_operation` audit write for each memory skill
- [x] 8.6 Add unit tests for `retry_triggered` audit write
- [x] 8.7 Add unit tests for session summary counters in `session_end` entry
- [x] 8.8 Add unit tests for `agent_message` audit write in session orchestrator tests
- [x] 8.9 Add unit tests for `agent_complete_message` audit write in ChatbotClient tests (verify it writes on flush, skips on empty buffer)
- [x] 8.10 Add integration test verifying a complete session JSONL file contains entries in the expected chronological order: `trigger_received` → `session_start` → `context_assembly` → `agent_message` → ... → `agent_complete_message` → ... → `session_end`
