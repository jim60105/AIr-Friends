# OMP Spawn-Mode-Scoped Agent Integration

This document defines the launch argument assembly, mode resolution, process state partitioning, and sandbox pass-through contracts for Oh-My-Pi (OMP) agents within AIr-Friends.

Pinned to official OMP `v18.6.1` / commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

---

## 1. Spawn-Time Mode Resolution

In AIr-Friends, OMP permission modes are resolved strictly at spawn time via the effective `yolo` permission flag:

- `yolo === false` maps to mode `restricted`.
- `yolo === true` maps to mode `native-yolo`.

Unlike OpenCode (which uses ACP `setSessionMode()` to toggle into `"yolo"` mode on an existing process), OMP never supports mixed-mode process reuse. Consequently:

- `getSessionModeOverride("omp", false)` returns `null`.
- `getSessionModeOverride("omp", true)` returns `null`.
- OpenCode's session mode switching behavior (`getSessionModeOverride("opencode", true) === "yolo"`) remains unchanged.

---

## 2. Launch Argument Assembly

Arguments are deterministically assembled from the owned-settings composition provided by `ompSettingsForMode(mode)` (`src/acp/omp-settings.ts`):

### Restricted Launch

- Subcommand: `acp`
- Base flags: `--no-extensions --no-lsp` (LSP disabled in every mode, decision 5 / row 17)
- Overlay configuration: `--config` flags for each path in `orderedOverlayPaths` (mode document `restricted.yml` last among overlays).
- Trusted extension: `--trusted-extension src/acp/omp/extension/index.ts` (contracted dev path; packaged under `/opt/air/omp/extension/index.ts` by row 20).
- System prompt override: `--system-prompt /app/prompts/system_prompt_override.md`.
- **Invariant**: No `--yolo` or auto-approval CLI flags appear in restricted mode. Non-YOLO approval is pinned in `restricted.yml` (`tools.approvalMode: write`).

### Native-YOLO Launch

- Subcommand: `acp`
- Base flags: `--no-extensions --no-lsp` (LSP disabled in every mode, decision 5 / row 17)
- Overlay configuration: `--config` flags for each path in `orderedOverlayPaths` (`native-yolo.yml` with `tools.approvalMode: yolo`).
- Disjointness check: Assembly asserts at runtime that no restricted overlay appears in a native-yolo launch.

---

## 3. Mode-Distinct Process State & Isolation

To ensure complete isolation between permission modes:

1. `PI_CODING_AGENT_DIR` is set to `{baseRoot}/omp-agent/{mode}`, preventing restricted and native-yolo processes from sharing mutable internal state.
2. `TMPDIR` is partitioned to `{baseRoot}/omp-agent/{mode}/tmp`.
3. Working directory (`cwd`) is set to `{baseRoot}/omp-agent/{mode}/cwd`, a deployment-controlled neutral directory with an empty `.omp/` layer. This completely prevents hostile project configuration inheritance from untrusted workspaces.
4. `XDG_DATA_HOME` is scoped under `{baseRoot}/omp-agent/{mode}/xdg-data`.
5. Canonical payload staging remains `{workspace}/tmp/{sessionId}`, independent of OMP internal state partitioning.
6. Row 26 (`isolate-omp-settings-discovery`): `HOME` is EXPLICITLY assigned to the deployment-owned `{baseRoot}/omp-agent/{mode}/home` (never inherited, never unset — the native homedir fallback must not reach the daemon home). Every settings-discovery selector (`HOME`, all XDG selectors, `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, `PI_CODING_AGENT_DIR`) and every foreign provider config selector is mandatorily stripped from the OMP child regardless of `filterEnv`/`allowedEnvVars`; only the exact plan values are re-assigned afterwards (`sanitizeOmpDiscoveryEnv` then `finalizeOmpSpawnEnvironment` in `src/acp/agent-factory.ts`). The typed source plan rides `AgentConfig.settingsSourcePlan`.

### Settings-source lifecycle order (row 26)

The metadata-only settings-source preflight (`src/acp/omp/settings-sources.ts`) runs strictly BEFORE every native protected request, on both modes and both deployment routes: (1) before the subprocess spawn in `connect()`; (2) before native `session/new` in `createSession()`, against the ACTUAL session cwd; (3) before teardown/respawn/`session/load` in `reconnectAndResumeSession()`, against the recovery cwd, so a rejection has zero side effects. The first check is never after a native `newSession`. A rejection (`SettingsSourceRejectionError`) performs no spawn, no session request, and no mutation of user files; the pool/connector surfaces it fail-closed. See `docs/OMP_SETTINGS.md` section 6.

---

## 4. Inherited Application Gates

Unit and mock tests in AIr-Friends verify configuration assembly and argument construction decisions only. Full runtime execution remains gated by:

1. P0 compatibility contracts (`docs/OMP_COMPATIBILITY.md`).
2. Row 8 authoritative record-reset application gate (`docs/OMP_SETTINGS.md`) — the pinned `unresolved` merge verdict stands verbatim. Decision 3's application no longer waits on it or on a separate user decision: it is DECIDED via settings-discovery-path control (row 26, `docs/OMP_SETTINGS.md` sections 2 and 6), with restricted execution-time default-deny as the second boundary.
3. Downstream packaging and binary installation (row 20).
