## Context

The restricted-mode ACP permission gate (`ChatbotClient.requestPermission` in `src/acp/client.ts`) is the authoritative decision point for filesystem-touching bash commands. OpenCode routes `rg *`, `cat *`, `head *`, `ls *`, `jq *`, etc. to `"ask"` (see `agent-config/opencode.json`), so every such command arrives at the gate, which approves it only when (a) the first token is on `GENERIC_COMMAND_ALLOWLIST`, (b) every path-like argument resolves inside the `allowedDirs` boundaries via `isApprovedGenericCommand` / `genericArgWithinWorkspace`, and (c) the command contains no shell operator — `containsShellOperators()` rejects `; | & \` ( ) > < # \n` outright.

Coding models habitually append `2>&1` (duplicate stderr onto the current stdout fd) to commands. The trailing `2>&1` contains `>` and `&`, so `containsShellOperators()` rejects the command even when every path argument is perfectly in-workspace. Observed failure (self-research session, `2026-08-13`): `ls -la /app/data/workspaces/discord/self-research/tmp/opencode/ 2>&1` was denied. Compounding the issue, the gate's rejection WARN (`src/acp/client.ts:866`) hard-codes the message "Rejecting generic command: path argument outside session workspace/TMPDIR" for ANY generic-gate failure — shell operator, dangerous flag, non-allow-listed first token, or path escape — so this benign operator rejection was misreported as a path-boundary escape, sending diagnosis in the wrong direction.

The same `2>&1` habit also breaks the skill-whitelist matchers: `matchesScriptPath` / `matchesCommandPrefix` call `containsShellOperators()` up front, so a skill invocation suffixed with `2>&1` (e.g. `deno run .../memory-save.ts --content-file $TMPDIR/$SESSION_ID/x.md 2>&1`) is dropped from the skill whitelist and falls through to the generic gate, where its first token (`deno`) is not on the allow-list — also rejected.

## Goals / Non-Goals

**Goals:**

- Restricted-mode agents can run allow-listed readers with a trailing `N>&M` fd-redirect token (`2>&1` and similar) without being falsely rejected.
- The tolerance is maximally narrow and provably cannot grant filesystem access: only a whitespace-delimited token that is EXACTLY `^\d+>&\d+$` is tolerated; everything that can reference a file remains rejected.
- The same tolerance applies consistently to the generic gate and the entrypoint-anchored skill matchers.
- Rejection logging and the `permission_denied` audit reason report the ACTUAL rejection cause instead of always claiming a path escape.

**Non-Goals:**

- Allowing file-referencing redirects of any form (`>/dev/null`, `2>/tmp/x`, `>&word`, digit-prefixed filenames). These remain rejected.
- Loosening any other shell operator rejection (`;`, `|`, `&&`, backtick, `$()`, `<`, `#`, newline) — chaining/substitution still means injection and stays denied.
- Changing how OpenCode executes commands, the allow-list contents, the `allowedDirs` boundaries, or any of the home-anchored expansion / attached-option / cross-session rules from the previous change.
- Fixing the model behavior that emits `2>&1` (out of our control; the gate is the reliable mitigation).

## Decisions

### D1: Whole-token fd-to-fd redirection tolerance, restricted to standard streams

`isApprovedGenericCommand` treats a token as harmless iff it matches the pattern `/^\d+>&[12]$/` in full — the target descriptor `N` is one-or-more digits, and the SOURCE descriptor `M` is restricted to `1` or `2` (the standard stdout/stderr capture pipes OpenCode always connects). Examples tolerated: `2>&1`, `1>&2`, `3>&1`. Not tolerated: `1>&3`, `2>&3`, `9>&99`. Such tokens are (a) removed before the shell-operator check and (b) skipped in the per-token path-argument loop. The first-token allow-list check operates on the original tokens, unchanged.

**Why this is safe:** OpenCode spawns the agent shell with only the standard descriptors connected (stdin ignored, stdout/stderr captured as pipes — `ChildProcess.make(command, [], { shell, cwd, env, stdin: "ignore", ... })`), and a `bash -c` child does not inherit descriptors above 2 (CLOEXEC). A `[n]>&1` / `[n]>&2` duplicate therefore copies onto an already-open pipe, opening nothing and naming no path. Restricting the SOURCE descriptor to `{1,2}` is defense-in-depth: if a future runtime ever connects a higher descriptor to a writable file/socket, an unchecked `1>&3`-style redirect could let an allow-listed reader's output land there with no path argument for the containment scan to see. OpenCode executes the original command string (the gate only makes a permission decision; `src/acp/tool/shell.ts` spawns `params.command` as given), so tolerance never changes what actually runs — it only stops over-rejecting.

**Alternatives considered:**
- *Substring stripping* (`cmd.replace(/\d+>&\d+/g, "")`) — REJECTED. This was the first draft and has a real residual: a digit-prefixed FILENAME redirect such as `2>&1/tmp/x` or `2>&1x` would have its `2>&1` substring stripped for the operator check, the residual token `…/tmp/x` / `x` then resolves inside the workspace and passes containment, but bash interprets `2>&1/tmp/x` as "open file `1/tmp/x` for writing" (the word after `>&` is not a number, so it is opened as a file). That would let a "read-only" reader create/truncate a file inside the workspace. Whole-token filtering keeps the `>` and rejects the command, closing this completely.
- *Unrestricted source descriptor* (`/^\d+>&\d+$/`) — REJECTED after rubber-duck review. An arbitrary right-hand descriptor (`1>&3`, `9>&99`) cannot be proven under the gate's control; restricting to the always-connected standard streams keeps the property airtight.
- *Broadening `containsShellOperators()` itself* to ignore `&`/`>` contextually — REJECTED: a string-level regex cannot distinguish an fd-duplicate from a file redirect; token-exact matching is the only crisp rule, and keeping the operator function strict preserves defense-in-depth for the other call sites.

