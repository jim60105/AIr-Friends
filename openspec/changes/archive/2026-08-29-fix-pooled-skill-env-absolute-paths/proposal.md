# Proposal: fix-pooled-skill-env-absolute-paths

## Why

In shared-process (pool) mode the agent process receives `SKILL_JWT_DIR`, `TMPDIR`, `XDG_DATA_HOME`, and the pool process cwd as **relative** paths (e.g. `data/skill-jwt`, `data/channel-tmp/{poolKey}`). These only resolve against the bot process cwd (`/app`), but skill scripts and external skill scripts run with the tool cwd chosen by OpenCode — usually the session workspace — where `data/...` does not exist. Production logs (export-8df05099e9bc412) show every pooled session burning 8–15 tool calls rediscovering "the skill scripts must run from /app": `SKILL_JWT_UNREADABLE` on the JWT/pointer files, `mktemp: data/channel-tmp/...: No such file or directory` inside external skill scripts, and the active-session pointer silently unreadable so the client falls back to a stale `$SESSION_ID`. This is the single largest source of agent friction in the pooled harness.

## What Changes

- Resolve all pool-path environment variables to **absolute paths at construction time** (against the bot process cwd, which is where the pool writes the JWT/pointer files): `SKILL_JWT_DIR`, `TMPDIR`, `XDG_DATA_HOME`, and the pool process `cwdOverride` in `src/acp/agent-factory.ts`.
- Resolve the same directories to absolute paths on the **write side** so reader and writer always agree: `AgentProcessPool.jwtDir`, `SessionOrchestrator.skillJwtDir`, `bootstrap.ts` jwtDir resolution, and `AgentProcessPool.ensureSharedDirs()`.
- The per-spawn (non-pool) `TMPDIR`/`XDG_DATA_HOME` values (`{workspace}/tmp`, `sessionXdgDataHome(...)`) are already derived from an absolute workspace path — no change needed there.
- Config semantics unchanged: `agent.sharedProcess.jwtDir` and `workspace.repoPath` may remain relative in `config.yaml`; they are interpreted relative to the bot process cwd and normalized once at consumption.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `shared-acp-process-pool`: "Shared Process Environment Scoping" — pool-scoped `TMPDIR`, `XDG_DATA_HOME`, process cwd, and `SKILL_JWT_DIR` SHALL be absolute paths in the spawned agent process environment.
- `jwt-skill-auth`: "Per-Session Signed JWT Issuance" / "Skill Lib JWT Presentation" — the JWT directory (and thus the current-session pointer file) SHALL be addressed by an absolute path in both the issuing bot process and the skill client library, so JWT/pointer lookup works regardless of the skill script's cwd.

## Impact

- `src/acp/agent-factory.ts` (env construction for pool and per-spawn modes)
- `src/core/agent-process-pool.ts` (`jwtDir`, `ensureSharedDirs`, pointer path)
- `src/core/session-orchestrator.ts` (`skillJwtDir` getter)
- `src/bootstrap.ts` (JWT dir creation at startup)
- `skills/lib/client.ts` / `skills/lib/payload.ts` (no behavior change expected — they already join `$SKILL_JWT_DIR`; verify with tests)
- Tests: `tests/acp/agent-factory.test.ts`, `tests/core/agent-process-pool.test.ts`, `tests/skills/lib-client.test.ts`
- No config file, wire-format, or deployment changes; existing relative values keep working.
