## Context

Skill scripts (`skills/*/scripts/*.ts`) are executed by the external ACP agent via OpenCode's Bash tool. `agent-config/opencode.json` (restricted `build` agent) grants the patterns `deno run *skills/*/scripts/*.ts*` and `*/skills/*/scripts/*.ts*` `"allow"`, so OpenCode self-authorizes these commands and executes them with `/bin/bash -c <command>` WITHOUT forwarding them to the ACP client's `requestPermission()` (see the sandbox-hardening requirement "Filesystem-Touching Bash Tools Route Through the ACP Gate", which explicitly permits skill-invocation patterns to remain `"allow"`). Consequently the only content boundary that always executes is the skill script itself.

The bug: free-text payloads (reply text, memory content, search queries, captions, reminder text) are passed as double-quoted CLI arguments (`--message "定價 $0.435"`). Bash expands `$0` → `/usr/bin/bash`, `$VAR` → the agent subprocess environment's value (which includes `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `SKILL_API_TOKEN`, `SESSION_ID`, ...). The expansion happens inside the agent subprocess, after the gate (or opencode's self-authorization) approved the command, so no existing permission-layer check can see or prevent it. Verified in production: a Discord reply contained `/usr/bin/bash.435 / /usr/bin/bash.87` for a pricing string `$0.435 / $0.87`.

The fix must remove message content from the shell command line entirely. The only trusted transport that bypasses the shell is the ACP filesystem interface (`edit`/`write` tools and `writeTextFile`), which writes bytes verbatim and is already scoped by path-containment checks. Reminder messages are stored at `set-reminder` time and later delivered by an agent session, so they carry the same expansion corruption into stored data; memory `--content`/`--query` arguments corrupt long-term memory. The auto-conversation-summary prompt (`prompts/system_summary.md`) embeds the old `memory-save --content "..."` contract and is executed by default, so it is a hard integration point too. All free-text args share one root cause and one fix; `memory-patch` args (`--memory-id`, `--visibility`, `--tier`, ...) are controlled vocabularies and are unaffected.

Known concurrency constraint: `TMPDIR` is `{workspace}/tmp` — per-WORKSPACE, not per-session (sessions of the same user may run concurrently; `XDG_DATA_HOME` is already session-scoped under tmp as `{workspace}/tmp/opencode-data/{sessionId}`). Payload staging must therefore be session-scoped or concurrent sessions could overwrite/read each other's payloads.

Secondary change bundled with this change: the Discord adapter's startup slash-command cleanup logs say "deleted/remove" ("Successfully deleted all global slash commands", "Successfully deleted all guild commands"). The operation actually aligns the registered command set to an empty manifest; the wording is renamed to "aligned" (method `cleanupSlashCommands` → `alignSlashCommands`, plus in-progress and error log messages). Purely cosmetic; no behavior change.

## Goals / Non-Goals

**Goals:**

- No skill-script argument that carries free text ever passes through a shell command line, so shell parameter expansion can neither corrupt content nor leak subprocess environment variables into public channels.
- The replacement mechanism (payload files) is approved AND executed on the same canonical path: the ACP path boundary expands `$TMPDIR`/`$SESSION_ID` tokens, and the expanded path — not the raw string — is what `readTextFile`/`writeTextFile` actually read/write.
- Payload staging is session-isolated (no cross-session content mixup between concurrent sessions of the same user).
- A naive `--message-file <path>` cannot become an arbitrary-file-exfiltration primitive: script-side containment is TMPDIR-scoped, session-bound, and symlink-aware.
- Legacy free-text flags fail loudly in every form (`--message x` and `--message=x`): clear error from the script, and rejection at the gate if a skill command with them ever reaches `requestPermission`.
- Every contract failure (rejected script call AND a turn that ends without a reply) surfaces instructive guidance — what went wrong, why, and the exact correct invocation — so the agent self-corrects instead of looping or failing silently.
- Uniform contract across all free-text skill arguments (one helper, one pattern), including the embedded usage snippet in `prompts/system_summary.md`.
- Discord startup command logs reworded from "remove/delete" to "align".

**Non-Goals:**

