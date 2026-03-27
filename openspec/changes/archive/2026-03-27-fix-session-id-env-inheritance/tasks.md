## 1. Update `createAgentConfig()` and `buildBaseAgentConfig()` in `src/acp/agent-factory.ts`

- [x] 1.1 Add `sessionId?: string` parameter to `createAgentConfig()` function signature
- [x] 1.2 Add `sessionId?: string` parameter to `buildBaseAgentConfig()` function signature and pass it through from `createAgentConfig()`
- [x] 1.3 In the `copilot` branch, add `if (sessionId) { env["SESSION_ID"] = sessionId; }` after the `TMPDIR` line (line ~86)
- [x] 1.4 In the `gemini` branch, add `if (sessionId) { env["SESSION_ID"] = sessionId; }` after the `TMPDIR` line (line ~152)
- [x] 1.5 In the `opencode` branch, add `if (sessionId) { env["SESSION_ID"] = sessionId; }` after the `TMPDIR` line (line ~200)

## 2. Pass `shellSessionId` to `createAgentConfig()` in `src/core/session-orchestrator.ts`

- [x] 2.1 At each `createAgentConfig()` call site (~5 occurrences), add `shellSessionId` as the new parameter
- [x] 2.2 Remove all `Deno.env.set("SESSION_ID", sessionId)` calls (~5 occurrences)
- [x] 2.3 Remove all `Deno.env.delete("SESSION_ID")` calls (~5 occurrences)

## 3. Update Tests

- [x] 3.1 Update tests in `tests/acp/agent-factory.test.ts` to cover the new `sessionId` parameter
- [x] 3.2 Update tests in `tests/core/session-orchestrator.test.ts` if they assert on `Deno.env.set("SESSION_ID", ...)`
- [x] 3.3 Run `deno task test` to verify no regressions
