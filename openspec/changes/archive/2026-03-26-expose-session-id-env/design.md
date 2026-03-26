## Context

The `SESSION_ID` is currently written as a file in each workspace, but no code ever reads it. Skills get the session ID via `--session-id "$SESSION_ID"` CLI argument (resolving from shell env), but the env var is never set. The sandbox allowlist already includes `SESSION_ID`. System prompts currently embed the actual session ID value and tell the agent to use it, which is redundant once the env var is available. Multiple concurrent sessions sharing the same workspace is by design.

## Goals / Non-Goals

**Goals:**
- Remove the dead `SESSION_ID` file mechanism (write + cleanup)
- Set `SESSION_ID` in the agent's subprocess environment so agents can use `$SESSION_ID` in shell
- Update prompts to instruct agents to use `$SESSION_ID` env var instead of embedding the actual value
- Remove `sessionId` from template variables (no longer needed)
- Clean up the `.gitignore` rule for SESSION_ID

**Non-Goals:**
- Changing the sandbox allowlist (already correct)
- Changing skill scripts themselves (already use `--session-id "$SESSION_ID"`)
- Adding workspace-level concurrency control (concurrent sessions sharing a workspace is by design)

## Decisions

### Decision 1: Remove SESSION_ID file entirely

The file is never read by any code. Removing it eliminates dead code and a spurious race condition on file writes.

### Decision 2: Set SESSION_ID via Deno.env before agent prompt

Set `Deno.env.set("SESSION_ID", shellSessionId)` after `createSession()` returns, and `Deno.env.delete("SESSION_ID")` during cleanup. The sandbox allowlist already permits this env var.

### Decision 3: Update prompts to use $SESSION_ID env var

Change prompt templates from:
```
Your session ID is: {{ sessionId }}
Use this session ID when calling skills that require --session-id parameter.
```
To instructions like:
```
The $SESSION_ID environment variable contains your session ID.
Use --session-id "$SESSION_ID" when calling skills.
```

This means the agent never sees the actual session ID value in the prompt — it just uses `$SESSION_ID` in bash commands, and the shell resolves it.

### Decision 4: Remove sessionId template variable

Since prompts no longer embed `{{ sessionId }}`, remove it from the template variables passed to the renderer. This simplifies context assembly.

## Risks / Trade-offs

- [Risk] `Deno.env.set()` is process-global, so concurrent sessions for different users could overwrite each other's SESSION_ID → Mitigated: each agent subprocess resolves `$SESSION_ID` in its own shell context at prompt time
- [Trade-off] Agents can no longer see the session ID in the prompt for debugging → Acceptable: audit logs provide session tracing, and the agent can run `echo $SESSION_ID` if needed
