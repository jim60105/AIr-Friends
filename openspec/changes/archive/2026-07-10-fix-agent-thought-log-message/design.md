## Context

The `ChatbotClient.sessionUpdate()` method in `src/acp/client.ts` handles `agent_thought_chunk` updates at lines 764-771. Currently it logs them as:

```typescript
this.logger.debug("Agent thought", {
  hasContent: update.content?.type === "text",
  text: update.content?.type === "text" ? update.content.text.substring(0, 100) : "",
});
```

This produces log entries where `log_processed_message` is the static string `"Agent thought"`, while the thought text is only accessible in the `context` object. In structured logging servers (Seq, Grafana/Loki with GELF), this forces operators to expand each entry to see what the agent was thinking.

Additionally, some newer ACP agent model providers send thought chunks with `update.text` as a direct string property, rather than the `update.content` envelope. Notably, the dashboard SSE handler (`src/dashboard/server.ts:750-756`) currently only checks for `"text" in update` (`update.text`), whereas `ChatbotClient` previously only checked for `update.content`.

## Goals / Non-Goals

**Goals:**
- Surface the agent thought text directly in the `log_processed_message` field so it's visible without log entry expansion.
- Support both `update.content.text` (old format) and `update.text` (new format) for extracting thought text safely.
- Maintain backward compatibility — the old format must continue to work.

**Non-Goals:**
- Changing the log level from DEBUG.
- Adding thought chunk buffering/accumulation (like message chunks have) — thought chunks are debug-level and don't need assembly.

## Decisions

### Decision 1: Extract text from both payload shapes with runtime type safety

**Choice**: Use a type-safe inline expression to extract text, checking `typeof` for both `update.content.text` (old) and `update.text` (new).

```typescript
const updateAny = update as Record<string, unknown>;
const contentText = update.content?.type === "text" && typeof update.content.text === "string"
  ? update.content.text
  : "";
const thoughtText = contentText || (typeof updateAny.text === "string" ? updateAny.text : "");
```

**Rationale**: The old format (`update.content`) is typed by the ACP SDK, but verifying `typeof` guards against runtime irregularities. The new format (`update.text`) is untyped and accessed via a cast. Preferring `contentText` ensures backward compatibility.

### Decision 2: Interpolate thought text into log message template

**Choice**: Change the log message from `"Agent thought"` to `"Agent thought: {text}"` passing `{ text: thoughtText.substring(0, 100) }`, matching the pattern already used by `agent_message_chunk` (`"Agent message chunk: {text}"`).

```typescript
this.logger.debug("Agent thought: {text}", {
  text: thoughtText.substring(0, 100),
});
```

**Rationale**: The structured logger interpolates `{text}` into `log_processed_message`, making the thought text visible at the top level in log servers.

### Decision 3: Remove redundant `hasContent` property

**Choice**: Pass only `{ text: thoughtText.substring(0, 100) }` to `logger.debug`.

**Rationale**: The `hasContent` boolean becomes redundant since the presence of text in the message itself conveys the same information. Note that `shellSessionId` is already bound to `this.logger` via `sessionLogger.withContext({ shellSessionId })` at session initialization, so it does not need to be passed explicitly.

## Risks / Trade-offs

- **[Log query breakage]** → Existing log queries matching `log_processed_message == "Agent thought"` will stop matching. Mitigation: This project has 0 users in the wild; the operator (project owner) is the only consumer of these logs and is requesting this change.
- **[Type safety on new format]** → The `update.text` path requires an `as Record<string, unknown>` cast since the ACP SDK types don't include it. Mitigation: A `typeof` guard ensures type safety at runtime.
