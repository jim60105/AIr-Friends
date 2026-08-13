## MODIFIED Requirements

### Requirement: Generic-Command Workspace Confinement

The restricted-mode ACP permission gate SHALL approve a generic bash command (a command whose first token is on an explicit allow-list) ONLY when every path-like argument — both inputs and outputs — resolves inside the session workspace, the session TMPDIR, the agent workspace, or the session-scoped OpenCode tool-output directory, AND the command contains no code-execution / arbitrary-target argument flag (e.g. `find -exec`/`-delete`/`-fprintf`, `rg --pre`). A command referencing any path outside those boundaries (as a read source OR a write/output target), or using such a flag, SHALL be rejected. The shared, home-rooted OpenCode tool-output directory (`$HOME/.local/share/opencode/tool-output` or any other home-rooted location) SHALL NOT be within bounds.

Home-anchored argument tokens SHALL be expanded against the runtime values before the containment check: the exact forms `~`, `~/...`, `$HOME`, `$HOME/...`, `${HOME}`, `${HOME}/...` SHALL expand the `~`/`$HOME` reference to the runtime home directory, and `$XDG_DATA_HOME`, `$XDG_DATA_HOME/...`, `${XDG_DATA_HOME}`, `${XDG_DATA_HOME}/...` SHALL expand to the session's `XDG_DATA_HOME` value. Expansion SHALL be applied to the token after quote stripping and `--flag=value` splitting, including inside attached option values (e.g. `-o$HOME/...`), so an attached option carrying an expanded absolute path is subject to the same attached-absolute-path rejection as a literal one. The containment check SHALL be applied to the expanded path, so a token that expands outside an allowed directory (e.g. `~/.ssh/id_rsa`, `$HOME/.git-credentials`, `$HOME/../etc/passwd`, `-o$HOME/.ssh/x`) SHALL be rejected. Any other home-anchored token (e.g. `~otheruser/...`, `~notexpanded`) SHALL be rejected.

Attached short-option values SHALL be rejected when they are absolute or traversal-anchored: a `-`-prefixed token whose glued value starts with `/` or `..`, or contains `/../` (e.g. `-o/etc/cron.d`, `-f../sibling-user/file`, `-o../x`, `-oout/../x`), SHALL be rejected — such values resolve against the agent's cwd and escape the workspace. Bare flags (`-r`) and safe attached values (`-n5`, `-fprogram.jq`) SHALL pass.

A path argument that resolves inside the session's OpenCode data area (`{sessionWorkspace}/tmp/opencode-data`) but OUTSIDE the session's own data home SHALL be rejected even though it lexically resolves inside the session workspace: sibling/previous sessions' truncated tool outputs (and the data-area root listing that would enumerate them) are never within bounds, while the session's own data home remains readable.

The allow-list SHALL be limited to plain search/read/stat utilities whose only file access is via ordinary path arguments the lexical check can see — i.e. `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`. Tools that read or write files through their own argument DSL, an argument/response indirection file, an embedded protocol/coder, or a filter/preprocessor that executes code (e.g. ImageMagick `magick`/`convert`/`identify`/`mogrify` via `caption:@`/`label:@`/`msl:` coders, `exiftool -@` argfiles, `ffmpeg`/`ffprobe` protocols like `-f lavfi -i movie=`, `pandoc --lua-filter`, and the `unzip`/`zip`/`7zz` archive tools via attached `-o` output or archive path traversal) SHALL NOT be on the allow-list, because a lexical path check cannot bound them; they are only safe under the filesystem confinement (D4) and remain default-deny at this gate until it is active. Interpreters and mutating system tools (e.g. `python`, `git`, `rm`, `mv`, `dd`, `chmod`, `mkdir`) SHALL NOT be on the allow-list and SHALL remain default-deny.

#### Scenario: In-workspace generic command approved

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `rg pattern /app/data/workspaces/discord/123/` or `head /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL approve the command because every path argument resolves inside the session workspace

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

## ADDED Requirements

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
