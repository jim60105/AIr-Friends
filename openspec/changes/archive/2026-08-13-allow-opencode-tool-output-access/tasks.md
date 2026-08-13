## 1. Per-Session Tool-Output Isolation (env)

- [x] 1.1 Create `src/utils/opencode-paths.ts` with pure helpers: `sessionXdgDataHome(workingDir)` returning `${workingDir}/tmp/opencode-data`, and `opencodeToolOutputDir(xdgDataHome)` returning `${xdgDataHome}/opencode/tool-output`
- [x] 1.2 In `buildBaseAgentConfig` (`src/acp/agent-factory.ts`, opencode branch), set `env["XDG_DATA_HOME"] = sessionXdgDataHome(workingDir)` so the child OpenCode writes truncated tool outputs into the session TMPDIR
- [x] 1.3 Add `XDG_DATA_HOME` to `BASE_ALLOWED_ENV` in `src/acp/sandbox-manager.ts` so the env filter passes it through
- [x] 1.4 Verify the sandbox-filtered env contains `XDG_DATA_HOME` with the session-scoped value in `tests/acp/agent-connector-env-isolation.test.ts` (or the equivalent existing env-isolation test)

## 2. Generic-Command Gate Changes

- [x] 2.1 In `ChatbotClient`, compute `opencodeToolOutputDir` from `config.workingDir` via the shared helpers (do NOT read the parent process `XDG_DATA_HOME`)
- [x] 2.2 In `requestPermission` (`src/acp/client.ts:681-684`), append the tool-output dir to `allowedDirs` ONLY when it resolves inside the session workspace or TMPDIR (fail closed otherwise), and only when not already contained by an existing allowed dir — dedupe direction: `isWithinDir(candidate, existingDir)`
- [x] 2.3 Extend `genericArgWithinWorkspace` (`src/acp/client.ts:349`) with `home` and `xdgDataHome` parameters: after quote stripping and `--flag=value` splitting, expand leading `~`/`~/` and the substrings `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}` anywhere in the token, then run the existing URI-scheme / attached-absolute-option / `resolve()`+`isWithinDir` checks; any remaining home-anchored token in an unrecognized form (e.g. `~otheruser/...`) SHALL be rejected
- [x] 2.4 Thread `home`/`xdgDataHome` through `isApprovedGenericCommand` (`src/acp/client.ts:382`) as optional parameters defaulting to env-derived values, and pass them to `genericArgWithinWorkspace`

## 3. Tests

- [x] 3.1 In `tests/acp/permission-gate-generic.test.ts`, add a regression case: the observed command shape `jq -r '...' /app/data/workspaces/discord/123/tmp/opencode-data/opencode/tool-output/tool_x` is approved when the session tool-output dir is in `allowedDirs`
- [x] 3.2 Add cases: `$XDG_DATA_HOME/opencode/tool-output/tool_x` and `${XDG_DATA_HOME}/...` forms are approved when expanded inside `allowedDirs`
- [x] 3.3 Add rejection cases: shared home-rooted tool-output paths (`cat ~/.local/share/opencode/tool-output/tool_x`, `cat $HOME/.local/share/opencode/tool-output/tool_x`) remain rejected; sensitive home paths (`cat ~/.ssh/id_rsa`, `cat $HOME/.git-credentials`, `cat $HOME/../etc/passwd`, `cat ~/../../etc/passwd`, `cat '${HOME}/.ssh/known_hosts'`, `cat -o$HOME/.ssh/x`, `cat --file=$HOME/.git-credentials`) remain rejected; unexpandable forms (`cat ~otheruser/notes.md`) rejected
- [x] 3.4 Verify pre-existing F12 D2 tests still pass (`cat ~/.ssh/id_rsa` and `cat $HOME/.git-credentials` at lines 110-111 must still return `false`; `find . -exec`, URI-scheme, shell-operator, and traversal cases unchanged)
- [x] 3.5 Add unit tests for the `src/utils/opencode-paths.ts` helpers (path shapes for XDG and tool-output dirs)
- [x] 3.6 Add a `requestPermission`-level test in `tests/acp/client.test.ts`: with a session whose workingDir is `/app/data/workspaces/discord/123`, the tool-output dir is part of the generic-command boundary; with a workingDir that would place the tool-output dir outside the workspace (defensive case), the dir is NOT added and the jq command is rejected

## 4. Documentation and Verification

- [x] 4.1 Update `docs/AGENT_PERMISSIONS.md` (Layer 3 — ACP Client Permission Gate): document the session-scoped `XDG_DATA_HOME`, the session-local tool-output boundary (with the fail-closed rule), and the home-anchored token expansion rules
- [x] 4.2 Update `AGENTS.md` sandbox/permission notes: mention `XDG_DATA_HOME` in the env allowlist and the per-session tool-output isolation in the F12 description
- [x] 4.3 Run `deno fmt src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts`, and the full test suite (`deno task test`); confirm no regressions and coverage stays above 75%
- [x] 4.4 Remove the shared home-rooted OpenCode data dir from `DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS` (`src/acp/filesystem-confinement.ts`) — with session-scoped `XDG_DATA_HOME` the agent never writes there, and binding it would expose stale home-rooted state (e.g. a pre-built `auth.json`) to a confined agent; add a confinement test asserting the dir is not bound

## 5. Rubber-Duck Review Follow-up (per-session isolation + attached traversal)

- [x] 5.1 Make `XDG_DATA_HOME` per-session: `sessionXdgDataHome(workingDir, sessionId?)` (+ `opencodeDataRoot`), agent-factory passes the session id, `ClientConfig` gains `sessionId`, and the orchestrator threads `shellSessionId` into the ClientConfig of every skill-backed session type
- [x] 5.2 Cross-session exclusion: `genericArgWithinWorkspace` rejects any resolved path inside the data area root but outside the session's own data home (sibling/previous sessions' dirs and the enumerating root listing are never readable); no-session-id internal sessions keep the root as their own home (exclusion inert)
- [x] 5.3 Attached short-option traversal: reject `-`-prefixed tokens whose glued value is absolute (`-o/etc/x`), traversal-anchored (`-f../sibling/file`, `-o../x`), or contains `/../` (`-oout/../x`); bare flags (`-r`) and safe attached values (`-n5`, `-fprogram.jq`) still pass
- [x] 5.4 Tests: sibling/previous-session dir rejection + own-dir approval + root-listing rejection (gate-level and requestPermission-level), attached-traversal rejections, `sessionXdgDataHome` session-id variants, agent-factory session-id env assertion
- [x] 5.5 Update the delta spec (per-session value semantics, sibling-session scenario, attached-traversal scenario) and design.md (D1 revision, D6, D7, risk note)
