## Why

Self-research sessions fetch research material via the `webfetch` skill. When a tool output exceeds OpenCode's truncation thresholds (2000 lines / 50 KB), OpenCode writes the full output to a `tool-output/` directory and tells the agent to process the saved file with the file-reading tools. In restricted mode that directory resolves outside the session workspace, so the ACP generic-command gate rejects every attempt to read it (observed failure: `jq -r '...' /home/deno/.local/share/opencode/tool-output/tool_ff80f6564001UdX4UoUmlKdpjY` was denied). Self-research agents therefore cannot process their own fetched material, breaking the research workflow.

Investigation found that OpenCode's `tool-output` directory is hard-coded to `{xdgData}/opencode/tool-output` (xdg-basedir semantics) and is NOT configurable. Naively granting the shared, home-rooted directory would create a cross-session data leak: any session's oversized tool output — including per-user private memory content read from its own workspace — persists there for 7 days and would become readable by other users' restricted sessions.

## What Changes

- **Per-session tool-output isolation**: the agent subprocess is spawned with a session-scoped `XDG_DATA_HOME` set to a directory under the session TMPDIR (`{workspace}/tmp/opencode-data`), so OpenCode writes truncated tool outputs into that session's own directory — which already falls inside the session workspace containment boundary. The shared home-rooted `tool-output` directory is never granted.
- **Explicit session-local boundary**: the ACP generic-command gate adds the session's resolved tool-output directory to its `allowedDirs` ONLY when it resolves inside the session workspace/TMPDIR (deduplicated); otherwise the directory is not added and access fails closed. No hard-coded absolute path; the value is derived from the same per-session env given to the agent subprocess.
- **Home-anchored path handling**: the generic-command argument check expands the exact forms `~`, `~/...`, `$HOME`, `$HOME/...`, `${HOME}`, `${HOME}/...` and `$XDG_DATA_HOME`, `$XDG_DATA_HOME/...`, `${XDG_DATA_HOME}`, `${XDG_DATA_HOME}/...` against the runtime values and containment-checks the expanded path — including inside attached option values (e.g. `-o$HOME/...`), which are then treated as attached absolute paths and rejected. Unexpandable home forms (e.g. `~otheruser/...`) remain rejected. Sensitive home paths (`~/.ssh/*`, `$HOME/.git-credentials`, ...) remain rejected because they expand outside every allowed directory.
- Sandbox env allowlist (`BASE_ALLOWED_ENV`) gains `XDG_DATA_HOME`; unit and `requestPermission`-level tests added; documentation updated.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `agent-sandbox-hardening`: The "Generic-Command Workspace Confinement" boundary semantics are updated (session-local tool-output boundary, home-anchored token expansion). New requirements document per-session `XDG_DATA_HOME` isolation and the session-local tool-output boundary rule.

## Impact

- `src/utils/opencode-paths.ts` (new) — shared path helper used by agent env construction and the permission gate.
- `src/acp/agent-factory.ts` — set per-session `XDG_DATA_HOME` in the agent subprocess env.
- `src/acp/sandbox-manager.ts` — add `XDG_DATA_HOME` to `BASE_ALLOWED_ENV`.
- `src/acp/client.ts` — generic-command gate (`isApprovedGenericCommand` / `genericArgWithinWorkspace`) and `requestPermission` `allowedDirs` assembly.
- `tests/acp/permission-gate-generic.test.ts`, `tests/acp/client.test.ts` — new/existing cases.
- `docs/AGENT_PERMISSIONS.md`, `AGENTS.md` — documentation updates.
- No configuration surface changes; no breaking changes (early-stage project, zero users).
