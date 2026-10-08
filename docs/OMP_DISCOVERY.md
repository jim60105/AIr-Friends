# OMP Executable Discovery Guard & Canonical Ownership Specification

## Overview

The `guard-omp-executable-discovery` integration protects restricted OpenCode / OMP agent sessions against unauthorized top-level executable code discovery and module imports. It establishes:

1. **Load-Time Discovery Bootstrap**: A pure pre-import exclusion decision computed at trusted-extension module load, before any dynamic tool, plugin, or configured module can import.
2. **Audited Surface Verification**: Table-driven evaluation of all 7 P0-audited executable discovery routes. Surfaces without supported mechanisms produce hard initialization blockers.
3. **Exact Owned-Module Ownership**: Only the contracted `OMP_TRUSTED_EXTENSION_PATH` within deployment-owned directories and pinned image-owned closures are admitted. Workspace copies, cache directories, symlink escapes, and name-only matches are unconditionally untrusted.
4. **Canonical Critical-Skill Ownership**: Critical skill IDs resolve strictly to canonical instruction files (`SKILL.md`) inside the read-only deployment-owned skills root. Workspace shadowing is excluded, and stale/foreign session generations reject.
5. **Honesty Gates**: Two blocking application gates remain open with verbatim pinned verdicts requiring explicit user-decision adoption before native security guarantees can be claimed.

---

## Audited Discovery Surfaces Table (§2)

| Surface ID | Name | Pinned Route | Status | Applied Mechanism |
|---|---|---|---|---|
| `ambient-extension-discovery` | Ambient extension discovery | `main.ts` `buildSessionOptions` trusted-path branch: exact canonical module files, extension discovery disabled; `--no-extensions` + `--trusted-extension` (row 9) | `supported` (for this surface only) | Consume row 9 flags unchanged; verifies canonical module identity and that no uncontracted extension root was presented. |
| `native-custom-tool-discovery` | Native custom-tool discovery | `sdk.ts` `discoverCustomToolPaths`/`loadCustomTools`, independent of extension flags; `custom-tools/loader.ts` `loadTool` imports before factory/name inspection | `no-supported-mechanism` | Excludes configured/workspace custom-tool roots before import and emits an unconditional blocker. `withHostGuard` and preloaded paths are never treated as import boundaries. |
| `plugin-entry-points` | Plugin entry points | `plugins/loader.ts` `getEnabledPlugins`, includes project roots and linked dependencies | `no-supported-mechanism` | Enumerates plugin roots as excluded before import and emits an unconditional blocker. `marketplace.autoUpdate: off` is posture, not exclusion. |
| `configured-module-roots` | Configured module roots | `PI_CONFIG_FILES` / `OMP_PROFILE` / `PI_PROFILE` selectors that can add module/config layers | `candidate-to-verify` | Deployment env posture: verifies forbidden configuration variables (`PI_CONFIG_FILES`, `OMP_PROFILE`, `PI_PROFILE`, `XDG_CONFIG_HOME`) are absent from observed process env. |
| `workspace-owned-dependencies` | Workspace-owned dependencies | Linked/installed package resolution reachable from a project cwd | `candidate-to-verify` | Verifies launch working directory matches neutral deployment launch cwd (`ompLaunchCwd`) where `.omp/` is empty. Workspace-derived dependency roots are excluded. |
| `symlinked-linked-roots` | Symlinked/linked roots | Any discovery candidate reaching the owned root or escaping it via a link | `candidate-to-verify` | Reuses row 2 filesystem-root canonical identity: rejects links escaping canonical owned roots with `symlink_escape` or `trusted_identity_mismatch`. |
| `load-refresh-rediscovery` | Load/refresh rediscovery | `--trusted-extension` trusted-module loading happens before session construction on new; recovery/registry transitions re-discover native state | `candidate-to-verify` | Bootstrap runs at module load and produces a frozen decision. Session lifecycle events (`session/new`, `session/load`) verify the current session resource generation against the decision. |

---

## Trusted-Extension Module Bootstrap Sequence

The extension module at `OMP_TRUSTED_EXTENSION_PATH` (`src/acp/omp/extension/index.ts`) loads synchronously at agent startup:

1. **Identity Resolution**: Checks process environment variables and launch working directory.
2. **Dependency-Closure Verification**: Determines the contracted extension module path and valid closure roots.
3. **Surface Evaluation**: Evaluates all 7 surfaces, records excluded candidate roots, and identifies blockers.
4. **Deep Freeze**: Produces an immutable, deeply frozen `DiscoveryDecision` record.
5. **Fail-Closed Gate**: If any blocker is present in `decision.blockers`, the module throws an immediate initialization error:
   ```
   Error: pre-import exclusion not established: <surface-id> (<status>)
   ```

