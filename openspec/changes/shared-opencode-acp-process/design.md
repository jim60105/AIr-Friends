# Design: Shared OpenCode ACP Process Pool + JWT Skill Authentication

## Context

See `proposal.md` for motivation. Current state and constraints that shape this design:

- **Per-session process spawning**: every conversation spawns a fresh `opencode acp` subprocess (`src/acp/agent-connector.ts` `connect()`), so the agent cold-start cost (process launch, config/provider/model loading, MCP startup) is paid per conversation.
- **Per-spawn env-var injection**: `createAgentConfig` (`src/acp/agent-factory.ts`) injects per-session env vars (`SESSION_ID`, `TMPDIR`, per-session `XDG_DATA_HOME` (F12), `SKILL_API_TOKEN` (F13), `AGENT_WORKSPACE`, provider keys). A long-lived process has a **fixed** environment, so these mechanisms stop working in shared-process mode.
- **OpenCode capabilities (verified against the OpenCode source, dev branch)**:
  - Cross-session prompts run in parallel (per-session Runner + per-session idle waiters); same-session prompts are serialized by a per-session runner.
  - `session/load` is implemented in ACP mode (`agentCapabilities.loadSession: true`) and replays historical messages, so in-flight sessions can be resumed after a process restart.
  - Per-session ACP parameters: `newSession` carries `cwd` and `mcpServers`; `setSessionModel`/`setSessionMode`/`setSessionConfigOption` vary per session.
  - OpenCode persists session state to a SQLite database (`opencode.db`) under `XDG_DATA_HOME`.
  - `opencode acp` also supports a network mode (`--port`/`--hostname`), but ACP itself still rides stdio; the HTTP surface is OpenCode's internal SDK channel.
- **F13 security model**: the per-session `callerToken` was provisioned into the owning subprocess env; in shared mode the token must travel differently (self-contained, server-verifiable signed token — JWT-style).
- **Single-bot-persona semantics**: the bot is one persona; running exactly one agent session at a time is acceptable and simplifies shared-state management.

## Goals / Non-Goals

**Goals:**
- Eliminate per-conversation agent cold start with a per-channel long-lived `opencode acp` process pool.
- Replace F13 raw caller-token auth with per-session signed JWTs (server-verified: signature, `sub`, `channel`, `jti`+`exp`).
- Make session resumption functional (reconnect + `session/load`).
- Keep the agent's skill invocation contract unchanged (no new agent work: `--session-id` + payload file only).

**Non-Goals:**
- No backward compatibility or migration (pre-release, 0 users) — the raw `SKILL_API_TOKEN` path is removed, not kept.
- No per-user or global single process pool (per-channel granularity is the chosen scope).
- No cross-channel session parallelism (global serialization).
- No ACP-over-network transport (ACP stays stdio; the OpenCode HTTP server API is not used).

## Decisions

1. **Per-channel process pool** (alternatives: one global process, per-user pool). Rationale: the process's fixed environment points to channel/pool-key-scoped directories under the bot data root (decision 6), so multi-user channels work without env-var staleness leaking into the permission gate (which uses the session-scoped working directory from ACP `newSession.cwd`). Processes are reclaimed via a reference count (queued, in-flight, and recovering sessions all hold a lease) after `reclaimIdleMs`, re-checked under the pool lock.

2. **Global session serialization** (alternatives: per-channel serialization, full parallelism). Exactly one agent session holds the execution lease at any time; the lease covers the full agent lifecycle (decision 9). Rationale: single-bot-persona semantics; it also makes the current-session pointer file (used by the skill lib to resolve the owning session) unambiguous — the pointer is written only while the session holds the lease, so no pointer race.

