## Why

The current audit system captures 10 phases but has significant blind spots: incoming triggers/events are not recorded, session start (workspace setup, session registration) is not audited, and the gap between "what happened" and "what we can reconstruct" makes debugging production issues difficult. A redesigned audit log should provide a complete, chronological narrative of every session — from the moment a trigger arrives to the final session teardown — so that any session can be fully replayed and diagnosed without guessing.

## What Changes

- **Add `trigger_received` phase**: Record the incoming platform event (platform, channelId, userId, messageId, isDm, attachment count) at the earliest point before any processing begins. This captures _what_ caused the session.
- **Add `session_start` phase**: Record workspace key, session type, session ID, agent type, model, and YOLO mode immediately after session registration — bridging the gap between trigger arrival and context assembly.
- **Add `rate_limit_checked` phase**: Record rate-limit evaluation results (allowed/rejected, remaining quota, cooldown status) so rejected requests are visible in audit trails.
- **Add `reply_edited` phase**: Record edit-reply operations (original messageId, new messageId, content hash, platform) to distinguish edits from initial sends.
- **Add `memory_operation` phase**: Record memory reads/writes/patches with operation type, memory ID, visibility, tier, and category — providing granular memory mutation tracking per session.
- **Add `retry_triggered` phase**: Record when the missing-reply retry mechanism activates, including retry count and reason, so retry behavior is auditable.
- **Add `agent_message` phase**: Record the complete assembled message sent to the ACP agent (prompt text length, content hash) so the exact input to the agent is auditable. This differs from `prompt_sent` which only records the prompt length — `agent_message` captures the full context sent.
- **Add `agent_complete_message` phase**: Record the agent's complete response message (buffered from streamed chunks) including chunk count, message length, and content hash. This corresponds to the existing `flushMessageBuffer()` log in `ChatbotClient` but makes it part of the audit trail.
- **Enrich existing `session_end` phase**: Add `repliesCount`, `skillCallsCount`, `memoryOpsCount`, and `permissionDecisionsCount` as session-level summary counters for quick aggregation without parsing the full log.
- **Structured `trigger` field in `session_start`**: Include normalized trigger metadata (platform, userId, channelId, messageId, isDm) for correlation with platform logs.

## Capabilities

### New Capabilities

_None — all changes extend the existing audit capability._

### Modified Capabilities

- `session-audit-log`: Adding 8 new audit phases (`trigger_received`, `session_start`, `rate_limit_checked`, `reply_edited`, `memory_operation`, `retry_triggered`, `agent_message`, `agent_complete_message`), enriching `session_end` with summary counters, and updating the `AuditPhase` type, `SessionAuditEntry` data fields, content-hashing rules, and documentation.

## Impact

- **`src/types/audit.ts`**: Add 8 new phase literals to `AuditPhase` union; extend `SessionAuditEntry.data` with new phase-specific fields.
- **`src/core/session-orchestrator.ts`**: Add `trigger_received` and `session_start` audit writes in all session type methods; add `retry_triggered` write in retry logic; enrich `session_end` with summary counters.
- **`src/core/message-handler.ts`**: Add `trigger_received` audit write at event ingestion point (before rate-limit check).
- **`src/core/agent-core.ts`** or rate-limit integration point: Add `rate_limit_checked` audit write after rate-limit evaluation.
- **`src/skill-api/server.ts`**: Add `reply_edited` audit write in edit-reply handler; add `memory_operation` audit write in memory skill handlers.
- **`src/skills/memory-handler.ts`**: Propagate audit writer to memory operations for `memory_operation` phase writes.
- **`openspec/specs/session-audit-log/spec.md`**: Delta spec updating phase list, entry schemas, and examples.
- **`AGENTS.md`**: Update audit phase table and `SessionAuditEntry` documentation.
- **Existing tests**: Update audit-related tests to cover new phases; no breaking changes to existing behavior.
- **No new dependencies**: All changes use existing infrastructure (`SessionAuditWriter`, JSONL append, Prometheus counters).