- Changing how the Skill API server receives content (handlers already receive content as JSON body parameters; no API change).
- Re-routing skill bash invocations from `"allow"` to `"ask"` in `opencode.json` (would round-trip every skill call through the ACP gate; the script-level enforcement is authoritative because the script is the only sender of external content).
- Escaping/quoting instruction ("escape your `$`") as the primary fix — unreliable, model-dependent, and cannot be enforced.
- Extending token expansion beyond `$TMPDIR`/`${TMPDIR}`/`$SESSION_ID`/`${SESSION_ID}` in the ACP path checks (no `$AGENT_WORKSPACE` expansion; self-research writes already work with the absolute path the prompt provides).
- Fixing the general class of "agent writes `$VAR` in *any* bash command" (that is inherent to bash and already bounded by the generic-command gate's argument checks for filesystem-touching tools).
- Preventing a deliberate agent from restating workspace content it can already read (the agent may read `memory.private.jsonl` and paraphrase it in a reply; the payload mechanism adds no capability beyond that — see Risks).
- Changing the Discord cleanup behavior itself — only the wording/method name changes.

## Decisions

### D1: Payload files staged in the session TMPDIR, passed via `--*-file` flags

Each free-text argument is replaced by a payload-file flag: `--message-file` (send-reply, edit-reply, set-reminder), `--caption-file` (send-file), `--content-file` (memory-save), `--query-file` (memory-search, fetch-context). The agent flow becomes:

1. Write the text to `$TMPDIR/$SESSION_ID/reply.md` (etc.) using its edit/write tool — the literal `$TMPDIR/$SESSION_ID/...` path string is passed to the tool; the ACP path boundary expands both tokens (D3) and approves the write. No shell is involved, so bytes are preserved verbatim.
2. Invoke the script: `${HOME}/.agents/skills/send-reply/scripts/send-reply.ts --session-id "$SESSION_ID" --message-file "$TMPDIR/$SESSION_ID/reply.md"`. The command line carries no free text; `$SESSION_ID`/`$TMPDIR` expansions are controlled values.

**Rationale**: the ACP filesystem interface is the only verbatim transport the agent can use in restricted mode (bash `>`/`<`/`echo`/`printf` are all denied or rejectable at the gate). Alternatives considered:
- *Heredoc (`<<'EOF'`) passing* — rejected: `containsShellOperators()` rejects `<`/`>`, so the gate would deny it, and its safety depends on the agent choosing a quoted delimiter, which cannot be enforced.
- *Keep `--message` + instruct escaping* — rejected: unenforceable; a single unescaped `$` reopens the leak.
- *Message via environment variable* — rejected: the agent cannot set subprocess env vars; `env` is not writable from a tool call.
- *Reject `--message` usage at the gate only* — rejected as the sole fix: skill commands bypass the gate (`"allow"` in opencode.json), so enforcement must live in the script; the gate rejection is kept as defense-in-depth (D4).

### D2: Canonical invocation — direct shebang execution; scripts gain `--allow-read` and `--allow-write`

The canonical and documented invocation form is DIRECT script execution (`${HOME}/.agents/skills/<name>/scripts/<name>.ts ...`), which runs the shebang `#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write`. `--allow-read` is REQUIRED for the new `Deno.readTextFile()` payload read (verified: local module imports load without it, but runtime fs reads are denied); `--allow-write` is required for the best-effort deletion of the consumed payload file (implementation note: `Deno.remove` is a write op; without the flag the deletion silently failed under `--allow-read` only). The `deno run <script>` form remains matched by `opencode.json` for flexibility, but without explicit flags it fails loudly on the first denied permission (network, env, read, or write) — never silent corruption. `SKILL.md` examples standardize on direct execution. `agent-browser`-style command skills are unaffected.

**Rationale**: shebang flags are the only permission source that travels with direct execution; the pre-existing scripts already rely on this (`--allow-net --allow-env` today). A design example that showed `deno run <script>` without flags (review finding) would lose all four flags; the canonical form is now unambiguous and covered by subprocess tests (task group 7) that execute the scripts directly against a mock `--api-url`.

### D3: Script-side payload containment — session-scoped TMPDIR, symlink-aware

A shared helper in `skills/lib` (new module `skills/lib/payload.ts`) implements:

- `resolvePayloadBase(cwd, sessionId)` → `{cwd}/tmp/{sessionId}` (session-scoped staging dir). For sessions without a session id (defensive; internal sessions), the base falls back to `{cwd}/tmp`.
- `resolvePayloadPath(payloadPath, cwd, sessionId)` — resolves the given path against the script's cwd (the session workspace — agent subprocesses run with the workspace as cwd) and requires the result to be inside the session staging base using boundary-safe matching (equal-or-separator-prefixed, so `{base}-2`/`{base}2` siblings are rejected). When the file exists, `Deno.realPath()` is applied and the REAL path is re-checked for containment, so a symlink inside tmp pointing outside (or into another session's dir) is rejected. Out-of-boundary paths, missing files, and read failures produce a structured error (exit 1) and the script does NOT call the Skill API. After a successful read, the script SHALL best-effort delete the payload file.