### D2: Shared filter helper for the three operator checks

A small pure helper `commandWithoutFdRedirects(cmd: string): string` splits on shell TOKEN separators (space/tab ONLY — a newline is a shell COMMAND separator, not a token boundary, so it must survive filtering for the operator check), drops tokens matching `/^\d+>&[12]$/`, and rejoins with single spaces. `isApprovedGenericCommand`, `matchesScriptPath`, and `matchesCommandPrefix` all pass its output to `containsShellOperators()`. Glued forms (`2>&1&&cat`, `2>&1;cat`) are NOT exact tokens, so they survive the filter and the residual operator is still detected. Because the filter never consumes a newline, a newline-separated second command such as `ls x 2>&1\nrm victim` retains its `\n` and is rejected by the operator check (rubber-duck fix — the initial `/\s+/` split would have swallowed the newline and reinterpreted `rm victim` as in-workspace path arguments, an arbitrary-command bypass). `matchesScriptPath` additionally SKIPS tolerated fd-redirect tokens when resolving the entrypoint (they are not real arguments and must never be mistaken for the script), while the first-token allow-list check operates on the ORIGINAL tokens so a redirect can never masquerade as the entrypoint (rubber-duck fix). The D5 legacy free-text flag check (`--message` / `--content` / `--query` / `--caption`) runs on the ORIGINAL command, so its defense is unaffected.

### D3: Cause-specific rejection reporting

A new function `genericCommandRejectionReason(cmd, base, allowedDirs, home, xdgDataHome, dataRoot): string | null` returns one of `"shell_operator"`, `"first_token_not_allowed"`, `"dangerous_flag"`, `"path_outside_boundary"` — or `null` when the command is approved — reusing the exact logic of `isApprovedGenericCommand` (which is re-expressed via this function so the decision and the reason can never drift). In `requestPermission`, the rejection WARN and the `permission_denied` audit reason use the FIRST failing command's reason (recording the command and its index for multi-command permission requests), replacing the single hard-coded "path argument outside session workspace/TMPDIR" message.

**Audit reason mapping (single source of truth):** the path case keeps the existing code `rejected_generic_command_out_of_workspace`; the new causes map to `rejected_generic_command_shell_operator`, `rejected_generic_command_first_token_not_allowed`, and `rejected_generic_command_dangerous_flag`. The string-template form `rejected_generic_command_{reason}` is NOT used directly, because it would rename the preserved path code.

**Rationale:** the misleading message was an active debugging hazard (this incident). Cause-specific reasons make operator-vs-path failures distinguishable in logs; preserving the existing path code keeps existing monitoring queries valid.

**Single audit entry (rubber-duck fix):** the generic-rejection path RETURNS `reject_once` immediately after writing the cause-specific `permission_denied` audit entry, instead of falling through to default-deny. Otherwise the same request would also write a second, contradictory `rejected_unknown` entry that misclassifies the cause for any consumer that keys on the last entry.

### D4: Scope — all restricted sessions, no new configuration

The tolerance is global to the generic gate and the skill matchers; it is not gated on session type or a config flag. There is no new configuration surface. YOLO sessions are unaffected (fully permissive already).

## Risks / Trade-offs

- **A new carve-out in a security boundary invites future broadening.** [Risk] → Mitigation: the pattern is maximally narrow (exact whole token, source descriptor restricted to the standard streams `{1,2}`) and is pinned by spec scenarios and unit tests (`2>&1`, `1>&2`, `3>&1` approved; `2>/dev/null`, `2>&1/tmp/x`, `2>&1x`, `2>&1 && cat /etc/passwd`, `2>&1\nrm victim`, `1>&3`, `9>&99` all rejected). The spec and `docs/AGENT_PERMISSIONS.md` document that file-referencing redirects and non-standard source descriptors must never be added.
- **A future runtime could connect a high descriptor to a writable resource.** [Risk] → Mitigation: the tolerance is deliberately restricted to sources `1`/`2`, so even a harness change cannot turn a tolerated token into a hidden write target; redirects to any other descriptor remain rejected.
- **Approved commands may literally contain `&`/`>` (fd-redirect), which could confuse auditors.** [Risk] → Mitigation: D3 makes the approved/rejected logging explicit about the tolerated token; the approval log already echoes the full command.
- **The `N>&M` token could theoretically appear inside a quoted filename.** [Risk] → Mitigation: tokenization splits quoted strings on whitespace, so an exact `2>&1` token inside a filename is skipped in the path scan — but that token never becomes a path the gate must bound, and the surrounding quoted filename still resolves inside the workspace. No file is opened by the redirect (numeric `m`).
- **Lexical containment does not follow symlinks (TOCTOU), unchanged from the existing boundary.** [Risk] → Mitigation: restricted-mode agents cannot create symlinks (mutating tools are not on the allow-list); documented as a known boundary limitation, defense-in-depth remains filesystem confinement (D4 opt-in).

## Migration Plan

No data or config migration. The change is additive: previously-approved commands are still approved; previously-rejected commands gain approval ONLY when their sole offending content is an exact whole-token `N>&M` fd-duplicate. Rollback is a revert of `src/acp/client.ts` and its tests; behavior returns to today's state immediately.

## Open Questions

- None blocking. Verification that the observed failure (`ls … 2>&1`) now succeeds is a regression scenario in the delta spec and an explicit task.