3. **Per-session signed JWT** (alternatives: keep raw per-session token via env (breaks in shared mode), single shared token (can't distinguish owner from target), HMAC without per-session `jti` (forgeable by a secret holder). The JWT is a standard 3-segment token: `{"alg":"HS256"}` header, payload `{ sub: owning sessionId, channel: session channelId, jti: session callerToken, iat, exp }`, signed with the deployment-level `SKILL_API_SECRET`. The server runs four checks (signature, `sub == sessionId`, `channel == session.channelId`, `jti == session callerToken` + `exp`). The `jti` (the existing per-session 256-bit `callerToken`) is the unguessable element that blocks a forger who holds the shared secret.

4. **Owning-session resolution without agent work**: per-spawn mode resolves the owning session from the `SESSION_ID` env var; shared mode resolves it from the current-session pointer file. The pointer is written ONLY when the session acquires the global execution lease (not at session setup), via atomic write (temp file + rename, `0600`), and cleared/validated on lease release. The skill lib snapshots the owning session ID once at script start, so a backgrounded skill subprocess cannot observe a later session's pointer. The agent's command line is unchanged.

5. **Deployment secret management**: the 256-bit CSPRNG secret (persisted to `data/skill-secret`, env-overridable) is held ONLY by the bot process (the JWT issuer and the Skill API verifier). The agent subprocess receives the per-session JWT file (a minimal, short-lived session capability) via `SKILL_JWT_DIR`, never the raw HMAC key.

6. **Pool-key-scoped OpenCode data root (F12)**: in shared mode the process's `XDG_DATA_HOME` and `TMPDIR` point to pool-key-scoped directories under the bot data root (`{dataRoot}/opencode-data/{poolKey}` and `{dataRoot}/channel-tmp/{poolKey}`) — deliberately OUTSIDE any user's workspace, so one user's agent cannot read another user's OpenCode DB / tool outputs (the pool key is `{platform}:{channelId}` for message/lurk sessions, the target channel for spontaneous sessions, `self-research:{userId}`, `memory-maintenance:{workspaceKey}`). The permission gate's tool-output boundary uses this pool-key-scoped data root; payload staging for a session still uses the session's own workspace tmp dir, carried to the agent via a per-session `tmpDir` prompt variable.

7. **Doom-loop termination**: shared mode cancels the current ACP session (`session/cancel`) instead of killing the shared channel process; per-spawn mode keeps process termination.

8. **Session resumption (controlled recovery)**: on idle timeout / process death, restart the channel process, call `session/load` (replays history into the client), and re-issue the prompt ONLY if no response (reply/reaction/file) has been sent yet; if a response was already sent, complete the session without re-prompting. Side-effectful skills (`send-reply`, `memory-save`) are guarded by the in-bot registry state (`replySent`, `fileSent`, counts survive the process restart because it lives in the bot process).

9. **Global execution lease scope**: the serialization lease covers the ENTIRE agent lifecycle of a session: `newSession`, model/mode/config-option calls, prompt/retry, cancel/recovery, and cleanup. `AgentConnector`'s mutable state (config-options cache, current model ID, idle monitor) is indexed by ACP session ID, so a later session's setup calls cannot clobber an in-flight session's connection state.

10. **Canonical pool keys per session type**: message/lurk sessions key by `{platform}:{channelId}`; spontaneous sessions key by the scheduler's target channel (e.g. `dm:{userId}`, `misskey/timeline/self`); self-research keys by `self-research:{userId}` and memory-maintenance keys by `memory-maintenance:{workspaceKey}` — each non-message session type gets its own process (effectively per-run, as today) with a pool-key-scoped data root (decision 6), not a user's workspace.

## Risks / Trade-offs

- **Single point of failure per channel** → Mitigation: supervised restart + controlled recovery (`session/load` + re-prompt only when no response sent yet); a crash affects only that channel's in-flight session.
- **Stale process env vars in multi-user channels** → Mitigation: the process env vars (`TMPDIR`, `XDG_DATA_HOME`) now point to channel-scoped dirs under the data root (not any user's workspace); per-session behavior is carried by ACP `newSession.cwd` + the session-scoped gate working directory + the per-session `tmpDir` prompt variable.
- **Global serialization delays scheduler sessions** (lurk/spontaneous wait behind message sessions) → Mitigation: acceptable single-persona semantics; re-validate the lurk trigger conditions when the lease is actually acquired (the trigger may be stale after a long wait), and give interactive sessions queue priority over maintenance jobs.
- **JWT pointer file visibility**: the JWT files live outside the restricted-mode agent read boundary; a YOLO-mode agent can read them (known YOLO trust-boundary trade-off, consistent with `~/.git-credentials` handling).
- **Pointer TOCTOU**: the pointer is only written while a session holds the execution lease (atomic temp+rename write, `0600`), and the skill lib snapshots the owning session ID at script start — a backgrounded skill subprocess cannot observe a later session's pointer.
- **JWT expires while queued** → Mitigation: the per-session JWT is issued (or re-issued with a fresh `exp`) at lease acquisition, not at session registration; the queue enforces a deadline and cancels overdue queued sessions.
- **Reclaim races with acquire/recovery** → Mitigation: the pool tracks a per-process reference count (queued, acquiring, in-flight, and recovering sessions all hold a lease); the reclaim callback re-checks idleness under the pool lock, and acquiring a process cancels any pending reclaim timer.
- **Channel-scoped data root visibility** (F12 weakened): sessions of the same channel share one OpenCode data root (DB + tool outputs) — accepted trade-off; the root sits under the bot data root, never inside a user workspace, so cross-USER visibility is avoided while cross-SESSION visibility within a channel is accepted.

## Migration Plan

No migration needed (pre-release). Rollout: set `agent.sharedProcess.enabled: true`; per-spawn mode remains the fallback when disabled. The `SKILL_API_TOKEN` env-var path is removed outright.

## Open Questions

- Reclaim idle time for the process pool (suggested default: 30 min, aligns with the session idle TTL) — final value is a config detail.
- Exact directory for `SKILL_JWT_DIR` (suggested: `data/skill-jwt/`) — config detail.
- Whether the current-session pointer file should include a monotonically increasing sequence number for debugging (optional hardening).
