## 1. Audit & Types Setup

- [x] 1.1 Add `"agent_complete_thought"` phase to `AuditPhase` union type and define its payload fields (`thoughtContentHash`, `thoughtLength`, `chunkCount`) in `SessionAuditEntry` in `src/types/audit.ts`
- [x] 1.2 Update `tests/types/audit.test.ts` to include `"agent_complete_thought"` in `AuditPhase` array tests and assert 19 phases instead of 18

## 2. Core Buffering & Flushing in ChatbotClient

- [x] 2.1 Add `private thoughtBuffer: string[] = [];` property to `ChatbotClient` in `src/acp/client.ts`
- [x] 2.2 Implement `flushThoughtBuffer(): void` method in `ChatbotClient` to assemble `thoughtBuffer`, log `"Agent complete thought ({chunkCount} chunks, {length} chars): {thought}"` at INFO level, write `"agent_complete_thought"` audit log entry when `auditWriter` is configured, and clear `thoughtBuffer`
- [x] 2.3 Update `sessionUpdate()` in `ChatbotClient` to accumulate non-empty `agent_thought_chunk` text (`thoughtText.length > 0`) into `thoughtBuffer`, call `flushMessageBuffer()` on thought chunks, call `flushThoughtBuffer()` on message chunks, and flush both buffers deterministically (`flushThoughtBuffer()` before `flushMessageBuffer()`) on all other updates
- [x] 2.4 Update `ChatbotClient.reset()` in `src/acp/client.ts` to call `flushThoughtBuffer()` before `flushMessageBuffer()`

## 3. Lifecycle Integration in AgentConnector

- [x] 3.1 Update `AgentConnector.prompt()` `finally` block in `src/acp/agent-connector.ts` to call `this.client?.flushThoughtBuffer()` before `flushMessageBuffer()`

## 4. Unit Testing & Verification

- [x] 4.1 Add unit tests in `tests/acp/client.test.ts` verifying thought chunk buffering, INFO-level complete thought logging after chunk sequences, safe empty buffer flushing, deterministic flush ordering, and `"agent_complete_thought"` audit record emission
- [x] 4.2 Run formatting (`deno fmt`), linting (`deno lint`), and full test suite (`deno task test`) to verify correctness