The containment rule is deliberately TMPDIR-only (not whole-workspace): the TMPDIR is the agent's scratch/staging area by design (`agent_permissions.md` already advertises `$TMPDIR` as the writable scratch space), while workspace-root files (`memory.private.jsonl`, notes, uploaded files) remain readable by the agent through other means but must never be bulk-shipped verbatim to an external channel via a payload file.

The bot pre-creates the session staging directory `{workspace}/tmp/{sessionId}` in `setupSession()` (right after the shell session is registered), because neither the agent's edit/write tool nor `writeTextFile` creates parent directories — a missing parent would make every payload write fail and surface later as `SKILL_PAYLOAD_NOT_FOUND`. `cleanupWorkspaceTmp()` (removes the whole `{workspace}/tmp` when the last session for a workspace ends) already covers the per-session staging dirs, so no separate cleanup is needed. (Review finding: the staging dir is removed at session end — verified; assertion must run mid-session.)

**Rationale**: the helper is a pure function with unit tests; the same containment logic already exists in `src/acp/client.ts::isWithinDir` and is copied (skills are standalone Deno scripts and cannot import from `src/`). The session-id element closes the concurrency race the review found: `TMPDIR` is per-workspace and fixed filenames (`$TMPDIR/reply.md`) would let concurrent sessions of the same user overwrite or read each other's payloads; `$TMPDIR/$SESSION_ID/...` (with the script's own `--session-id` on the containment side) makes staging per-session, matching the existing `XDG_DATA_HOME` session-scoping pattern. The `realPath` step closes the symlink-escape vector (a symlink planted in tmp — e.g. by a YOLO session or leftover state — pointing at `/etc/passwd` or a sibling workspace would otherwise bypass lexical containment).

### D4: Token expansion in the ACP path boundary — expanded path is the ACTUAL I/O path

`ChatbotClient` gains a single canonical resolver used by BOTH authorization and execution:

