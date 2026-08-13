## Context

The restricted-mode ACP permission gate (`ChatbotClient.requestPermission` in `src/acp/client.ts`) is the authoritative decision point for filesystem-touching bash commands. OpenCode routes `jq *`, `cat *`, `rg *`, etc. to `"ask"` (see `agent-config/opencode.json`), so every such command arrives at the gate, which approves it only when (a) the first token is on `GENERIC_COMMAND_ALLOWLIST` and (b) every path-like argument resolves inside the `allowedDirs` boundaries via `isApprovedGenericCommand` / `genericArgWithinWorkspace`.

Today `allowedDirs` is assembled as `[session workingDir]` plus the agent workspace when present (`src/acp/client.ts:681-684`). OpenCode writes truncated tool outputs (e.g. oversized `webfetch` results) to `{xdgData}/opencode/tool-output/` — by default `$HOME/.local/share/opencode/tool-output/` — which is outside both boundaries, so self-research agents cannot read the research material OpenCode itself told them to process.

Two verified upstream constraints shape the design:

- The directory location is **hard-coded in OpenCode** (`packages/opencode/src/tool/truncation-dir.ts`: `path.join(Global.Path.data, "tool-output")`), with `Path.data` computed by xdg-basedir semantics (`$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`). It is NOT configurable through OpenCode's config file; the only knobs are env vars (`XDG_DATA_HOME`, `HOME`), and `XDG_DATA_HOME` is honored at process start.
- The shared home-rooted data directory is **cross-session and cross-user shared scratch**: any session's oversized tool output — including per-user private memory content read from its own workspace — persists there for 7 days. Granting the gate access to it would leak user A's private data into user B's session.

## Goals / Non-Goals

**Goals:**

- Self-research (and any restricted-mode) agents can read OpenCode's truncated tool-output files with allow-listed readers (`jq`, `cat`, `head`, `rg`, ...).
- No cross-session or cross-user leakage: truncated tool outputs are written into the session's own directory, inside the session workspace.
- The tool-output directory and the gate boundary are derived deterministically from the session workspace — no parent-env ambiguity, no hard-coded absolute path.
- Home-anchored command tokens (`~`, `$HOME...`, `${HOME}...`, `$XDG_DATA_HOME...`) are expanded and containment-checked, preserving the security property: only paths that resolve inside an allowed directory pass.

**Non-Goals:**

- Changing OpenCode's truncation behavior or thresholds (`tool_output.max_lines` / `max_bytes`) — not needed for the fix.
- Granting any access to the shared home-rooted `$HOME/.local/share/opencode/` data directory (auth store, logs, storage) — the isolation removes the need and the permission gate refuses it.
- Allowing writes beyond what the generic gate already permits for allow-listed writers (`pdftoppm`, `pdfimages`). The write side is bounded to the allowed directories as today.
- Touching the `readTextFile`/`writeTextFile` ACP handlers — bash-mediated reads are the observed failure path; tool-output files carry no extension, so the ACP fs read allowlist (`.jsonl`/`.md`/`.txt`) would reject them anyway.
- Reconfiguring opencode's auth model (auth.json relocation is an accepted side effect; all providers are env-key configured).

## Decisions

### D1: Per-session `XDG_DATA_HOME` isolation for the agent subprocess

`buildBaseAgentConfig` (`src/acp/agent-factory.ts`) sets `env["XDG_DATA_HOME"] = sessionXdgDataHome(workingDir, sessionId)` for the OpenCode subprocess (workingDir is already used to force `TMPDIR`), and `BASE_ALLOWED_ENV` in `src/acp/sandbox-manager.ts` gains `XDG_DATA_HOME` so the env filter passes it through. The value is `{workspace}/tmp/opencode-data/{sessionId}` for skill-backed sessions (session id from the Skill API registry, threaded into `ClientConfig.sessionId`), and `{workspace}/tmp/opencode-data` for internal system sessions (self-research / maintenance, which run in dedicated workspaces). OpenCode then writes truncated tool outputs to `{xdgDataHome}/opencode/tool-output/` — inside the session workspace and TMPDIR.

**Rationale**: This is the only way to keep truncated outputs readable while making them session-owned: the alternative — granting the shared home-rooted directory — leaks per-user private data across sessions (verified: restricted sessions can `cat` their own workspace memory files, whose oversized output OpenCode truncates into the shared dir, where it persists 7 days). The session id in the path additionally prevents CONCURRENT sessions of the same user from sharing the data dir — a YOLO session's truncated output (which may contain privileged data the YOLO agent read outside the workspace) must never become readable from a restricted session of the same user. Alternatives considered:
- *Grant the shared home-rooted tool-output dir in the gate* — rejected: cross-session data leak (see Context).
- *Keep the shared dir and gate access per session type* — rejected: the leak is between different users' sessions reading shared scratch; session-type gating does not fix it.
- *Relocate only `tool-output` via a wrapper/symlink* — rejected: fragile, racy, and fights OpenCode internals.
- *Workspace-level dir without a session id* — rejected after review: same-user concurrent sessions would share truncated outputs, so the boundary would not be per-session.

