## Why

In newer ACP agent model providers, the `agent_thought_chunk` session update carries the thinking text directly as `update.text` (a plain string) rather than nested inside `update.content` (`{ type: "text", text: "..." }`). The current logging code in `ChatbotClient.sessionUpdate()` only handles the `update.content` format, and even when it does match, the thought text is placed in the log **context** object — not interpolated into the log message template. This means in structured log servers (e.g., Seq via Serilog, Grafana Loki with GELF), the `log_processed_message` field shows the static string `"Agent thought"` and the actual thought text is buried inside expandable `context_text` fields. Operators must expand every log entry to see what the agent was thinking, making log triage and monitoring impractical.

## What Changes

- Modify the `agent_thought_chunk` case in `ChatbotClient.sessionUpdate()` to extract thought text from **both** `update.content.text` (old format) and `update.text` (new format), with the old format taking precedence for backward compatibility and type checking.
- Interpolate the extracted thought text directly into the log message template (`"Agent thought: {text}"`) so it appears in the top-level `log_processed_message` field without requiring log entry expansion.
- Remove the redundant `hasContent` property from the log call (since the message itself displays the text), passing `{ text: thoughtText.substring(0, 100) }`. Note that `shellSessionId` is automatically included in the logger's context via `sessionLogger.withContext({ shellSessionId })`.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `acp-integration`: The `agent_thought_chunk` session update handling adds support for a second payload shape (`update.text` string) alongside the existing `update.content` object shape, and changes the log message template to include the thought text.

## Impact

- **Code**: `src/acp/client.ts` — the `agent_thought_chunk` case in `sessionUpdate()` method.
- **Specs**: `openspec/specs/acp-integration/spec.md` — updated requirement for the dual-format thought text extraction and the updated log message template.
- **Logging**: `log_processed_message` will change from `"Agent thought"` to `"Agent thought: <text>"`, which may affect existing log queries or alerts that match on the exact static string. Since this project has 0 users in the wild, this is acceptable.
