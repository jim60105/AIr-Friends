## Context

Shell-based skills authenticate with the Skill API Server using `--session-id "$SESSION_ID"`. The `$SESSION_ID` env var is in the sandbox allowlist but never set in the subprocess env dict. The `Deno.env.set("SESSION_ID", sessionId)` in `session-orchestrator.ts` only affects the parent process, not the already-spawned subprocess.

The key insight: `shellSessionId` (our Skill API session ID from `sessionRegistry.register()`) is generated at step 2 of the session flow, **before** `createAgentConfig()` is called at step 5. This means we can pass it into the subprocess env at spawn time, following the same pattern used for `AGENT_WORKSPACE` and `TMPDIR`.

## Goals / Non-Goals

**Goals:**

- Pass `SESSION_ID` into the agent subprocess env dict at spawn time via `createAgentConfig()`
- Follow the existing pattern: explicit `env["SESSION_ID"] = sessionId` alongside `AGENT_WORKSPACE` and `TMPDIR`
- Remove the broken `Deno.env.set/delete("SESSION_ID")` calls from session-orchestrator
- Work across all three agent types (Copilot, Gemini, OpenCode)

**Non-Goals:**

- Changing the ACP SDK or protocol
- Modifying skill scripts or SKILL.md files
- Changing the prompt templates (they already correctly instruct `$SESSION_ID` usage)

## Decisions

### Decision 1 (Selected): Add `sessionId` parameter to `createAgentConfig()` and set in env dict

**Choice:** Add an optional `sessionId` parameter to `createAgentConfig()` and `buildBaseAgentConfig()`. When provided, set `env["SESSION_ID"] = sessionId` in the env dict for all three agent types. In `session-orchestrator.ts`, pass `shellSessionId` to `createAgentConfig()`.

**Rationale:**
- Follows the existing pattern for `AGENT_WORKSPACE` and `TMPDIR`
- `shellSessionId` is available before `createAgentConfig()` is called
- Zero changes to ACP layer, skills, or prompt templates
- The sandbox allowlist already includes `SESSION_ID`

## Design

### Changes Required

1. **`src/acp/agent-factory.ts`**:
   - Add `sessionId?: string` parameter to `createAgentConfig()` and `buildBaseAgentConfig()`
   - In each agent type branch (copilot, gemini, opencode), add after the `TMPDIR` line:
     ```typescript
     if (sessionId) {
       env["SESSION_ID"] = sessionId;
     }
     ```

2. **`src/core/session-orchestrator.ts`**:
   - At each `createAgentConfig()` call site, pass `shellSessionId` as the new parameter
   - Remove all `Deno.env.set("SESSION_ID", sessionId)` calls (5 occurrences)
   - Remove all `Deno.env.delete("SESSION_ID")` calls (5 occurrences)

### No Changes Required

- `src/acp/sandbox-manager.ts` — `SESSION_ID` is already in `BASE_ALLOWED_ENV`
- `skills/` — Skills already use `$SESSION_ID` correctly
- `prompts/` — Templates already instruct correct usage
