## Context

In `src/acp/client.ts`, `ChatbotClient` handles `sessionUpdate` callbacks from external ACP agents. Currently, when `agent_message_chunk` updates arrive, they are pushed into an internal `messageBuffer`. Whenever a non-chunk update arrives (`tool_call`, `plan`, `agent_thought_chunk`, etc.) or when the prompt completes (`AgentConnector.prompt`), `flushMessageBuffer()` is called. `flushMessageBuffer()` joins the chunks into a complete string, logs `"Agent complete message ({chunkCount} chunks, {length} chars): {message}"` at INFO level, and writes an `agent_complete_message` audit entry if an audit writer is present.

By contrast, `agent_thought_chunk` updates are only logged per chunk at DEBUG level (`"Agent thought: {text}"`) and are not buffered or aggregated. This makes reviewing complete agent reasoning traces fragmented in logs and absent as a unified entry in session audit files (`.jsonl`).

## Goals / Non-Goals

**Goals:**
- Implement `thoughtBuffer: string[] = []` in `ChatbotClient` alongside `messageBuffer`.
- Implement `flushThoughtBuffer()` in `ChatbotClient` mirroring `flushMessageBuffer()`, which joins `thoughtBuffer`, logs `"Agent complete thought ({chunkCount} chunks, {length} chars): {thought}"` at INFO level, and writes an `"agent_complete_thought"` audit log entry when `auditWriter` is present.
- Ensure mutual exclusivity of buffers during streaming: receiving an `agent_message_chunk` calls `flushThoughtBuffer()` before appending to `messageBuffer`, and receiving an `agent_thought_chunk` calls `flushMessageBuffer()` before appending to `thoughtBuffer`.
- Ensure any other session update (`tool_call`, `tool_call_update`, `plan`, `usage_update`, `config_option_update`, `default`) flushes both `messageBuffer` and `thoughtBuffer`.
- Ensure `flushThoughtBuffer()` is called in `AgentConnector.prompt()`'s `finally` block and in `ChatbotClient.reset()`.
- Support `"agent_complete_thought"` phase in `SessionAuditWriter` and `AuditPhase`.

**Non-Goals:**
- Changing existing per-chunk DEBUG logging for either `agent_message_chunk` or `agent_thought_chunk`.
- Sending thought contents externally to platforms (Discord/Misskey) or modifying reply behavior.

## Decisions

1. **Flush Behavior on Transitions (`agent_thought_chunk` vs `agent_message_chunk`)**
   - *Decision*: When `agent_thought_chunk` arrives, call `this.flushMessageBuffer()` before adding to `thoughtBuffer`. When `agent_message_chunk` arrives, call `this.flushThoughtBuffer()` before adding to `messageBuffer`.
   - *Rationale*: Models typically alternate between thought blocks and message blocks or emit thoughts before messages. Flushing the opposing buffer on arrival guarantees clean separation between complete thought spans and complete message spans.

2. **Audit Entry Payload Structure**
   - *Decision*: The `agent_complete_thought` audit entry will contain:
     - `thoughtContentHash`: string (either plaintext or `sha256:...` depending on `AuditConfig.hashContent`)
     - `thoughtLength`: number
     - `chunkCount`: number
   - *Rationale*: This mirrors `agent_complete_message` (`messageContentHash`, `messageLength`, `chunkCount`) exactly, ensuring uniform downstream processing in audit viewers.

3. **Log Message Format and Level**
   - *Decision*: Log `"Agent complete thought ({chunkCount} chunks, {length} chars): {thought}"` at INFO level.
   - *Rationale*: Exactly matches `"Agent complete message ({chunkCount} chunks, {length} chars): {message}"` at INFO level.

4. **Deterministic Flush Ordering**
   - *Decision*: Whenever flushing both buffers (in non-chunk session updates, `AgentConnector.prompt()` finally block, or `ChatbotClient.reset()`), always execute `this.flushThoughtBuffer()` before `this.flushMessageBuffer()`.
   - *Rationale*: An agent's internal reasoning chronologically precedes its final response message. Deterministic flush ordering ensures logs and audit trails record `agent_complete_thought` before `agent_complete_message`.

5. **Guarding Against Empty Thought Chunks**
   - *Decision*: Only push `thoughtText` to `thoughtBuffer` when `thoughtText.length > 0`.
   - *Rationale*: Prevents empty updates from inflating `chunkCount` with empty strings.

6. **Strict Buffer Isolation**
   - *Decision*: Maintain `thoughtBuffer` and `messageBuffer` as completely separate arrays and clear each independently immediately upon flushing (`this.thoughtBuffer = []` / `this.messageBuffer = []`).
   - *Rationale*: Prevents any possibility of thought chunks mixing with message chunks even when an agent alternates between reasoning and generating response messages.

7. **Strictly Non-Blocking Logging & Synchronous Timestamp Capture**
   - *Decision*: Audit log writes remain strictly fire-and-forget (`void writer.write(...)`) to prevent logging from obstructing main program execution. To guarantee exact event timestamps on downstream log servers even when SHA-256 content hashing runs asynchronously, `SessionAuditWriter.write(phase, data, timestamp?)` accepts an optional exact timestamp captured synchronously when `flushThoughtBuffer()` / `flushMessageBuffer()` is invoked.
   - *Rationale*: Ensures accurate temporal sequencing on log servers without introducing blocking or artificial queuing into the chatbot client.

## Risks / Trade-offs

- **[Risk] High volume of INFO logs for verbose thinking models** → *Mitigation*: Since `flushThoughtBuffer()` only emits one INFO log entry per contiguous block of thought chunks (rather than per chunk), log volume remains minimal (typically 1-2 entries per turn).
- **[Risk] Unflushed buffers on abnormal termination** → *Mitigation*: Calling `flushThoughtBuffer()` in `AgentConnector.prompt()`'s `finally` block ensures any accumulated thoughts are flushed even if the prompt or stream terminates abnormally or times out.
- **[Risk] Broken unit test asserting 18 `AuditPhase` literals** → *Mitigation*: Update `tests/types/audit.test.ts` to assert 19 literals including `"agent_complete_thought"`.

## Migration Plan

No migration needed. Fully backward compatible with existing audit files and configurations.

## Open Questions

None.
