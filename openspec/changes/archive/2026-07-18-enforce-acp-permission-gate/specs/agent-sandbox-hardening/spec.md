## ADDED Requirements

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

The restricted-mode ACP permission gate SHALL approve a generic bash command (a command whose first token is on an explicit allow-list) ONLY when every path-like argument — both inputs and outputs — resolves inside the session workspace or the session TMPDIR, AND the command contains no code-execution / arbitrary-target argument flag (e.g. `find -exec`/`-delete`/`-fprintf`, `rg --pre`). A command referencing any path outside those boundaries (as a read source OR a write/output target), or using such a flag, SHALL be rejected.

The allow-list SHALL be limited to plain search/read/stat utilities whose only file access is via ordinary path arguments the lexical check can see — i.e. `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`. Tools that read or write files through their own argument DSL, an argument/response indirection file, an embedded protocol/coder, or a filter/preprocessor that executes code (e.g. ImageMagick `magick`/`convert`/`identify`/`mogrify` via `caption:@`/`label:@`/`msl:` coders, `exiftool -@` argfiles, `ffmpeg`/`ffprobe` protocols like `-f lavfi -i movie=`, `pandoc --lua-filter`, and the `unzip`/`zip`/`7zz` archive tools via attached `-o` output or archive path traversal) SHALL NOT be on the allow-list, because a lexical path check cannot bound them; they are only safe under the filesystem confinement (D4) and remain default-deny at this gate until it is active. Interpreters and mutating system tools (e.g. `python`, `git`, `rm`, `mv`, `dd`, `chmod`, `mkdir`) SHALL NOT be on the allow-list and SHALL remain default-deny.

#### Scenario: In-workspace generic command approved

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `rg pattern /app/data/workspaces/discord/123/` or `head /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL approve the command because every path argument resolves inside the session workspace

#### Scenario: Out-of-workspace read rejected

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `rg -a "" /proc/1/environ`, `head -c 2000 /proc/1/environ`, or `head /app/data/workspaces/discord/<otherUser>/memory.private.jsonl`
- **THEN** the gate SHALL reject the command with logging because a path argument resolves outside the session workspace/TMPDIR

#### Scenario: Out-of-workspace output target rejected

- **GIVEN** a restricted-mode session and an allow-listed tool that writes an output file (e.g. `pdftoppm`, `pdfimages`)
- **WHEN** the agent requests an out-of-workspace output path, e.g. `pdftoppm in.pdf /etc/cron.d/evil`
- **THEN** the gate SHALL reject the command because the output path resolves outside the session workspace/TMPDIR

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

### Requirement: Agent Filesystem Confinement

When filesystem confinement is enabled (`sandbox.filesystemConfinement`), the agent subprocess SHALL run under a filesystem confinement that prevents it from reading the daemon's process environment (`/proc/1/environ`) and other users' workspace directories, independent of the permission-layer configuration, so that a permissive or misconfigured permission map cannot re-expose those paths. Because the container runs unprivileged under a single UID (OpenShift arbitrary-UID model), the confinement SHALL be achieved by a filesystem-namespace mechanism (bubblewrap mount namespace with a fresh `/proc`) rather than by switching the subprocess to a second UID. If confinement is enabled but the mechanism is unavailable in the runtime, the system SHALL fail closed at startup with an actionable error rather than starting the agent unconfined.

Confinement is OPT-IN (default off) because the fresh-`/proc` mount it relies on cannot be established inside a doubly-nested user namespace (e.g. rootless podman) and its viability is therefore runtime-dependent and SHALL be verified against the real deployment (`scripts/probe-sandbox-caps.sh`) before enabling; the authoritative permission gate (`requestPermission` routing, generic-command confinement, URI-scheme rejection) provides the primary protection independent of this defense-in-depth layer.

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
