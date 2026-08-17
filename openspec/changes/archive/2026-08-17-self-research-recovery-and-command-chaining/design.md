## Context

A production self-research session (CLEF export `tmp/export-8defc0ea1d331b2.clef`, 2026-08-16, pod `air-friends-6f98cf6dd4-zxxjz`) failed its job in 38 seconds with 36K/1M tokens used. The agent's flow:

1. `cat /app/data/agent-workspace/notes/_index.md 2>/dev/null || echo "NO INDEX"` — rejected with OpenCode's `DeniedError` ("The user has specified a rule which prevents you..."). **OpenCode's own matcher** denied this: tree-sitter splits the invocation into command nodes, and the `echo "NO INDEX"` node matches the `echo *` deny rule in `agent-config/opencode.json`. The ACP gate was never consulted.
2. The agent recovered (Read tool) and picked a PhilArchive topic; `webfetch` returned 403 three times (site bot protection; the validating egress proxy allows public hosts, so this is origin-side blocking, not harness-caused).
3. Fallback attempt `agent-browser --args "--no-sandbox" open "URL" 2>&1; agent-browser --args "--no-sandbox" get text 2>&1` — both segments match the `agent-browser *` ask rule, so OpenCode asked the ACP gate ONCE with both segments; **our gate rejected the whole call** for `shell_operator` (`;`), producing `RejectedError` ("The user rejected permission to use this specific tool call.").
4. The agent surrendered with `end_turn`; `processSelfResearch` declared success (`stopReason === "end_turn"`) — no note was written, no retry ran, nothing was logged as wrong.

This is the third occurrence of the same failure class. The 2026-08-14 change (`tolerate-fd-redirect-in-generic-command-gate`) fixed the trailing `2>&1` instance of the model's bash-batching habit; the `;`-chaining instance and the `|| echo`-fallback instance remain. Root causes in the harness:

- **R1 — The ACP gate is single-command-only.** Coding models habitually batch commands (`;`, `&&`, `||`) to save tool calls. OpenCode already splits these into per-segment permission patterns and routes all-ask chains to our gate as ONE request with the raw command; our gate re-evaluates the raw string, trips on the operator, and rejects — even when every segment is individually allowed.
- **R2 — No completion verification, no retry, no observability for self-research.** `end_turn` === success. The missing-reply retry machinery (permission-rejection ring buffer + corrective retry prompt) exists for user-facing sessions only.
- **R3 — Guidance mismatch.** `prompts/agent_permissions.md` claims `curl` is allowed (it is not in the gate's `GENERIC_COMMAND_ALLOWLIST` nor in `opencode.json`); nothing documents the chaining rules or the webfetch-403 → agent-browser fallback.

## Goals / Non-Goals

**Goals:**

- Allow multi-command bash invocations (`;`, `&&`, `||` chains) through the restricted-mode gate **iff every segment independently passes the exact gate it would face as its own tool call** — eliminating the benign-habit rejection class without granting any new capability.
- Make the per-token path checks expansion-sound (D5) so the segment-wise rule's "each segment is individually safe" premise holds against runtime shell expansion.
- Make self-research sessions self-verifying: a session that ends without producing a note is a failure, gets ONE corrective retry on the same ACP session (with the existing permission-rejection diagnostics), and is observable (audit + log + metric).
- Align prompt/skill guidance with the real gate so the model stops attempting rejected patterns.

**Non-Goals:**

- Changing OpenCode's `opencode.json` routing or deny rules (OpenCode's layer already segments chains; its deny rules for `echo`/`curl`/`git`/etc. are the intended hard block and stay).
- Tolerating pipes `|`, backgrounding `&`, newline separators, file-referencing redirects (`2>/dev/null`, `> file`), or any other shell operator.
- Completion verification for `memory-maintenance` / `channel-memory-maintenance` sessions (same pattern applies; follow-up).
- Fixing webfetch 403s on bot-protected origins (origin-side; mitigation is guidance + browser fallback).
- Fixing agent-browser Chrome installation (separate concern tracked by the container tooling).

