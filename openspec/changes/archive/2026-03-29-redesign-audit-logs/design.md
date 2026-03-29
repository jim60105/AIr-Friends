## Context

AIr-Friends currently audits 10 session lifecycle phases via `SessionAuditWriter` (per-session JSONL). The audit captures context assembly through session end, plus skill calls and permission decisions. However, several critical gaps exist:

- **No trigger capture**: The incoming platform event that initiated the session is not recorded. If a session fails early, there is no audit trace of what triggered it.
- **No session start**: The gap between trigger arrival and context assembly (workspace setup, session registration, YOLO resolution) is invisible.
- **No rate-limit visibility**: Rejected requests vanish silently — there is no way to know a user was rate-limited.
- **No edit-reply tracking**: `edit-reply` skill calls are recorded as generic `skill_call` entries, losing the semantic distinction between sending and editing.
- **No memory operation detail**: Memory mutations are only visible as `skill_call` entries with opaque params; there is no structured memory-operation audit.
- **No retry tracking**: The missing-reply retry mechanism fires without an audit trail.
- **No session summary counters**: Determining how many replies, skill calls, or memory ops occurred in a session requires parsing every JSONL line.

All changes extend the existing `SessionAuditWriter` infrastructure. No new files or dependencies are needed.

## Goals / Non-Goals

**Goals:**

- Provide a complete chronological narrative for every session, from trigger to teardown.
- Make every state transition and side effect auditable without parsing skill params.
- Add session-level summary counters to `session_end` for quick aggregation.
- Maintain backward compatibility: existing phases and entry shapes are unchanged.
- Keep fire-and-forget semantics: no audit write can crash a session.

**Non-Goals:**

- Full message content logging (content hashing policy is unchanged).
- Real-time audit streaming or webhooks.
- Audit of configuration changes, platform reconnections, or scheduler events.
- Dashboard UI changes for new phases (can be done in a follow-up).
- Changing the JSONL storage format or file path structure.

## Decisions

### D1: Eight new audit phases added to existing `AuditPhase` union

**Decision**: Add `trigger_received`, `session_start`, `rate_limit_checked`, `reply_edited`, `memory_operation`, `retry_triggered`, `agent_message`, and `agent_complete_message` to the `AuditPhase` type.

**Rationale**: Each phase represents a semantically distinct event that is currently invisible in audit logs. Using dedicated phases (rather than overloading `skill_call`) enables phase filtering, Prometheus label granularity, and dashboard-specific rendering.

**Alternative considered**: Embedding new data in existing phases (e.g., trigger info in `context_assembly`). Rejected because it conflates distinct lifecycle events and breaks phase filtering semantics.

### D2: `trigger_received` written in message-handler before rate-limit check

**Decision**: Write `trigger_received` in `MessageHandler.handleMessage()` (or equivalent entry point) immediately after normalizing the event, before rate-limit evaluation.

**Rationale**: This ensures every incoming event is recorded, including those that are subsequently rate-limited or rejected. The audit writer must be created early (before session registration) using a deterministic audit path derived from the event metadata.

**Implementation note**: Since `SessionAuditWriter` is normally per-session and the session ID is not yet assigned at trigger time, we will create a lightweight "pre-session" audit writer using a deterministic temporary session ID (e.g., `pre_{messageId}`) that is later linked to the actual session ID in `session_start`. Alternatively, `trigger_received` can be written by the `SessionOrchestrator` at the very beginning of each `process*` method where the session ID is already available. The second approach is simpler and preferred — it means `trigger_received` is the first entry in each session's JSONL file.

### D3: `session_start` written after session registration

**Decision**: Write `session_start` immediately after `SessionOrchestrator` registers the session in the session registry, capturing workspace key, session type, agent type, model, and YOLO mode.

**Rationale**: This bridges the gap between trigger and context assembly, making workspace and configuration decisions auditable.

### D4: `rate_limit_checked` written for both allowed and rejected requests

**Decision**: Write `rate_limit_checked` after every rate-limit evaluation, recording the decision (allowed/rejected), remaining quota, and cooldown status.

**Rationale**: Recording only rejections would create a selection bias. Recording both outcomes enables rate-limit tuning and anomaly detection.

