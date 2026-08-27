## 1. Configuration & Types

- [ ] 1.1 Add `SharedProcessConfig` interface (`enabled`, `reclaimIdleMs`, `jwtDir`, `secretPath`) and `agent.sharedProcess` field in `src/types/config.ts`; wire through the config loader and env overrides
- [ ] 1.2 Document `agent.sharedProcess` in `config/config.example.yaml`, `.env.example`, and `helm/values.yaml` (CI checklist requires all three)

## 2. Deployment Secret (SKILL_API_SECRET)

- [ ] 2.1 Add secret generation/persistence in `src/bootstrap.ts`: generate a 256-bit CSPRNG secret (persist to `data/skill-secret`, mode `0600`, env-overridable); the secret is held ONLY by the bot process (JWT issuer + Skill API verifier) — NOT injected into the agent process env
- [ ] 2.2 Add unit tests for secret generation, persistence, reuse, and env override

## 3. JWT Infrastructure

- [ ] 3.1 Create `src/utils/skill-jwt.ts`: build/parse/verify 3-segment HS256 JWT (`{"alg":"HS256"}` header, payload `{sub, channel, jti, iat, exp}`, HMAC-SHA256 signature, constant-time compare)
- [ ] 3.2 Unit tests: valid JWT accepted; bad signature, wrong `sub`, wrong `channel`, wrong `jti`, expired, malformed — all rejected

## 4. Lease Acquisition: JWT Issuance + Pointer File

- [ ] 4.1 Issue (or re-issue with fresh `exp`) the per-session JWT when the session ACQUIRES the global execution lease (NOT at `setupSession` registration, so queued sessions never present an expired JWT): payload `sub`=session id, `channel`=session channelId, `jti`=`getCallerToken()`, written atomically (temp file + rename, `0600`) to `{SKILL_JWT_DIR}/{sessionId}.jwt`; the JWT file SHALL be deleted when the session ends
- [ ] 4.2 Write the current-session pointer file `{SKILL_JWT_DIR}/active.json` (content: the owning session id) ONLY while the session holds the execution lease (atomic temp-file+rename write), and clear/validate it on lease release
- [ ] 4.3 `skills/lib/client.ts`: snapshot the owning session id and JWT file content ONCE at skill script start (guards backgrounded/late-running skill subprocesses)

## 5. Skill Lib: JWT Presentation

- [ ] 5.1 Update `skills/lib/client.ts`: resolve owning session id from `SESSION_ID` env (per-spawn mode) or the `active.json` pointer (shared mode); read `{SKILL_JWT_DIR}/{ownSessionId}.jwt` and present as `Authorization: Bearer <jwt>`; remove the raw `SKILL_API_TOKEN` env path
- [ ] 5.2 Update skill script shebangs/permissions as needed for reading the JWT file
- [ ] 5.3 Unit tests for `skills/lib`: owning-session resolution (env vs pointer), JWT presentation, and missing-file behavior

## 6. Skill API Server: JWT Verification

- [ ] 6.1 Update `src/skill-api/server.ts` `authenticate()`: verify the presented JWT with the four checks (HMAC signature, `sub == sessionId`, `channel == session.channelId`, `jti == session.callerToken` + `exp`); reject 403/401; remove the raw `callerToken` Bearer path
- [ ] 6.2 Unit tests for all four verification failures and the happy path

## 7. Process Pool + Global Serialization

- [ ] 7.1 Add a shared `opencode acp` process pool in `src/core/` (new module) with canonical pool keys: `{platform}:{channelId}` (message/lurk), scheduler target channel (spontaneous), `self-research:{userId}`, `memory-maintenance:{workspaceKey}`; lazy spawn on a key's first session, reuse the live process for subsequent sessions (multiple `newSession` on one stdio connection), reference-counted reclaim (queued/in-flight/recovering sessions hold a lease) after `reclaimIdleMs` of inactivity, re-checked under the pool lock
- [ ] 7.2 Add a global execution-lease serialization: exactly one session holds the lease at a time; the lease covers the FULL agent lifecycle (`newSession`, model/mode/config-option calls, prompt/retry, `session/cancel`, recovery, cleanup); user-triggered (message/lurk) sessions take queue priority over maintenance jobs; a queued session's setup calls must not clobber the in-flight session's connector state
- [ ] 7.3 `src/acp/agent-connector.ts`: add a "shared mode" — `connect()` reuses a live process instead of spawning; `createSession()` creates the ACP session on the shared connection; index the connector's mutable state (configOptions cache, current model ID, idle monitor) by ACP session ID
- [ ] 7.4 Channel-lurk: re-validate the trigger conditions (last message, bot mention, bot reaction, processed map) when the lurk session actually acquires the lease
- [ ] 7.5 Unit tests: pool lifecycle (spawn/reuse/reclaim), serialization queue ordering + priority, session-scoped connector state

## 8. Session-Scoped Gate Working Directory

- [ ] 8.1 `src/acp/client.ts`: permission gate uses the session-scoped working directory (from the ACP `newSession` `cwd`) instead of the process-level `workingDir`; update the tool-output boundary to the channel-scoped data root in shared mode
- [ ] 8.2 `src/acp/agent-factory.ts`: add `SKILL_JWT_DIR` (the per-session JWT file location) to the agent env and remove the `SKILL_API_TOKEN` injection; do NOT pass `SKILL_API_SECRET` to the agent process (the bot process is the only holder of the HMAC key)
- [ ] 8.3 `src/acp/sandbox-manager.ts`: add `SKILL_JWT_DIR` to the sandbox env allowlist (not `SKILL_API_SECRET`)

## 9. Doom-Loop Termination & Session Resumption

- [ ] 9.1 Shared mode: `onTerminateRequest` cancels the current ACP session via `session/cancel` instead of killing the shared process (per-spawn mode keeps process termination)
- [ ] 9.2 `src/acp/agent-connector.ts` `reconnectAndResumeSession()`: restart the pool key's process, resume the in-flight session via ACP `session/load` (history replayed), and apply controlled recovery — re-issue the prompt ONLY if no response (reply/reaction/file) has been recorded; if a response was sent, complete the session without re-prompting (activates the previously-dead path)
- [ ] 9.3 Shared mode: `XDG_DATA_HOME` = `{dataRoot}/opencode-data/{poolKey}` and `TMPDIR` = `{dataRoot}/channel-tmp/{poolKey}` — channel/pool-key-scoped data roots under the bot data root, outside any user's workspace (cross-user visibility impossible); update the permission gate's tool-output boundary to the channel-scoped data root
- [ ] 9.4 Integration tests (pinned OpenCode version): kill the shared process before/during/after a tool call and verify controlled recovery (no duplicate replies or memory events)

## 10. Prompt Template: Per-Session tmpDir

- [ ] 10.1 Add a per-session `tmpDir` template variable (the session's `{workspace}/tmp/{sessionId}` staging dir) so multi-user channels stage payload files in the correct user's workspace; update the relevant `prompts/*.md` skill-invocation examples to use it

## 11. Tests & CI

- [ ] 11.1 Update/extend existing tests affected by the raw-token removal (`src/skill-api`, `tests/skill-api`, `tests/skills`)
- [ ] 11.2 Run `deno fmt src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts`, `deno task test`; verify coverage ≥ 75% (CI enforces the threshold)