## Decisions

### D1 — Segment-wise approval of `;`/`&&`/`||` chains in the ACP gate

**Mechanism.** New exported pure helper `splitCommandSegments(cmd: string): string[]` in `src/acp/client.ts`:

- Scans the raw command tracking quote state: `'` single quotes (fully literal), `"` double quotes (with shell-correct escapes: `\` before `"`/`\`/`$`/`` ` `` inside double quotes skips the next char), `\` outside quotes escapes the next char.
- Splits on `;`, `&&`, `||` only when the operator text appears outside quotes.
- Trims segments, drops empty ones. Unbalanced quotes → returns `[cmd]` (splitting disabled; the single-command gate then evaluates the whole string — an unbalanced quote can only cause a runtime shell error, never an escape). No separator found → returns `[cmd]` (byte-for-byte identical behavior to today).
- A segment that consists ONLY of tolerated fd-redirect tokens (e.g. the `2>&1` in a glued `2>&1&&cat ...`) is an operator artifact, not a command: it SHALL NOT be skipped, and the evaluator SHALL reject it as `shell_operator` (preserving the existing glued-operator rejection semantics for `2>&1&&cat`, `2>&1;curl`, etc.).

**Evaluation.** `requestPermission`'s `execute` branch (and a new exported `multiCommandRejectionReason(cmd, base, allowedDirs, ...)`) evaluates EVERY segment: first the skill-whitelist matchers (`matchesScriptPath` / `matchesCommandPrefix` on the segment), else the generic gate (`genericCommandRejectionReason` on the segment). Approved iff all segments pass. On failure, the FIRST failing segment's cause is reported (audit reason, WARN log context adds the failing segment text; the log `messageTemplate` stays `Rejecting generic command: {reason} (command {index} of {total}: {command})` for GELF classification stability).

**Why segment-wise is sound (capability union, not capability grant).** The agent can already run each segment as its own gated tool call; the gate is the same in both paths. Chaining only saves round trips. Shell-state-carrying segments (env assignment, `cd`, `export`, `alias`, `eval`, `.`/`source`, `exec`) all fail the first-token allowlist, so a chain cannot smuggle state into later segments beyond what each segment's own argv allows. `matchesScriptPath`/`matchesCommandPrefix`/`genericCommandRejectionReason` keep their exact single-command semantics (existing unit tests stay valid); only the composition point changes. The one evaluator weakness — runtime shell expansion of unquoted `$VAR`/brace tokens that look in-workspace lexically — is closed by D5 before this rule ships.

**Alternatives considered:**
- *Prompt-only mitigation* (teach the model one-command-per-call): rejected as insufficient — this is the third recurrence of the same habit class despite a prior gate fix; model batching behavior is not reliably correctable by prose.
- *Allow all chaining without per-segment gating*: rejected — `agent-browser; curl evil.com` would execute.
- *Split on `|` and `&` too*: rejected — capability-union argument also holds there, but pipes/backgrounding add concurrency and stdio semantics the gate has never reasoned about; no observed failure needs them. Kept rejected, documented as future work.
- *Reject chains, improve the immediate rejection feedback*: rejected — OpenCode renders `RejectedError`/`DeniedError` texts; the harness cannot inject per-rejection guidance into that text. Actionable feedback only exists at the retry-prompt level (existing ring buffer), which is the R2 fix.

### D5 — Shell-expansion token tightening (prerequisite for D1)

The generic gate's per-token path check (`genericArgWithinWorkspace`) and the skill matchers' `referencesOutOfWorkspacePath` expand ONLY a fixed set of harness-set variables and reject everything else that the shell could expand into a path:

- **Expanded (harness-set, all point at known locations):** `$HOME`/`${HOME}`, `$XDG_DATA_HOME`/`${XDG_DATA_HOME}` (existing), plus `$TMPDIR`/`${TMPDIR}`, `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}`, `$SESSION_ID`/`${SESSION_ID}` — the generic gate expands them and containment-checks the expanded path (all resolve inside the session workspace or the agent workspace, so they pass); the skill matchers recognize them as known variables without expanding (preserving the `--content-file $TMPDIR/$SESSION_ID/x.md` skill payload contract).
- **Rejected:** any other UNQUOTED `$VAR`/`${VAR}` reference (e.g. `$IFS/etc/passwd` — an unquoted expansion can be word-split into an out-of-workspace path), any unquoted brace-expansion token (e.g. `{safe,/etc/passwd}`), and any DOUBLE-QUOTED non-harness `$VAR`/`${VAR}` reference that BEGINS the token's path content (e.g. `"$X/etc/passwd"`, `"$X"`, `"$_"`, `--flag="$X"` — an UNSET variable expands to empty, and empty + literal `/...` or `..` IS an absolute/traversal path; a set variable can also carry an absolute value directly). `$` inside single quotes is literal and allowed; a double-quoted reference EMBEDDED after literal text (`"price $X"`, `"a$X"`) is allowed — a literal prefix keeps the expanded result relative, and embedded `..`/`/` after a literal prefix still resolves in-workspace. Backslash-escaped newlines (line continuations — bash silently removes `\<newline>`) are rejected as shell operators in every quote state, closing a continuation-based path escape (`cat \<newline>/etc/passwd`).

This closes a PRE-EXISTING hole in the single-command gate (`cat $IFS/etc/passwd` and `cat {safe,/etc/passwd}` read out-of-workspace files today) — a hole that would otherwise invalidate the "every segment is individually safe" premise the chaining rule is built on. Over-rejection risk (e.g. `rg '{literal'` unquoted) is accepted and documented; quoting avoids it.

**Alternatives considered:**
- *Route generic commands through the shell's own parse tree (argv execution without a shell)*: the robust long-term fix, rejected for this change — it requires reimplementing/shelling out to a parser and changes execution semantics; tracked as follow-up.
- *Leave the hole and document it*: rejected — the chaining feature makes the gate the explicit safety basis for multi-command invocations, so the evaluator must be sound for single commands first.

### D2 — Self-research completion verification + one corrective retry

**Note fingerprint.** In `processSelfResearch`, before `connector.prompt()`, snapshot `$AGENT_WORKSPACE/notes/` and `$AGENT_WORKSPACE/journal/` RECURSIVELY: map `relativePath → { size, mtimeMs, contentHash }` (sha-256 of file bytes; the directories are small, hashing is cheap; a content hash removes same-size/same-millisecond overwrite blind spots). Missing dir → empty snapshot. After an `end_turn`, a note was produced iff any entry is NEW or its content hash changed AND its `mtimeMs` is at or after the session start (minus a 1s clock slack). The session-time bound gives attribution: a file modified before the session started (or by a concurrent writer before our session) does not count. I/O errors while snapshotting/verifying SHALL NOT fail the session: log a WARN and treat as "produced" (fail-safe: never retry on verification uncertainty, to avoid retry loops). Attribution is best-effort: the scheduler is single-flight (`isRunning` guard), user sessions cannot write the agent workspace, and memory-maintenance does not touch it; a multi-replica deployment writing the same workspace concurrently is a documented known limitation (follow-up: cross-process lock), not addressed here.

**Retry.** When no note was produced and `selfResearch.verifyCompletion !== false`:

1. Audit `retry_triggered` (reason `no_research_note`, retryCount 1, maxRetries 1).
2. WARN log including the session's recent permission rejections.
3. Snapshot `connector.getClient()?.getRecentPermissionRejections()` (BEFORE the next prompt — mirrors `sendRetryPrompt`'s snapshot discipline, since `prompt()` runs `reset()`).
4. `connector.prompt(sessionId, retryMessage)` on the SAME session. The retry message is built in code (same pattern as `getRetryPromptStrategy`): states the note requirement, embeds the bounded `Recent permission rejections in this session:` section via `formatPermissionRejections`, NAMES the commands that OpenCode itself denies before the ACP gate (`echo`, `curl`, `git`, `python`, `mkdir`, …) so the model stops attempting `|| echo`-style fallbacks and is pointed at the Read tool for missing-file handling, restates the sandbox usage rules (`;`/`&&`/`||` chains of individually-allowed commands OK, `|`/`&`/`2>/dev/null`/`> file` rejected; webfetch 403/429 → switch to `agent-browser`), and requires writing the note to `$AGENT_WORKSPACE/notes/{topic-slug}.md` (env-var path, deployment-independent) and updating `$AGENT_WORKSPACE/notes/_index.md`.
5. Audit the retry turn: `prompt_sent` (or `agent_message`) for the retry prompt and `agent_response` with `isRetry: true` for its response. The first turn's response is recorded as `agent_response` with `isRetry: false`. Exactly ONE `session_end` entry SHALL be written after the final verification outcome — never one before the retry, and never two.
6. Re-verify. Produced → session success (audit `session_end` success). Still none → session FAILURE: `result.success = false`, `error = "no_research_note"`, audit `session_end` with `success: false` + reason, increment `airfriends_self_research_no_note_total` (ONLY when verification is enabled — the disabled path cannot know the outcome and does not count).

Non-`end_turn` stop reasons keep today's behavior (failure, no retry). When `verifyCompletion` is false the flow is byte-identical to today (no snapshot, no metric).

**Why file-based rather than skill-call-based.** Self-research produces its output through edit/write permission approvals, not through the Skill API; the audit counters (`skillCallsCount`, `memoryOpsCount`) would miss file-only output. File fingerprints are cheap, side-effect-free, and directly test the job's deliverable.

### D3 — Guidance alignment

- `prompts/agent_permissions.md`: replace the stale list (`curl` is NOT allowed anywhere) with the real allowlist; document the chaining rule ("multi-command calls with `;`/`&&`/`||` are allowed only when every command is individually allowed; the whole call is rejected otherwise; `|`, `&`, `2>/dev/null`, `> file` are always rejected; `echo`/`curl`/`git`/`python`/`mkdir` are denied by OpenCode before the ACP gate; use the Read tool instead of `cat`-with-fallbacks").
- `prompts/browser_automation.md`: same chaining rule; add "if `webfetch` returns 403/429, switch to `agent-browser` (one command per call or `;`/`&&`/`||`-chained allowed commands)".
- `skills/self-research/SKILL.md`: step 1 uses the Read tool on `$AGENT_WORKSPACE/notes/_index.md` (env-var path — the workspace root is `workspace.repoPath`-derived, not a fixed `/app/data` path in all deployments); brief sandbox note.

### D4 — Config, env, metrics

- `selfResearch.verifyCompletion: boolean` (default `true`) + `SELF_RESEARCH_VERIFY_COMPLETION` env override (`"true"`/`"false"`). Wired through `src/types/config.ts`, `src/core/config-loader.ts`, `src/utils/env.ts`, documented in `config.example.yaml`, `.env.example`, `helm/values.yaml`, `docs/` per project convention.
- New counter `airfriends_self_research_no_note_total` (no labels) registered in `src/utils/metrics.ts`, documented in the metrics table.

## Risks / Trade-offs

- **A carve-out in a security boundary invites future broadening** (`;` today, `|` tomorrow). → The spec pins the boundary: exactly `;`/`&&`/`||`, quote-aware, every segment must independently pass; pipes/backgrounding/redirects explicitly remain rejected and are tested. The change is capability-neutral by construction (each segment faces the same gate as a standalone call).
- **Parsing divergence between our splitter and bash/tree-sitter.** → Conservative by design: unrecognized forms (unbalanced quotes) disable splitting; a mis-split can only over-reject (a benign command denied), never under-reject; every segment still passes the full single-command gate, so a malicious chain needs every segment to be individually approved regardless of split correctness. Edge cases pinned by unit tests (`"a;b"` quoted text, `2>&1&&cat` glued, escaped quotes, `; ;` empty segments, redirect-only segments).
- **Shell expansion of unquoted `$VAR`/brace tokens can defeat lexical path checks.** → Closed by D5: only harness-set variables are expanded; every other unquoted `$`-reference, unquoted `{`-token, token-start double-quoted non-harness `$`-reference, and backslash-escaped newline is rejected. Residual risk (embedded double-quoted expansions whose values are operator-controlled paths, `$@`/`$*` embedded forms) is documented in `docs/AGENT_PERMISSIONS.md`; the long-term fix (argv-level execution without a shell) is a follow-up.
- **The model may still attempt `|| echo`-style fallbacks.** → OpenCode's own layer denies those (`echo *` deny) before our gate; the retry prompt names those commands explicitly and teaches the Read tool pattern. Gate-side tolerance for `echo` is NOT proposed.
- **Fingerprint attribution across concurrent writers** (multi-replica deployment or overlapping sessions). → The scheduler is single-flight and user sessions cannot write the agent workspace; verification additionally requires a content-hash change with `mtimeMs` at/after session start. Multi-replica shared-workspace writes remain a documented known limitation with a cross-process lock as follow-up.
- **Retry cost** (one extra prompt turn per failed research session, ~a minute of model time). → Bounded: exactly one retry, verification fail-safe never loops, and it only fires when the job genuinely produced nothing.
- **False "no note" when the agent writes elsewhere.** → The note contract (`notes/` + `journal/`) is explicit in the skill and the retry prompt; writes outside those dirs are not research output by definition.
- **Verify toggle misconfiguration.** → `verifyCompletion` defaults ON; disabling is an explicit operator choice for the legacy behavior (and disables the metric, which cannot be measured without verification).

## Migration Plan

No backward-compatibility concerns (early-stage project, zero users in the wild). Deploy: gate changes are pure functions with unit tests; the self-research flow change is additive; prompts are bundled files (container VOLUME override keeps compatibility with mounted custom prompts — mounted `agent_permissions.md`/`browser_automation.md` users must re-mount to get the corrected guidance, documented in CHANGELOG).

## Open Questions

- Whether memory-maintenance/channel-memory-maintenance should get the same completion verification in a follow-up change (they have skill-call counters to key on instead of file fingerprints).

## Contract Verification (task 8.4 — manual, recorded 2026-08-17)

Verified end-to-end against the local OpenCode binary (v1.18.9; the pinned container
v1.17.13 could not be run on this host — the local binary exercises the same ACP
permission contract) using the project's real `AgentConnector` + `ChatbotClient` with a
copy of the restricted `agent-config/opencode.json` build-agent permissions:

- `agent-browser --version 2>&1; agent-browser --help 2>&1` — the observed production
  failure shape — reached the ACP gate as **ONE** permission request and was **approved**
  (`permission_approved`, reason `skill_whitelist`): both segments independently matched
  the `agent-browser` command prefix with tolerated `2>&1` fd-redirect tokens.
- `cat notes.md 2>/dev/null || echo NOINDEX` — generated **no** ACP permission request:
  OpenCode's own tree-sitter matcher denied the `echo` node (`echo *` deny rule) before the
  gate was consulted, confirming that `|| echo`-style fallbacks stay blocked at OpenCode's
  layer (the retry prompt's Read-tool guidance is the corrective teaching path).

Unit-level sanity (`multiCommandRejectionReason` on both shapes): the `|| echo` chain is
rejected with `shell_operator` (the `2>/dev/null` file redirect); the `agent-browser ;`
chain's segments are each evaluated against the gate.