No candidate modules are ever imported or evaluated during discovery inspection.

---

## Session Setup Failure Contract

When trusted-module initialization fails due to unestablished pre-import exclusion:
- The agent process fails to load the extension.
- Session creation (`session/new`) or recovery (`session/load`) rejects with an ACP request error observable through `AgentConnector.createSession()` / `raceAgainstCrash`.
- The error message is bounded, naming the failing surface and status (e.g. `pre-import exclusion not established: native-custom-tool-discovery (no-supported-mechanism)`).
- The error message contains **no credentials, secrets, or file contents**.
- The system **never falls back** to an unguarded session, an extensionless process, or OpenCode substitution.

---

## Owned-Module and Skills-Root Canonical Identity

### Module Ownership
- Contracted path: `OMP_TRUSTED_EXTENSION_PATH` (`src/acp/omp/extension/index.ts`).
- Workspace copies, home directories (`~/.omp`), and package caches (`node_modules`, `.cache`) are untrusted (`outside_roots`).
- Candidates matching critical tool/skill names outside the owned root are untrusted (`trusted_identity_mismatch`). Name-only trust is rejected.
- Symlinks leaving the owned root are untrusted (`symlink_escape`).
- Identity evaluation is mode-independent (identical for `restricted` and `native-yolo`).

### Critical-Skill Ownership
- Critical skill IDs resolve strictly to `SKILL.md` in the read-only deployment-owned skills root (`/opt/air/skills`).
- Workspace candidates with identical names are excluded from critical-name resolution.
- Ordinary (non-critical) skills remain enabled and discoverable globally; no `skills.*` configuration keys are pinned or altered.
- Re-evaluated across `new`, `load`, and `refresh` events; candidates carrying a stale generation ID or foreign session ID are rejected.

---

## Honesty Gates & Operative Boundaries

Two honesty gates remain open as named data exports in `src/acp/omp/discovery-guard.ts`:

### 1. `preImportExclusionGate`
- **Status**: `unresolved`
- **Pinned Verdict**: `"extension flags alone incompatible and the supported full mechanism unresolved"`
- **User Decision Required**: `true`

### 2. `criticalSkillSelectionGate`
- **Status**: `unresolved`
- **Pinned Verdict**: `"name-only trust incompatible and canonical selection unresolved"`
- **User Decision Required**: `true`

### Operative Security Boundary
While these gates stand open, discovery-side exclusion is defense in depth. Restricted execution-time default-deny (row 14) and ACP filesystem authorization (rows 2–4) constitute the operative security boundaries.

Automated unit and mock tests validate **decision logic only** (which roots and names are excluded, fail-closed error payload). Passing tests do not constitute evidence that the native upstream binary enforces pre-import exclusion.

---

## Downstream Handoff

- **Row 13 (`gate-omp-policy-readiness`)**: Consumes the load-time decision and resource generation to establish the authenticated readiness channel.
- **Row 14 (`enforce-omp-restricted-tool-policy`)**: Provides execution-time tool inventory default-deny.
- **Row 20 (`package-pinned-omp-runtime`)**: Packages the module tree authored here at `/opt/air/omp/extension/index.ts` with digest checksums.

---

## User-Owned Runtime Verification Checklist

The following items cannot be certified by mock or unit tests and remain unverified until observed in a real runtime environment:

- [ ] **Real Trusted-Module Load**: Pinned OMP executable loads the module tree at `OMP_TRUSTED_EXTENSION_PATH` via `--trusted-extension`.
- [ ] **Hostile Code Suppression**: Hostile custom tools or plugins with executable top-level code do not run during startup.
- [ ] **Critical Skill Resolution**: Critical skills resolve strictly to canonical owned `SKILL.md` on session `new`, `load`, and `refresh` events.

---

## Related Documentation

- [OMP Compatibility Ledger (`docs/OMP_COMPATIBILITY.md`)](OMP_COMPATIBILITY.md)
- [OMP Spawn & Process Scoping (`docs/OMP_SPAWN.md`)](OMP_SPAWN.md)
- [OMP Settings & Composition (`docs/OMP_SETTINGS.md`)](OMP_SETTINGS.md)
- [Agent Permissions Specification (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)
