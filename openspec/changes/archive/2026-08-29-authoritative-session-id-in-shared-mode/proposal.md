# Proposal: authoritative-session-id-in-shared-mode

## Why

A shared pool process freezes `SESSION_ID` at spawn time — it names the FIRST session ever served by that process, and every later session's shell still sees that stale value. Production logs show agents reading `SESSION_ID`, discovering it contradicts the session id in their own prompt ("The script is reading the SESSION_ID env var which is now sess_mtcz8l2x... but the JWT file is for sess_mtczk4ed..."), then burning ~10 tool calls manually re-wiring identity (overriding env, hunting `active.json`, running scripts from guessed cwds). Meanwhile the harness already has an authoritative mechanism — the lease-scoped pointer + per-session JWT that the client library substitutes — so the frozen env var is not just useless in shared mode, it is actively misleading, and every SKILL.md still tells the agent to trust `"$SESSION_ID"`.

Rubber-duck review additionally surfaced that a naive env removal leaves real gaps: the retry prompt and the summary prompt still hardcode `"$SESSION_ID"` (deterministic failure once the var is gone), and `payload.ts` falls back to the CLI-argument session id when the pointer is unreadable — a pooled script could then read AND best-effort-delete another session's staged payload before any auth check. Those must ship in the same change.

## What Changes

- **BREAKING (internal contract, pre-1.0)**: in shared-process mode the pool process environment SHALL NOT receive `SESSION_ID` at all (`src/acp/agent-factory.ts`: set it only when `poolKey` is absent). Per-spawn mode is unchanged. A shared-mode skill invocation with no readable pointer SHALL fail with the explicit `SKILL_SESSION_UNRESOLVED` error instead of silently using a wrong identity.
- **Payload staging hardening (`skills/lib/payload.ts`)**: in shared-process mode the staging base SHALL be pointer-provided ONLY (`staging` + `sessionId` from `active.json`); with no valid pointer the script SHALL fail `SKILL_SESSION_UNRESOLVED` BEFORE reading or deleting any payload file. The per-spawn fallback `{cwd}/tmp/{sessionId-from-arg}` stays, but only where `$SESSION_ID` is authoritative.
- **Retry prompt** (`getRetryPromptStrategy` in `src/acp/agent-factory.ts`, `sendRetryPrompt` call site in the orchestrator): the shared-mode variant SHALL name the literal session id and the absolute staging directory (the rendered `tmpDir`) instead of `$SESSION_ID`/`$TMPDIR` shell tokens.
- **Summary prompt** (`prompts/system_summary.md`): the "Usage" example hardcodes `--session-id "$SESSION_ID"` while the Parameters line already renders `{{ sessionId || "$SESSION_ID" }}` — align the example to the rendered value.
- Update every `skills/*/SKILL.md` session-id and staging-path guidance: prompt-rendered session id + prompt-rendered staging dir are authoritative; `$SESSION_ID`/`$TMPDIR/$SESSION_ID` examples are labeled per-spawn.
- Improve the shared-mode failure message in `skills/lib/client.ts` (`resolveOwningSessionId`) to be instructive: name the expected absolute pointer path and the "session lease may have ended / skill invoked outside an active turn" cause.
- `prompts/system_reply.md` session-info line: state that in shared-process mode the rendered `--session-id` value is authoritative and `$SESSION_ID` is not set.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `skills-and-reply`: "Shell-Based Skill Execution" — shared-mode session identity: `SESSION_ID` absent from the pool environment; `--session-id` advisory, always overridden by pointer-resolved owner. "Payload-File Argument Passing" — shared-mode staging base is pointer-only; no CLI-id fallback, fail-before-read.
- `jwt-skill-auth`: new requirement "Pool Process Identity Hygiene" — no stale frozen session identity may be exported into a pooled process environment; unresolved identity fails loud.
- `acp-integration`: "Agent Common Environment" — the `SESSION_ID` env-var scenario becomes per-spawn-only (currently mandates it for all agent subprocesses, which this change contradicts); the stale legacy caller-token env-var scenario is replaced by the true JWT-only contract (no raw token/secret in any agent environment — matches current code).

## Impact

- `src/acp/agent-factory.ts` (SESSION_ID omission + retry-prompt parameterization)
- `skills/lib/client.ts` (pointer-only shared branch, error text), `skills/lib/payload.ts` (pointer-only staging base)
- 14 `skills/*/SKILL.md` files (doc update), `prompts/system_reply.md`, `prompts/system_summary.md`
- Tests: `tests/acp/agent-factory.test.ts` (env absence + shared retry-prompt text), `tests/skills/lib-client.test.ts`, `tests/skills/payload.test.ts` (shared-mode pointer-only / fail-before-delete)
- Depends on `fix-pooled-skill-env-absolute-paths` (the absolute pointer path makes pointer resolution reliable from any cwd; without it, removing the env fallback increases failure surface)
