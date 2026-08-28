# Design: authoritative-session-id-in-shared-mode

## Current state (confirmed at bad78dc)

```ts
// src/acp/agent-factory.ts — set for BOTH modes at spawn time; in pool mode it
// freezes the first session's id forever:
if (sessionId) {
  env["SESSION_ID"] = sessionId;
}
```

```ts
// skills/lib/client.ts — resolveOwningSessionId(), shared branch:
resolved = readPointer() ?? Deno.env.get("SESSION_ID") ?? undefined;
```

```ts
// skills/lib/payload.ts — resolveStagingBase(): pointer wins, but falls back to
// `{cwd}/tmp/{sessionId}` where sessionId is the script's CLI --session-id arg.
```

```ts
// src/acp/agent-factory.ts getRetryPromptStrategy (lines ~284-291) — embedded in
// every missing-reply retry, including pooled sessions:
`1. Write the reply text to $TMPDIR/$SESSION_ID/reply.md ...`
`2. Invoke: .../send-reply.ts --session-id "$SESSION_ID" --message-file "$TMPDIR/$SESSION_ID/reply.md"`
```

The code comment already states the shared-mode `$SESSION_ID` "must NOT be trusted", yet it (a) remains visible to the agent (prompt-facing confusion), (b) remains the shared-mode client fallback (wrong identity on unreadable pointer — observed in production), (c) remains the payload staging fallback (a script can read AND best-effort-delete another session's staged payload before any auth check), and (d) is hardcoded in the retry prompt and the summary prompt example, which would deterministically fail once (a) lands.

## Decisions

### D1: Omit `SESSION_ID` in shared mode — pointer is the only identity source

`agent-factory.ts`: change to `if (sessionId && !poolKey) { env["SESSION_ID"] = sessionId; }`. Per-spawn mode unchanged. The `SKILL_SHARED_PROCESS=1` marker plus absolute `SKILL_JWT_DIR` (from the `fix-pooled-skill-env-absolute-paths` change) make the pointer readable from any cwd, so the env fallback only ever produced wrong answers in shared mode; a missing pointer now fails loud with an instructive error.

### D2: Mode-split, instructive failure in `resolveOwningSessionId`

Shared branch drops the env fallback entirely (`resolved = readPointer()`); the throw message splits by mode:
- shared: `SKILL_SESSION_UNRESOLVED: no current-session pointer at ${jwtDir}/active.json — the session's execution lease may have ended, or this script ran outside an active agent turn. Skills must be invoked during a live turn; the owning session is resolved automatically — do not set SESSION_ID manually.`
- per-spawn: keep the current message (mention both sources).

Give the error a stable shape by prefixing `SKILL_SESSION_UNRESOLVED:` (matches the `SKILL_*` contract-code culture; scripts surface it via `exitWithError`).

### D3: Shared-mode payload staging is pointer-only — fail before any file touch

`payload.ts` `resolveStagingBase()` shared branch (marker `SKILL_SHARED_PROCESS=1`): require a valid pointer carrying BOTH `sessionId` and `staging`; base = `resolve(staging, sessionId)` as today. When the pointer is missing/unreadable/malformed in shared mode, throw a `PayloadError` with code `SKILL_SESSION_UNRESOLVED` (same code as D2 — one shared constant) BEFORE the payload file is read or deleted. Rationale (security): with the staging fallback keyed on the CLI `--session-id` argument, a backgrounded or late-running pooled script could name a SIBLING session's id (same workspace, e.g. two DMs of the same user) and read plus delete that session's staged reply/memory text — the later JWT check gates the API call, not the file access. The fallback stays for per-spawn mode only, where `$SESSION_ID` is authoritative.

### D4: Retry and summary prompts must not reference `$SESSION_ID` in shared mode

- `getRetryPromptStrategy(agentType, ctx)`: add a context parameter `{ sharedProcess: boolean; sessionId?: string; stagingDir?: string }` (call site: orchestrator `sendRetryPrompt` knows `shellSessionId` and the session staging dir `{workspace}/tmp/{shellSessionId}`). Shared-mode template names the literal ids/paths: `Write the reply text to {stagingDir}/reply.md ... invoke .../send-reply.ts --session-id "{sessionId}" --message-file "{stagingDir}/reply.md"`. Per-spawn template keeps `$TMPDIR/$SESSION_ID` tokens verbatim.
- `prompts/system_summary.md`: the Usage example's `--session-id "$SESSION_ID"` becomes `--session-id {{ sessionId || "$SESSION_ID" }}` (matching its own Parameters section); pooled runs render `sessionId` and `tmpDir`, so the example becomes copy-pasteable in both modes.
- Note: the ACP permission gate expands `$TMPDIR/$SESSION_ID` TOKENS from the gate's own per-session context (not the agent env), so edit/write tool paths keep working in shared mode — D1 does not break write-tool staging, only BASH variable interpolation, which is what this section fixes.

### D5: Docs follow the truth

- 14 `skills/*/SKILL.md`: `--session-id` row/example updated: "Use the session id rendered in your system prompt (`--session-id <id>` line). In per-spawn deployments `$SESSION_ID` names this session; in shared-process mode it is not set and the skill library re-resolves the owning session automatically — a mismatched value is never honored (JWT `sub` is bound to the owning session)." Payload examples: per-spawn keeps `"$TMPDIR/$SESSION_ID/..."`; add "in shared-process deployments use the staging directory shown in your system prompt" naming `{{ tmpDir }}`-rendered paths. Keep the flag REQUIRED (scripts still demand it).
- `prompts/system_reply.md` Session Information paragraph: the rendered id is authoritative in shared-process mode; `$SESSION_ID` exists only in per-spawn deployments.

## Rejected alternatives

- Rewriting env per session: impossible — process env is frozen at spawn.
- Keeping the payload CLI fallback "because JWT auth gates the API": auth gates the CALL, not the file read/delete — data-isolation fix must happen at the file boundary (D3).
- Trusting `--session-id` argument over pointer: unsafe (cross-session impersonation is exactly what the JWT `sub` check defends against).

## Risks

- Any hidden consumer reading `$SESSION_ID` in shared mode breaks loud (good) rather than silently misattributing. Sweep: `rg -n 'SESSION_ID' skills/ src/ prompts/` during implementation; `sandbox-manager.ts` keeps `SESSION_ID` in the env ALLOW-list (harmless — allow-list tolerates absence). The acp-integration "Agent Common Environment" spec mandates SESSION_ID for all subprocesses — MODIFIED in this change to per-spawn-only.
- Backgrounded skill scripts that start after pointer-clear (agent tree survived the bounded drain window) now get a hard error instead of a stale-but-usable id — intended: wrong-identity delivery is worse than failure.
