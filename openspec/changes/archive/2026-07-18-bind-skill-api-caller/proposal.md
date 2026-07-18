## Why

Security audit run-2 (finding F13, HIGH) found that the Skill API authenticates a call solely by checking that the client-supplied `sessionId` exists in the `SessionRegistry` (`executeSkillRequest` in `src/skill-api/server.ts:240`), with **no binding between the calling process and the session it claims**. The full skill context — `channelId`, platform adapter, workspace — is then derived from whatever session that ID resolves to (`server.ts:356`). `SESSION_ID` is injected into every agent subprocess's environment and agent sessions run concurrently as sibling processes under the same UID (the Discord `messageCreate` handler is non-awaited with no mutex or cap). So an attacker whose own agent can read a concurrently-active victim's `SESSION_ID` (e.g. via the F12 read primitive, `head /proc/<pid>/environ`) can invoke `deno run skills/send-reply/scripts/send-reply.ts --session-id sess_<victim> --message …` and **post attacker-controlled content into the victim's channel/DM under the bot's identity**, or write `memory-save`/`memory-patch` into the victim's private workspace. `sessionId` alone is a bearer credential with no proof of ownership.

## What Changes

- **Bind each session to its caller with a per-session capability token.** At agent-spawn time, mint an unguessable per-session token, store it on the `ActiveSession`, and inject it into that subprocess's environment (a new allow-listed var, e.g. `SKILL_API_TOKEN`) alongside `SESSION_ID`. Skill scripts read it from the environment and send it as an `Authorization: Bearer …` header. The Skill API SHALL require the header and compare it in constant time against the resolved session's token; a request presenting a valid `sessionId` **without** the matching token SHALL be rejected. Possessing the session ID alone becomes insufficient.
- **Thread the real request headers to the auth check.** `executeSkillRequest` currently receives the CORS *response* headers, not the incoming request's headers; the handler SHALL pass the request's `Authorization` header through so the token can be verified.
- **Give sessions a real TTL.** The `skills-and-reply` spec already claims sessions expire on `timeoutMs` with periodic cleanup and `touch()`, but `SessionRegistry` implements none of it (`get()` never checks expiry; there is no `lastActivityAt`). Implement the expiry the spec describes, shrinking the impersonation window from "the victim's entire session" to a bounded idle timeout.
- **(Documented end-state, not required to close the finding):** move the Skill API from a shared TCP port to a per-session channel (unix domain socket bound to one session) so the server derives the session from the connection rather than a client-supplied field — see `design.md`.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `skills-and-reply`: Skill API authentication SHALL require a per-session caller token (not just a valid session ID) bound to the calling subprocess, and sessions SHALL expire on an idle `timeoutMs` with periodic cleanup as the spec already describes.
- `acp-integration`: the agent common environment and the SandboxManager environment allow-list SHALL include the per-session Skill API caller token so it reaches the agent subprocess (and only that subprocess).

## Impact

- **Code:** `src/skill-api/server.ts` (extract and verify the `Authorization` header; constant-time compare), `src/skill-api/session-registry.ts` (store `callerToken`; add `lastActivityAt`, `touch()`, expiry in `get()`, periodic cleanup), `src/acp/agent-factory.ts` + `src/acp/sandbox-manager.ts` (mint/inject the token; add it to `BASE_ALLOWED_ENV`), `skills/lib/client.ts` (read the token from env and send the `Authorization` header), `src/core/session-orchestrator.ts` (wire token generation into session registration).
- **Docs:** `docs/` skill-API/auth notes.
- **Tests:** `tests/skill-api/` — a request with a valid `sessionId` but missing/wrong token is rejected 403; the owning token succeeds; an idle session past `timeoutMs` is rejected 401.
- **Cross-reference:** F13's *reachability* depends on the F12 read primitive; F12's filesystem confinement closes the `/proc` env-read path. Because the caller token is itself injected into the agent env, it does **not** by itself defend against an attacker who can read the victim's `/proc/<pid>/environ` (they read the token too) — its value is against session-ID leakage through other channels (logs, dashboard, error messages) and removing the ambient "any holder of the ID" authority. The two changes compose.
