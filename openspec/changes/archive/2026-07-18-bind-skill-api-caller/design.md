## Context

The Skill API (`src/skill-api/server.ts`) is a local HTTP server (`localhost:3001`) that skill scripts call back into to send replies, write memory, etc. Each agent subprocess receives `SESSION_ID` (and `SKILL_API_PORT`) in its environment (`sandbox-manager.ts` `BASE_ALLOWED_ENV`; set in `agent-factory.ts:109`), and skill scripts pass `--session-id "$SESSION_ID"` (`skills/lib/client.ts:parseBaseArgs`). Authentication is exactly:

```ts
const session = this.sessionRegistry.get(body.sessionId);
if (!session) return { success: false, error: "Invalid or expired session", statusCode: 401 };
```

Then the skill context (`channelId`, `platformAdapter`, `workspace`, `userId`) is built from that session (`server.ts:356`). There is no check that the caller *owns* the session. Two facts make this exploitable rather than theoretical:

- **Concurrency:** the Discord `messageCreate` handler is non-awaited with no mutex or cap (`discord-adapter.ts:98`), so multiple users' agent subprocesses run simultaneously as siblings under the same UID.
- **No TTL:** `SessionRegistry.get()` returns the raw map entry with no expiry (`session-registry.ts:104`), so a session's `SESSION_ID` stays valid for its full duration. The `skills-and-reply` spec *claims* `timeoutMs`/cleanup/`touch()` exist, but the code has none — a spec/implementation drift.

Session IDs are unguessable (`sess_${ms}_${randomUUID}`), so the exploit needs a way to read another live session's ID — which finding F12 (`head /proc/<pid>/environ`) provides.

## Goals / Non-Goals

**Goals:**

- Make a valid `sessionId` insufficient on its own: a Skill API call must prove it originates from the subprocess that owns that session.
- Shrink the exposure window with a real idle TTL (aligning code to the spec that already claims it).
- Keep the change small and local to the Skill API + session plumbing; do not require the larger F12 confinement work to land first (they compose but are independent).

**Non-Goals:**

- Fixing the `/proc` env-read primitive itself — that is F12's filesystem confinement. This change explicitly does not claim to defend against an attacker who can already read the victim subprocess's environment.
- Rearchitecting the transport to per-session unix sockets in this change (documented as the end-state, deferred).
- Backward compatibility / migration — pre-release, zero users.

## Decisions

### D1 — Per-session capability token, verified in constant time

At session registration, generate a high-entropy token (`crypto.randomUUID()`/`crypto.getRandomValues`) distinct from the session ID, store it on `ActiveSession.callerToken`, and inject it into the owning subprocess's environment as `SKILL_API_TOKEN` (added to `BASE_ALLOWED_ENV` and set next to `SESSION_ID` in `agent-factory.ts`). `skills/lib/client.ts` reads `SKILL_API_TOKEN` from its environment and sends `Authorization: Bearer <token>`. The server resolves the session by `body.sessionId`, then requires `timingSafeEqual(presentedToken, session.callerToken)`; mismatch or absence returns 403.

- **Why a separate token, not just the session ID:** it decouples "knowing which session" from "being authorized to act as it." A session ID that leaks through a log line, an error message, or the dashboard no longer grants control.
- **Why constant-time compare:** avoid a timing oracle on the token.
- **Honest limitation:** the token is injected into the agent env, so it shares the exact exposure of `SESSION_ID` under a `/proc/<pid>/environ` read (F12). Against F12 specifically, the defense is F12's confinement, not this token. D1's value is against every *other* leak channel and the removal of ambient bearer-authority. This is stated in the spec's requirement text so the guarantee is not overclaimed.

### D2 — Real session TTL

Add `lastActivityAt` to `ActiveSession`, refresh it via `touch()` on each authenticated call, have `get()` treat a session idle beyond `timeoutMs` as absent (returning `undefined` → 401), and run periodic cleanup. This implements what `skills-and-reply`'s "Session-Based Authentication" already specifies and bounds the impersonation window.

- **Why:** even with D1, a shorter-lived credential is strictly better; and the spec/code drift should be closed in the honest direction (implement it).
- **Alternative — just delete the spec's expiry claim:** rejected; a TTL is genuinely useful and cheap, and matches the documented intent.

### D3 — End-state: per-session transport (deferred, documented)

The robust design removes the client-supplied `sessionId` as an authorization input entirely: give each agent a per-session unix domain socket (or an abstract-namespace socket) so the server maps the *connection* to exactly one session. Combined with F12's per-session filesystem confinement (and, where the deployment permits, a distinct UID per agent with `SO_PEERCRED`), the OS itself binds caller to session.

- **Why deferred:** it is a larger transport change; D1+D2 already close the finding at the application layer. Documented so the token is understood as a step toward, not a substitute for, connection-bound identity.

## Risks / Trade-offs

- **[Token shares env exposure with SESSION_ID (F12)]** → explicitly scoped out; the requirement text states D1 does not defend the `/proc` vector, which F12 owns. The two changes are complementary, not redundant.
- **[Header not threaded today]** → `executeSkillRequest` currently gets response headers; the fix must pass the *request* `Authorization` header through `handleSkillRequest`. Covered by a test that a missing header is rejected.
- **[TTL too aggressive breaks long agent turns]** → default `timeoutMs` must exceed the longest legitimate agent turn; `touch()` on each call keeps active sessions alive. Pick a conservative default and cover a long-running session in tests.
- **[Older skill scripts without the header]** → all skill calls go through `skills/lib/client.ts`, so updating that one client covers every skill; a hardcoded skill that bypasses the lib would 403 (acceptable, and surfaced immediately).
- **[Request-dedup cache could serve a cached auth failure to the legitimate caller]** → the 1-second dedup cache keys on `(skillName, sessionId, paramsHash)` (`server.ts:159`), which does not include the auth outcome. If an attacker holding a leaked `sessionId` (but no token) fires an identical request first, its 403 could be cached and returned to the real caller within the window. Mitigation: **do not cache authentication/authorization failures** (401/403) — only cache successful executions — so an unauthorized attempt cannot poison a legitimate caller's result. Covered by a task and a test.

## Migration Plan

No data migration (pre-release, zero users).

1. Add `callerToken` + TTL fields to `SessionRegistry`/`ActiveSession`; mint and inject the token at spawn; add `SKILL_API_TOKEN` to the env allow-list.
2. Update `skills/lib/client.ts` to send the header; update the server to verify it and to enforce TTL.
3. Tests for the 403 (valid ID, wrong/absent token), the success path, and the idle-timeout 401.
4. Rollback: revert; no persistent state changes.

## Open Questions

- **Default `timeoutMs`:** what idle bound safely exceeds the longest legitimate agent turn while keeping the window small? Proposed: a conservative default (e.g. several minutes) with `touch()` refresh.
- **Transport end-state (D3):** adopt per-session unix sockets now or after F12's confinement lands? Recommended: after, so the socket + confinement + (optional) per-session UID are designed together.