Side effects accepted and verified against the OpenCode source (dev branch + the shipped binary's strings):

- `XDG_DATA_HOME` ONLY relocates `Path.data` (`log/`, `tool-output/`, `auth.json`, `mcp-auth.json`, `storage/`, `plans/`, `repos/`, `worktree/`, `snapshot/`). Everything the agent's core behavior depends on is untouched: **config** (`Path.config` = `$XDG_CONFIG_HOME/opencode`, i.e. `~/.config/opencode/opencode.json`), **skills discovery** (`~/.agents/skills` and `~/.claude/skills` via `global.home`, config-dir skills, `skills.paths`, and the `skills.urls` pull cache under `Path.cache`), **state/locks** (`Path.state`), **cache/bin** (`Path.cache`), and `os.homedir()`. `Path.tmp` is `os.tmpdir()` which is already session-scoped via `TMPDIR`.
- `auth.json` (and `mcp-auth.json`) move per-session. All providers are env-key configured (`OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `OPENCODE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`); the auth file is read as `{}` when absent, so no file-based auth is used and none breaks. **Deployment impact**: OpenCode no longer reads `~/.local/share/opencode` at all, so the helm `openCodeAuth` PVC and the compose.yml auth.json bind (both for OAuth token persistence) were removed as obsolete — provider keys stay env-based.
- `storage/` (session/message persistence) and `plans/` move per-session; ACP sessions are ephemeral and `loadSession` is unsupported, so nothing depends on cross-session persistence.
- `repos/` (the repository-reference cache) and `worktree/`/`snapshot/` move per-session: a `repo:` reference would re-clone per session — a performance cost, not a correctness break; the worktree feature is not used in the ACP flow.
- bwrap confinement (`DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS`) drops the now-unused shared `~/.local/share/opencode` bind: the agent's data dir lives inside the session workspace under `XDG_DATA_HOME`, so binding the shared dir would only expose stale home-rooted state to the confined process.
- The workspace TMPDIR (including the data area) is already removed by `cleanupWorkspaceTmp()` when no active sessions remain for the workspace, bounding disk accumulation.

### D2: Single source of truth for the directory — a shared path helper

New module `src/utils/opencode-paths.ts` exports pure helpers:
- `opencodeDataRoot(workingDir)` → `${workingDir}/tmp/opencode-data`
- `sessionXdgDataHome(workingDir, sessionId?)` → `${workingDir}/tmp/opencode-data/{sessionId}` (or the root when no session id)
- `opencodeToolOutputDir(xdgDataHome)` → `${xdgDataHome}/opencode/tool-output`

`agent-factory` uses them to build the env; the permission gate uses them to build the boundary. Both derive from the session `workingDir` (and session id), so the gate's boundary is definitionally identical to the child's actual directory — the parent's `XDG_DATA_HOME` is never read, eliminating env-mismatch bugs (the rubber-duck review flagged exactly this hazard when the boundary would have been resolved from parent env).

**Rationale**: Deterministic, testable, zero ambiguity. Alternatives considered: reading `Deno.env.get("XDG_DATA_HOME")` in the gate — rejected (mismatch with the filtered child env; the child's value is ours, not the parent's).

### D3: Gate boundary — session-local rule with dedupe

In `requestPermission`, after assembling `[workingDir, agentWorkspacePath?]`, the gate computes `toolOutputDir = opencodeToolOutputDir(sessionXdgDataHome(config.workingDir, config.sessionId))` and appends it to `allowedDirs` ONLY when it resolves inside the session workspace or TMPDIR, and only when not already contained by an existing allowed dir. Containment direction for dedupe: `isWithinDir(candidate, existingDir)` — skip the candidate only when an EXISTING dir contains it. If the candidate is not session-local (defensive: e.g. a future config moves the value elsewhere), it is NOT added and the gate fails closed.

**Rationale**: In the normal case the tool-output dir already lies inside `workingDir` (so containment passes without the addition); the explicit addition is belt-and-braces that (a) makes the boundary explicit and testable at the `requestPermission` level and (b) encodes the fail-closed rule — a non-session-local tool-output dir is never granted. The dedupe direction matters: checking `isWithinDir(existingDir, candidate)` would wrongly skip when an existing dir is a SUBdirectory of the candidate.

### D4: Home-anchored token expansion with attached-option coverage

`genericArgWithinWorkspace` gains `home` and `xdgDataHome` parameters and expands, after quote-stripping and `--flag=value` splitting: leading `~` and `~/` against `home`; and the substrings `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}` anywhere in the token against the runtime values. The expanded token then runs the checks — URI-scheme rejection, attached-option rejection, `resolve()` + `isWithinDir` containment. Any remaining home-anchored token in an unrecognized form (e.g. `~otheruser/...`) is rejected. `isApprovedGenericCommand` threads `home`/`xdgDataHome`/`dataRoot` through (optional params defaulting to env-derived values).

**Rationale**: The blanket `~`/`$HOME` rejection was a workaround for "cannot prove containment"; expansion + containment is strictly more precise and keeps everything under `$HOME` denied (`$HOME` itself is never an allowed dir — only the session-scoped subdirectories are). Expanding env references ANYWHERE in the token (not just at the start) closes the attached-option hole found in review: today `-o$HOME/.ssh/x` slips through as a "relative in-workspace" token because the `-o` prefix hides the reference; after expansion it becomes `-o/home/deno/.ssh/x`, which the attached-absolute-path rule rejects. Quoted forms (`'$HOME/x'`) are covered by quote-stripping before expansion.

### D5: Scope — every restricted-mode session, no per-session gate flag

Because the tool-output directory is now session-owned and inside the session's own workspace, there is no cross-session exposure and no reason to restrict the boundary to self-research sessions. All restricted sessions get the same containment; YOLO sessions are unaffected (already fully permissive).

### D6: Cross-session exclusion inside the OpenCode data area

`genericArgWithinWorkspace` rejects any resolved path that lies inside the session's OpenCode data area root (`opencodeDataRoot(workingDir)`) but OUTSIDE the session's own data home (`sessionXdgDataHome(workingDir, sessionId)`). This is checked AFTER the normal containment check, because such paths lexically resolve inside the workspace. When a session has no id (internal system sessions), the own data home IS the root and the exclusion is inert (those sessions run in dedicated workspaces anyway).

**Rationale**: Session id in the path alone does not stop a concurrent session from reading a sibling dir (workspace containment would approve it); the exclusion makes the per-session property real — including blocking the data-area root listing that would enumerate other sessions' dirs. The edit/write path is deliberately NOT excluded: write tampering with a concurrent session's data dir is a non-confidentiality integrity risk in an already-shared TMPDIR, and the ACP `readTextFile` path rejects extension-less tool-output files regardless.

### D7: Attached short-option traversal rejection

A `-`-prefixed token (after `--flag=value` splitting and quote stripping) is rejected when its glued value is absolute or traversal-anchored: the token matches `-{1,2}[a-zA-Z][a-zA-Z0-9-]*/` (absolute, e.g. `-o/etc/x`), `-{1,2}[a-zA-Z][a-zA-Z0-9-]*\.\.` (traversal-anchored, e.g. `-f../sibling/file`, `-o../x`), or contains `/../` (e.g. `-oout/../x`). Bare flags (`-r`) and safe attached values (`-n5`, `-fprogram.jq`) pass.

**Rationale**: Review found that an attached short-option with a traversal value (`jq -f../<sibling>/program.jq`) resolved as a harmless in-workspace string and slipped past the previous check — the value would be interpreted by the tool relative to the cwd, escaping the workspace. The pattern-based check is intentionally conservative (a workspace file literally named `out..x` would be denied) because the decision only ever DENIES.

## Risks / Trade-offs

- **OpenCode per-session data dir side effects** (`auth.json`, storage, logs now live under `{workspace}/tmp/opencode-data/...`). [Risk] → Mitigation: current deployment uses env-key auth only (no file auth), ACP sessions are ephemeral, and `loadSession` is unsupported; the change is additive and observable in staging before rollout. If a future feature needs file-based auth, the helper centralizes the location to revisit.
- **Lexical containment does not follow symlinks (TOCTOU)**. [Risk] → Mitigation: restricted-mode agents cannot create symlinks (`ln`/`mkdir`/`touch` are not on the allow-list; edit/write tools are extension- and boundary-restricted), so a symlink attack requires a vector we already deny; YOLO mode is trusted by definition. Documented as a known boundary limitation; filesystem confinement (D4, opt-in) remains the defense-in-depth for this class.
- **Models may still type `~/.local/share/opencode/tool-output/...` from learned behavior**. [Risk] → Mitigation: that path no longer exists (fail-closed at runtime); OpenCode's truncation hint prints the absolute session path, and the `$XDG_DATA_HOME` form is now expandable by the gate.
- **`XDG_DATA_HOME` passthrough broadens the agent's env slightly**. [Risk] → Mitigation: the value is a session-scoped absolute path under TMPDIR, filtered by the sandbox allowlist like every other variable; it grants no new OS capability.
- **Env-var expansion inside tokens could surprise** (e.g. a literal `$HOME` filename in the workspace). [Risk] → Mitigation: expansion only ever converts a token into a path that must still pass containment; a token containing a literal `$HOME` substring inside the workspace resolves there and remains harmless.
- **Edit/write tools can still tamper with a concurrent session's data dir** (TMPDIR writes are extension-exempt). [Risk] → Accepted: this is a non-confidentiality integrity risk inside an already-shared per-user TMPDIR; reads of sibling session data are blocked by D6, and ACP `readTextFile` rejects extension-less tool-output files regardless.

## Migration Plan

No data or config migration. The change is additive: existing approvals are unchanged; the shared home-rooted directory was never approved and stays denied. Rollback is a revert of `agent-factory.ts` / `sandbox-manager.ts` / `client.ts` / tests; behavior returns to today's state immediately (tool-output reads denied again).

## Open Questions

- None blocking. Verification that the previously-observed failure class now succeeds is covered as regression scenarios in the delta spec and an explicit task.