- `resolveSessionPath(path)` expands the exact tokens `$TMPDIR`, `${TMPDIR}`, `$SESSION_ID`, `${SESSION_ID}` to the resolved session TMPDIR (`resolve(config.workingDir, "tmp")`) and `config.sessionId` respectively, then returns the canonical path. (An absent session id expands to an empty string; unexpandable `$OTHER` tokens are left verbatim and fail containment.)
- ALL session flows SHALL set `clientConfig.sessionId` (the shell session id) so the expansion is consistent with the script-side `--session-id` — a mismatch (gate expanding `$SESSION_ID` to empty while the script reads `{workspace}/tmp/{actualSessionId}`) would write the payload outside the staging dir the script reads. (Review finding: self-research and channel memory-maintenance client configs were missing `sessionId`; fixed.)
- `isPathAllowed()`, `isAgentWorkspacePath()`, and `isWithinTmpDir()` apply `resolveSessionPath()` before the boundary-safe containment check, so a literal `$TMPDIR/$SESSION_ID/reply.md` path (as the agent types it into its edit/write tool) is approved.
- `readTextFile()` and `writeTextFile()` SHALL perform their actual `Deno.readTextFile`/`Deno.writeTextFile` on the `resolveSessionPath()`-canonicalized path — NOT the raw `params.path` — so the path that passed validation is the path that is read/written (review finding: validation/use path mismatch would otherwise write a literal `$TMPDIR` directory under the bot's cwd).

This mirrors the generic-command gate's home-anchored expansion (`expandHomeReferences` in `src/acp/client.ts`). The bot never executes the expanded value; it only resolves and compares paths, so no injection is possible (a path is data).

### D5: Gate defense-in-depth — legacy free-text flags rejected in both forms

In `requestPermission()`'s skill-command auto-approval branch (kind `execute`, whitelisted script/prefix match), if any whitespace-delimited token matches `/^--(?:message|content|query|caption)(?:=|$)/` (exact `--message` or `--message=value`; `--message-id`, `--message-file`, `--content-file`, `--query-file`, `--caption-file` are distinct tokens and unaffected), the command is rejected with a structured `permission_denied` audit reason (`rejected_skill_free_text_flag`) instead of approved. The script-side check (D2/D6) uses the same token pattern on `Deno.args`, so both layers agree. This is defense-in-depth: in the default config these commands never reach the gate, but if a deployment changes `opencode.json` to route skill invocations to `"ask"`, or a future launcher path arrives at the gate, free-text smuggling stays blocked.

### D6: Uniform contract, no backward compatibility

All seven scripts migrate at once; legacy flags are REMOVED (not deprecated). Scripts reject any token matching the legacy pattern with `use --<flag>-file instead of --<flag>`-style errors so an agent that tries the old form immediately self-corrects (and, because a failed `send-reply` yields no reply, the missing-reply retry mechanism re-prompts the agent with the SKILL.md instructions). Zero users, so no compat shim.

### D7: SKILL.md, prompts, and docs

Each affected `SKILL.md` documents the two-step flow (write payload to `$TMPDIR/$SESSION_ID/{name}.md` → invoke with the payload-file flag) and a warning that message content must never appear on the command line. `prompts/system_summary.md` — which embeds the `memory-save --content "..."` usage block and runs by default for conversation summaries — is updated to the payload-file flow (its summary content is itself free text and would corrupt identically). `docs/SKILLS_IMPLEMENTATION.md` and `AGENTS.md` skill-invocation examples are updated to the new contract. A repository-wide search confirms no other embedded `--content "..."` / `--message "..."` examples remain. `prompts/agent_permissions.md` already lists `$TMPDIR` writes as allowed — verified, no change needed there.

### D8: Instructive error messages — every failure teaches the correct pattern

Because the payload-file flow adds a step, the error output SHALL be self-correcting: every contract failure produced by a script or by the retry mechanism SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example. This targets both failure moments the agent can hit: a rejected script invocation (the agent sees the tool error output mid-turn) and a turn that ends without a reply (the retry prompt, D9).

The shared payload helper (`skills/lib/payload.ts`) SHALL raise typed errors carrying a stable `code` plus a guidance message. Codes:

| Code | Trigger | Guidance content |
| --- | --- | --- |
| `SKILL_LEGACY_FLAG` | Legacy free-text flag used (`--message x` or `--message=x`) | State the flag was removed for security (shell `$` expansion corrupts or leaks content), forbid putting message content on the command line, show the two-step flow with the concrete example invocation |
| `SKILL_MISSING_PAYLOAD` | Required payload flag absent | Name the required flag, show the two-step flow |
| `SKILL_PAYLOAD_OUT_OF_BOUNDS` | Path resolves outside `{workspace}/tmp/{sessionId}` (workspace root, sibling session, home-anchored, absolute, symlink escape) | Explain the payload must live under `$TMPDIR/$SESSION_ID/...` and why (the script only reads its own session's staging dir — this prevents sending arbitrary files), show the correct form |
| `SKILL_PAYLOAD_NOT_FOUND` | File absent/unreadable | Instruct writing the file FIRST with the edit/write tool, then invoking the script; show both steps |

Scripts emit these as structured JSON on stderr (the existing `exitWithError` contract extended with a `code` field) so the agent — and any future tooling — can parse them, while the `error` field itself is self-contained prose containing the fix and a full example command (e.g. `send-reply`'s `SKILL_LEGACY_FLAG` error includes `--session-id "$SESSION_ID" --message-file "$TMPDIR/$SESSION_ID/reply.md"`). The messages are written for the LLM audience: concrete, actionable, and specific to the failing skill (each script passes its own canonical example invocation).

**Rationale**: a generic "missing argument" error would leave a confused agent looping (and eventually hit the 4-attempt doom-loop termination) because the new two-step flow is not obvious from the old habits; a message that includes the fix converts every failure into a teaching moment. Alternatives considered:
- *Keep terse errors + rely on SKILL.md* — rejected: the agent may not re-read SKILL.md after a failure; the observed bug class came precisely from not following the docs.
- *Print guidance only in the retry prompt* — rejected: the mid-turn failure is the most common case and should be corrected immediately, before the turn ends.
- *Non-JSON plain text errors* — rejected: JSON keeps machine-parseability; the prose is inside the `error` field.

### D9: Instructive retry prompt — explains why the turn failed and how to fix it

The missing-reply retry message (`getRetryPromptStrategy` in `src/acp/agent-factory.ts`, currently "You have a special turn. You must communicate...") is rewritten to be instructive: it SHALL state that the turn ended without a reply/reaction, list the likely causes of a failed `send-reply` under the new contract (legacy `--message` used → removed; payload staged outside `$TMPDIR/$SESSION_ID/`; payload file never written; a previous `send-reply` call errored — read its output), give the correct two-step example invocation, and then embed the `send-reply` and `react-message` SKILL.md content (already the behavior today, so the guidance rides on the existing mechanism).

**Rationale**: when the agent ends without a reply it has already lost the error output context (or never attempted the skill); the retry turn is the last chance to produce a reply, so it must carry the complete correction, not just a re-prompt. The SKILL.md embedding already exists and is the natural carrier.

### D10: Discord log wording (issue 2)

`src/platforms/discord/discord-adapter.ts::cleanupSlashCommands()` → renamed `alignSlashCommands()`; log messages reworded: `"Aligning all global slash commands"` / `"Successfully aligned all global slash commands"`; `"Aligning slash commands for guild"` / `"Successfully aligned all guild commands"`; errors `"Failed to align global commands"` / `"Failed to align guild commands"`. The PUT-with-empty-body REST calls are unchanged. No tests reference the old strings (verified); the `platform-abstraction` spec wording ("SHALL clean up"/"SHALL delete") remains behaviorally accurate and is not modified.

## Risks / Trade-offs

- **Payload-file mechanism adds a step to every free-text skill call** (write file, then invoke). [Risk: agent friction, more tool calls per reply] → Mitigation: single documented pattern; the file write is a TMPDIR-allowlisted edit; scripts error clearly when the payload is missing so failures self-explain; the missing-reply retry recovers agent-side errors.
- **New exfiltration vector: `--message-file` pointing at a readable file**. [Risk: agent ships workspace file contents verbatim to a channel] → Mitigation: D3 containment restricts payload files to the session staging dir only (workspace-root memory files, agent-workspace notes, home-rooted and absolute paths are rejected by the script AND would be rejected at the gate if the command ever reaches it); symlink escapes are closed by the `realPath` check.
- **Deliberate agent exfiltration via staging**: an agent that can already read `memory.private.jsonl` can write its content into a staging file and ship it verbatim. [Risk: same-user private memory shipped to a channel] → Accepted: this grants no new read capability beyond what the agent already has (it may restate the content in any reply); bounding it would require restricting private-memory reads or human approval on public-channel sends, which is out of scope.
- **Concurrent same-user sessions share the workspace TMPDIR**. [Risk: payload overwrite/content mixup] → Mitigation: D3 session-scoped staging `{workspace}/tmp/{sessionId}` — a session can only read/write payloads under its own session id (enforced by the script containment AND by the token expansion using `config.sessionId`).
- **Agent writes the payload to a non-staging location** (e.g. `notes/` or agent workspace). [Risk: script errors, reply fails] → Mitigation: clear SKILL.md instructions to use `$TMPDIR/$SESSION_ID/...`; failure is loud (no reply → retry prompt) rather than silent corruption.
- **`$TMPDIR`/`$SESSION_ID` token expansion could surprise** (a workspace file literally named `$TMPDIR`). [Risk: negligible] → Mitigation: expansion only converts a token into a path that must still pass containment; a literal in-workspace `$TMPDIR` file resolves inside the workspace and is no more dangerous than the agent writing any TMPDIR file.
- **YOLO mode keeps the same contract**. [Risk: a YOLO agent used to `--message` now must write files] → Mitigation: same SKILL.md docs apply; YOLO agents can write anywhere, and the session-scoped containment check still passes for `$TMPDIR/$SESSION_ID` payloads (YOLO is trusted by definition).
- **`deno run <script>` without flags fails after the change** (needs `--allow-read`/`--allow-write`; today it already needs `--allow-net`/`--allow-env` that the shebang provides). [Risk: an agent choosing the `deno run` form sees permission errors] → Mitigation: SKILL.md standardizes direct shebang execution; failures are loud and self-explain; the `deno run` pattern in `opencode.json` is unchanged.
- **Agent repeatedly fails despite instructive errors** (e.g. insists on `--message`, or never writes the payload file). [Risk: 4 failed `send-reply` attempts hit the doom-loop termination] → Mitigation: D8/D9 errors carry the full correction so failures are self-correcting; if the agent still fails, termination is the designed resource protection, and the failure is loud (no reply → retry → failure response) rather than silent corruption.
- **Bundling a cosmetic change (D10) with a security change**. [Risk: review noise] → Mitigation: both are tiny, both are part of the same deployment window; D10 is isolated to one method and is behavior-neutral.

## Migration Plan

No data or config migration. Skill scripts, SKILL.md files, and `prompts/system_summary.md` ship together; the Skill API and handlers are untouched, so old in-flight sessions that call legacy flags get a clear script error and the retry mechanism recovers. Rollback is a revert of the script/SKILL.md/prompt changes plus the `client.ts`/`discord-adapter.ts` edits; behavior returns to today immediately (including the pre-fix expansion bug — acceptable only transiently).

## Open Questions

- None blocking. One verification task will run a live restricted-mode session with a reply containing `$0.435` / `$HOME` and assert the literal text reaches the platform (regression scenario in the delta spec).
