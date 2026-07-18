## 1. Per-session caller token (D1)

- [x] 1.1 Add `callerToken: string` to `ActiveSession` in `src/skill-api/session-registry.ts`; generate a high-entropy token in `register()` (distinct from the session ID)
- [x] 1.2 In `src/acp/agent-factory.ts`, set `SKILL_API_TOKEN` in the agent env alongside `SESSION_ID` (value = the session's `callerToken`); wire the token from session registration through `src/core/session-orchestrator.ts`
- [x] 1.3 In `src/acp/sandbox-manager.ts`, add `SKILL_API_TOKEN` to `BASE_ALLOWED_ENV`
- [x] 1.4 In `skills/lib/client.ts`, read `SKILL_API_TOKEN` from the environment and send it as `Authorization: Bearer <token>` in `callSkillApi`
- [x] 1.5 In `src/skill-api/server.ts`, thread the incoming request's `Authorization` header into `executeSkillRequest` (it currently receives the CORS response headers); extract the bearer token
- [x] 1.6 After resolving the session by ID, verify the presented token against `session.callerToken` with a constant-time comparison (`timingSafeEqual`); return 403 on mismatch/absence
- [x] 1.7 Ensure the 1-second request-dedup cache (`server.ts:159`, keyed on `skillName:sessionId:paramsHash`) does NOT cache authentication/authorization failures (401/403) — only successful executions — so an unauthorized attempt with a leaked session ID cannot poison a legitimate caller's cached result

## 2. Session TTL (D2)

- [x] 2.1 Add `lastActivityAt` to `ActiveSession`; set it in `register()`
- [x] 2.2 Add a `touch(sessionId)` method and call it on each authenticated request
- [x] 2.3 Make `get()` treat a session idle beyond a configurable `timeoutMs` as absent (return `undefined`); add a periodic cleanup timer
- [x] 2.4 Add `timeoutMs` to the Skill API / session config with a conservative default that exceeds the longest legitimate agent turn
- [x] 2.5 Correct the misleading "non-expired" comments on `getAll()` / `hasActiveSessionsForWorkspace()` to reflect the real expiry behavior

## 3. Tests

- [x] 3.1 Valid `sessionId` with missing token → 403; with wrong token → 403; with matching token → success
- [x] 3.2 Idle session past `timeoutMs` → 401; actively-touched session does not expire mid-turn
- [x] 3.3 Token comparison uses constant-time path (no early-return on first byte mismatch)
- [x] 3.4 A 403 from a wrong-token request is not cached: a subsequent identical request from the legitimate caller (correct token) within the dedup window still executes and succeeds
- [x] 3.4 The token env var is present in the spawned agent env allow-list and set to the session's token

## 4. Documentation

- [x] 4.1 Document the caller-token requirement and the honest scope note (token shares env exposure with `SESSION_ID`; the `/proc` vector is closed by F12 confinement, not by the token) in the Skill API / security docs
- [x] 4.2 Record the per-session-transport end-state (D3) as documented future work

## 5. Verification

- [x] 5.1 Run `deno fmt src/ tests/ skills/` and `deno lint src/ tests/ skills/`
- [x] 5.2 Run `deno check src/main.ts`
- [x] 5.3 Run `deno task test` and confirm the new auth/TTL tests pass and coverage does not regress
- [x] 5.4 Run `openspec validate bind-skill-api-caller` and confirm it passes
