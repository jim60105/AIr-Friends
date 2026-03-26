## Why

The `SESSION_ID` is currently written as a file in the workspace directory, but this file is never read by any code. Skills receive the session ID via `--session-id "$SESSION_ID"` CLI argument, resolving the `$SESSION_ID` env var from the shell. However, the env var is never actually set — the sandbox allowlist includes `SESSION_ID` but it's a no-op.

Meanwhile, the system prompts embed the actual session ID value (e.g., "Your session ID is: sess_abc123") and instruct the agent to use it directly. This is redundant when `$SESSION_ID` is available as an env var — the agent should simply use `$SESSION_ID` in bash commands, never needing to know the actual value.

The file also creates a race condition when concurrent sessions share a workspace (which is by design), as both write to the same file.

## What Changes

- **Remove the `SESSION_ID` file**: Stop writing/cleaning up the `SESSION_ID` file in the workspace — it is unused and creates race conditions in concurrent session scenarios
- **Set `SESSION_ID` as an environment variable**: Expose the session ID via the agent subprocess environment so agents can access it via `$SESSION_ID` in shell commands
- **Update prompts**: Change system prompts to instruct the agent to use `$SESSION_ID` env var instead of embedding the actual session ID value. Remove `sessionId` from template variables
- **Update SKILL.md files**: Ensure all skill documentation clearly states that `$SESSION_ID` is an environment variable available in the agent's shell
- Remove the `SESSION_ID` entry from `.gitignore` rules (no longer needed)

## Capabilities

### New Capabilities

### Modified Capabilities
- `acp-integration`: Replace `SESSION_ID` file with env var; agent subprocess receives `SESSION_ID` via environment
- `workspace-trust-boundary`: Remove `SESSION_ID` file creation/cleanup from workspace lifecycle; concurrent sessions sharing a workspace remain supported by design
- `prompt-template-system`: Remove `sessionId` template variable; prompts guide agent to use `$SESSION_ID` env var
- `skills-and-reply`: Clarify that `$SESSION_ID` is an environment variable, not a value the agent needs to know
- `git-backup`: Remove `SESSION_ID` from `.gitignore` rules
- `spontaneous-posting`: Remove SESSION_ID file cleanup from session teardown
- `dry-run-mode`: Remove SESSION_ID file cleanup from dry-run session teardown

## Impact

- `src/core/session-orchestrator.ts` — Remove SESSION_ID file write/cleanup; set SESSION_ID in agent env
- `src/core/git-backup-service.ts` — Remove SESSION_ID from `.gitignore` rules
- `prompts/system_reply.md`, `prompts/system_spontaneous.md`, `prompts/system_self_research.md`, `prompts/system_memory_maintenance.md` — Update session ID instructions
- `src/core/context-assembler.ts` or template variable sources — Remove `sessionId` from template variables
- `src/acp/sandbox-manager.ts` — Already has `SESSION_ID` in allowlist, no change needed
- Skills SKILL.md files — Already use `$SESSION_ID` correctly, may need minor clarification
- `AGENTS.md` — Update workspace trust boundary and skills sections
- `docs/DESIGN.md` — Remove SESSION_ID file reference
- `docs/AGENT_PERMISSIONS.md` — Clarify SESSION_ID is an env var
