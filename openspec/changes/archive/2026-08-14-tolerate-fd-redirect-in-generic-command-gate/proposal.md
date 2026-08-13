## Why

Coding models habitually append `2>&1` (stderr-to-stdout fd redirection) to bash commands they emit. In restricted mode the ACP generic-command gate rejects any command containing a shell operator, and the trailing `2>&1` — which contains `>` and `&` — trips that check. Observed failure (self-research session, `2026-08-13`): `ls -la /app/data/workspaces/discord/self-research/tmp/opencode/ 2>&1` was denied with `Rejecting generic command: path argument outside session workspace/TMPDIR`, even though every path argument resolves inside the session workspace. The log message is also misleading: it is emitted for ANY generic-gate failure (shell operator, dangerous flag, non-allowlisted first token, or out-of-workspace path), so a benign operator rejection looks like a path-boundary escape.

## What Changes

- **Tolerate fd-to-fd redirection to the standard streams in the generic-command gate**: `isApprovedGenericCommand` treats a whitespace-delimited token that is EXACTLY `N>&M` with the source descriptor `M` restricted to `1` or `2` (the standard stdout/stderr capture pipes; e.g. `2>&1`, `1>&2`, `3>&1`) as harmless. Such tokens are removed from the shell-operator check and skipped in the path-argument scan. The real command still executes with the redirection (OpenCode runs the original), so this only relaxes the permission decision for tokens that duplicate an already-open standard stream and never reference a path on disk. A redirection whose source descriptor is NOT a standard stream (`1>&3`, `2>&3`, `9>&99`) is NOT tolerated, because a harness-inherited high descriptor could point at a resource the gate cannot see.
- **Token-boundary, not substring, tolerance**: only a token that matches `^\d+>&[12]$/` in full is tolerated, and only space/tab count as a token separator — a newline next to a tolerated token is a shell command separator that survives filtering and is rejected, so `ls x 2>&1\nrm victim` cannot be reinterpreted as an in-workspace command. Redirect forms that reference a file — `2>/dev/null`, `2>/tmp/x`, `>&word` with a non-numeric `word`, or digit-prefixed filenames like `2>&1/tmp/x` / `2>&1x` (which bash treats as a file open for writing) — are NOT tolerated and remain rejected by the existing shell-operator and path-containment checks.
- **Consistency for the skill-whitelist matchers**: `matchesScriptPath` and `matchesCommandPrefix` apply the same whole-token fd-redirect tolerance so a skill invocation suffixed with `2>&1` is not silently dropped from the skill whitelist and then re-evaluated (and rejected) by the generic gate. The tolerated token is also skipped when resolving the entrypoint (it is not a real argument and must never be mistaken for the script). The D5 legacy free-text flag check still operates on the original command, so its defense is unchanged.
- **Misleading rejection log**: the gate's generic-rejection WARN and `permission_denied` audit reason are updated to report the actual rejection cause (shell operator / first token not allow-listed / dangerous flag / path outside allowed dirs) instead of always claiming "path argument outside session workspace/TMPDIR". For a multi-command permission request, the FIRST failing command, its index, and its reason are recorded. The path-outside case keeps the existing `rejected_generic_command_out_of_workspace` audit reason; the new causes use `rejected_generic_command_shell_operator` / `rejected_generic_command_first_token_not_allowed` / `rejected_generic_command_dangerous_flag`. A generic-command rejection returns `reject_once` immediately after writing this cause-specific audit entry, so no second, contradictory `rejected_unknown` entry is emitted.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `agent-sandbox-hardening`: The "Generic-Command Workspace Confinement" requirement's shell-operator rejection rule is refined to allow an exact whole-token fd-to-fd redirection to a standard stream (`N>&[12]`), while keeping every file-referencing redirect, all non-standard source descriptors, and all other operator-based smuggling rejected. New requirement text documents the tolerated token form and the reason it cannot escape the workspace.

## Impact

- `src/acp/client.ts` — generic-command gate (`isApprovedGenericCommand`, `matchesScriptPath`, `matchesCommandPrefix`), rejection-reason logging in `requestPermission`.
- `tests/acp/permission-gate-generic.test.ts`, `tests/acp/client.test.ts` — new/updated cases.
- `docs/AGENT_PERMISSIONS.md` — Layer 3 permission gate documentation.
- No configuration surface changes; no breaking changes (early-stage project, zero users); no migration.
