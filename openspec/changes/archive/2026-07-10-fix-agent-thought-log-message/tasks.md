## 1. Core Implementation

- [x] 1.1 In `src/acp/client.ts`, modify the `agent_thought_chunk` case (lines 764-771) to: (a) extract thought text safely checking both `update.content.text` and `update.text` with runtime `typeof` checks and old-format precedence, and (b) change the log message template from `"Agent thought"` to `"Agent thought: {text}"`, passing `{ text: thoughtText.substring(0, 100) }`

## 2. Tests

- [x] 2.1 In `tests/acp/client.test.ts`, add a test for `agent_thought_chunk` with old content-envelope format (`update.content = { type: "text", text: "..." }`) asserting `message === "Agent thought: {text}"` and verifying `context.text`
- [x] 2.2 In `tests/acp/client.test.ts`, add a test for `agent_thought_chunk` with new direct-text format (`update.text = "..."`) asserting `message === "Agent thought: {text}"` and verifying `context.text`
- [x] 2.3 In `tests/acp/client.test.ts`, add a test for `agent_thought_chunk` with neither format present asserting it logs empty string correctly

## 3. Spec Update

- [x] 3.1 In `openspec/specs/acp-integration/spec.md`, add the "Agent Thought Chunk Logging with Dual-Format Text Extraction" requirement with all four scenarios from the delta spec

## 4. Verification

- [x] 4.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/` to ensure code style compliance
- [x] 4.2 Run `deno task test` to confirm all existing and new tests pass
