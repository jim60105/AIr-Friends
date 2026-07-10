## Why

Currently, `ChatbotClient` buffers streaming `agent_message_chunk` updates and flushes them into a single complete message (`agent complete message`) log entry and audit record when switching to another event or when the prompt completes. However, `agent_thought_chunk` updates are only logged individually per chunk at DEBUG level without being buffered or aggregated. When inspecting logs or audit trails, it is difficult to read the agent's complete reasoning chain as a single cohesive block. Implementing an equivalent `agent complete thought` feature ensures uniform observability and auditability across both streaming responses and streaming thoughts.

## What Changes

- Add a `thoughtBuffer: string[]` in `ChatbotClient` to accumulate non-empty text (`thoughtText.length > 0`) from `agent_thought_chunk` session updates.
- Implement `flushThoughtBuffer()` in `ChatbotClient` to join accumulated thought chunks into a complete thought string (`agent complete thought`), log it at INFO level (`"Agent complete thought ({chunkCount} chunks, {length} chars): {thought}"`), and emit an `agent_complete_thought` audit entry if an audit writer is configured.
- Maintain strict buffer isolation: `thoughtBuffer` and `messageBuffer` are completely separate arrays and are cleared immediately upon flush (`this.thoughtBuffer = []` / `this.messageBuffer = []`), preventing thought chunks and message chunks from ever mixing together.
- Update `sessionUpdate` handling in `ChatbotClient` so that receiving an `agent_message_chunk` flushes `thoughtBuffer` (before pushing to `messageBuffer`), receiving an `agent_thought_chunk` flushes `messageBuffer` (before pushing to `thoughtBuffer`), and receiving any other update flushes both buffers deterministically (`flushThoughtBuffer()` first, then `flushMessageBuffer()`).
- Ensure `flushThoughtBuffer()` is called before `flushMessageBuffer()` when a prompt turn completes in `AgentConnector.prompt()` and when `ChatbotClient.reset()` is invoked.
- Add `agent_complete_thought` phase to session audit logging (`AuditPhase` type and `SessionAuditWriter`).
- Ensure audit logging is strictly non-blocking (fire-and-forget) so it never blocks or hinders main program execution. Ensure `SessionAuditWriter.write(phase, data, timestamp?)` accepts an optional timestamp captured synchronously at flush time (`flushThoughtBuffer` / `flushMessageBuffer`), guaranteeing accurate event timestamps for downstream log server ordering even during asynchronous file writes or SHA-256 content hashing.

## Capabilities

### New Capabilities

### Modified Capabilities
- `acp-integration`: Add requirement for buffering `agent_thought_chunk` updates in `ChatbotClient`, strict buffer isolation from messages, and flushing them as a complete thought log entry when non-thought-chunk updates arrive or prompt completion occurs.
- `session-audit-log`: Support `agent_complete_thought` audit phase in session audit trails with non-blocking fire-and-forget logging and exact synchronous timestamp capture.

## Impact

- `src/acp/client.ts`: Add `thoughtBuffer`, `flushThoughtBuffer()`, update `sessionUpdate()` and `reset()`, capture synchronous flush timestamps for non-blocking audit writes.
- `src/acp/agent-connector.ts`: Flush thought buffer in prompt finally block (before flushing message buffer).
- `src/core/audit-logger.ts`: Support optional timestamp parameter in `SessionAuditWriter.write(phase, data, timestamp?)`.
- `src/types/audit.ts`: Add `"agent_complete_thought"` to `AuditPhase` union type and `SessionAuditEntry` payload fields.
- Tests: Add unit tests for thought chunk accumulation, buffer isolation, flushing on event transitions, prompt completion, and audit entry generation. Update `tests/types/audit.test.ts` to expect 19 `AuditPhase` literals.