**Implementation note**: For rejected requests, the session ends immediately after the rate-limit check, so `rate_limit_checked` may be the last entry. For allowed requests, the session continues normally.

### D5: `reply_edited` written in skill-api server alongside existing `reply_sent`

**Decision**: Add a `reply_edited` audit write in the `edit-reply` handler in `src/skill-api/server.ts`, mirroring the pattern used for `reply_sent`.

**Rationale**: Edit operations have distinct semantics (original messageId, new messageId) that are lost when recorded as generic `skill_call` entries.

### D6: `memory_operation` written in skill-api server for memory skills

**Decision**: Add `memory_operation` audit writes in the skill-api server for `memory-save`, `memory-search`, `memory-patch`, and `memory-stats` handlers, recording operation type, memory ID (for save/patch), visibility, tier, and category.

**Rationale**: Memory mutations are the most impactful side effects of a session. Structured audit entries enable memory debugging without parsing raw skill params.

### D7: `retry_triggered` written in session-orchestrator retry logic

**Decision**: Write `retry_triggered` when `SessionOrchestrator` detects a missing reply and initiates a retry prompt.

**Rationale**: Retry behavior is a critical debugging signal. Without explicit audit, it is impossible to distinguish a successful first-attempt reply from a retry-recovered reply.

### D8: Summary counters in `session_end` via in-memory tracking

**Decision**: Track `repliesCount`, `skillCallsCount`, `memoryOpsCount`, and `permissionDecisionsCount` as in-memory counters during the session, then include them in the `session_end` audit entry.

**Rationale**: Enables quick session-level aggregation without parsing the full JSONL file. Counters are incremented at the same points where the corresponding audit entries are written.

**Implementation note**: Counters can be tracked in the session registry entry or in a lightweight counter object passed alongside the audit writer.

### D9: `agent_message` written when prompt is sent to ACP agent

**Decision**: Write an `agent_message` audit entry in `SessionOrchestrator` immediately after the assembled prompt/context is sent to the ACP agent via `connector.prompt()`. The entry records `promptContentHash` (SHA-256 when `hashContent` is true), `promptLength`, and `model`.

**Rationale**: The existing `prompt_sent` phase records only the prompt length. `agent_message` captures a content hash of the actual message sent, enabling verification of what the agent received without storing the full prompt text.

### D10: `agent_complete_message` written via ChatbotClient.flushMessageBuffer()

**Decision**: Write an `agent_complete_message` audit entry in `ChatbotClient.flushMessageBuffer()` alongside the existing `logger.info("Agent complete message ...")` log. The entry records `messageContentHash` (SHA-256 when `hashContent` is true), `messageLength`, `chunkCount`, and the complete `message` text (subject to content hashing).

**Rationale**: The agent's response is currently only logged at INFO level and lost in general log output. Making it an audit entry ties the agent's reasoning output to the session's JSONL file, enabling end-to-end session replay. The `flushMessageBuffer()` call site already accumulates streamed chunks into a complete message, so this is the natural place to emit the audit entry.

**Implementation note**: `ChatbotClient` needs access to the `SessionAuditWriter`. This can be injected via the existing `setAuditWriter()` pattern used in session-orchestrator.

## Risks / Trade-offs

- **[Increased audit volume]** → 8 new phases increase JSONL file size by ~40-60% per session. Mitigation: phase filtering (`includedPhases`) allows operators to record only phases they need; retention cleanup already handles disk usage.
- **[Pre-session audit for trigger_received]** → Writing `trigger_received` before session ID is assigned requires careful ordering. Mitigation: Decision D2 chose the simpler approach of writing it as the first entry in the session's JSONL using the already-assigned session ID inside `SessionOrchestrator`.
- **[Counter drift]** → If an audit entry is written but the corresponding counter is not incremented (or vice versa), summary counters become inaccurate. Mitigation: increment counters at the same call site as the audit write, keeping them co-located.
- **[Backward compatibility of dashboard-audit-history-loader]** → The dashboard loader parses first/last JSONL entries. Adding `trigger_received` as the first entry (instead of `context_assembly`) changes what the loader sees. Mitigation: The loader already handles any phase for the first entry; it only reads `ts` and `phase` for metadata, not phase-specific fields.
