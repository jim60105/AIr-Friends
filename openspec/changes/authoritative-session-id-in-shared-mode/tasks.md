# Tasks: authoritative-session-id-in-shared-mode

> Depends on `fix-pooled-skill-env-absolute-paths` (absolute `SKILL_JWT_DIR`/pointer path must be merged first).

## 1. Stop exporting stale SESSION_ID in shared mode

- [ ] 1.1 `src/acp/agent-factory.ts`: change `if (sessionId) { env["SESSION_ID"] = sessionId; }` to only set it when `poolKey` is undefined; update the adjacent comment to state the pool-mode rationale (pointer is the sole identity source)
- [ ] 1.2 `skills/lib/client.ts` `resolveOwningSessionId()`: shared branch becomes pointer-only (`resolved = readPointer()`); split the failure message by mode; shared-mode message uses the stable prefix `SKILL_SESSION_UNRESOLVED:` and names the expected absolute pointer path (`${jwtDir}/active.json`) plus the "skills must run during a live agent turn" remedy; export the code constant `SKILL_SESSION_UNRESOLVED`; update the JSDoc (remove the stale env fallback description)

## 2. Payload staging: pointer-only in shared mode (security fix)

- [ ] 2.1 `skills/lib/payload.ts` `resolveStagingBase()`: in shared-process mode (`SKILL_SHARED_PROCESS=1`) require a valid pointer with BOTH `sessionId` and `staging`; throw `PayloadError` code `SKILL_SESSION_UNRESOLVED` when the pointer is missing/unreadable/malformed — BEFORE the payload file is read or best-effort-deleted; per-spawn fallback `{cwd}/tmp/{sessionId-from-arg}` unchanged
- [ ] 2.2 Verify ordering: script main flows call staging resolution before any `Deno.readTextFile`/`remove` of the payload — trace one script end-to-end (`skills/memory-save/scripts/memory-save.ts`)
- [ ] 2.3 Tests in `tests/skills/payload.test.ts`: (a) shared mode + pointer `{sessionId:"sess_B", staging:X}` + CLI arg `sess_A` → base is `X/sess_B`; (b) shared mode + no pointer → throws code `SKILL_SESSION_UNRESOLVED`, test asserts the payload file still exists afterwards (no read-and-delete side effect — verify via the resolveStagingBase call ordering in the script flow); (c) per-spawn behavior unchanged (existing tests stay green)

## 3. Retry + summary prompts must work without $SESSION_ID in shared mode

- [ ] 3.1 `src/acp/agent-factory.ts` `getRetryPromptStrategy(agentType, ctx)`: add context param `{ sharedProcess: boolean; sessionId?: string; stagingDir?: string }`; shared variant replaces `$TMPDIR/$SESSION_ID` tokens with the literal `stagingDir` and `--session-id "{sessionId}"`; per-spawn variant keeps current template byte-for-byte
- [ ] 3.2 Update the orchestrator retry call site to pass `{ sharedProcess: !!this.processPool, sessionId: shellSessionId, stagingDir: {workspace}/tmp/{shellSessionId} }` (it already knows both; reuse the staging path used for pre-creation)
- [ ] 3.3 `prompts/system_summary.md`: Usage example `--session-id "$SESSION_ID"` → `--session-id {{ sessionId || "$SESSION_ID" }}` (aligns with its Parameters section)
- [ ] 3.4 Tests: `tests/acp/agent-factory.test.ts` — shared ctx retry string contains the literal session id + absolute staging dir and does NOT contain `$SESSION_ID`; per-spawn retry string unchanged. `tests/core/config-loader.test.ts` (or existing prompt-render test location) — render summary prompt with sessionId+tmpDir → example line contains the rendered id, not `"$SESSION_ID"`

## 4. Tests for identity resolution

- [ ] 4.1 `tests/acp/agent-factory.test.ts`: with `poolKey` set, assert `env.SESSION_ID === undefined`; per-spawn (no `poolKey`) still exports it
- [ ] 4.2 `tests/skills/lib-client.test.ts`: shared mode (`SKILL_SHARED_PROCESS=1`, absolute `SKILL_JWT_DIR`), pointer absent → `resolveOwningSessionId()` throws with `SKILL_SESSION_UNRESOLVED` + pointer path; pointer present → resolves pointer id regardless of any `SESSION_ID` env value
- [ ] 4.3 `tests/skills/scripts.test.ts`: shared-mode invocation with pointer present asserts the request body `sessionId` equals the POINTER id even when `--session-id` names another id
- [ ] 4.4 Verify: `deno check src/main.ts && deno task test && deno lint src/ tests/ skills/` all pass

## 5. Docs sweep (mechanical)

- [ ] 5.1 Update all 14 `skills/*/SKILL.md`: `--session-id` guidance = "Use the session id rendered in your system prompt. `$SESSION_ID` works only in per-spawn deployments; in shared-process mode it is not set and the skill library resolves the owning session automatically — a mismatched value is never honored." Payload path examples: keep `"$TMPDIR/$SESSION_ID/..."` labeled as the per-spawn form and add the shared-form pointer: "use the staging directory shown in your system prompt". Keep examples otherwise stable (agents copy-paste them)
- [ ] 5.2 `prompts/system_reply.md` "Session Information": rendered `--session-id {{ sessionId }}` value is authoritative in shared-process mode; `$SESSION_ID` exists only in per-spawn deployments
- [ ] 5.3 Sweep: `rg -n 'SESSION_ID' prompts/ skills/ src/` — every remaining mention per-spawn-correct or explicitly mode-split; do NOT touch `sandbox-manager.ts` env allow-list

## 6. Out of scope

- [ ] 6.1 Do NOT change server-side JWT verification checks (`sub == sessionId` etc.), the pointer write/clear lease lifecycle, or the payload boundary/symlink containment logic itself
