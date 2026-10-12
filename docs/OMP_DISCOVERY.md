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

| Surface ID                     | Name                         | Pinned Route                                                                                                                                                       | Status                              | Applied Mechanism                                                                                                                                                                           |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ambient-extension-discovery`  | Ambient extension discovery  | `main.ts` `buildSessionOptions` trusted-path branch: exact canonical module files, extension discovery disabled; `--no-extensions` + `--trusted-extension` (row 9) | `supported` (for this surface only) | Consume row 9 flags unchanged; verifies canonical module identity and that no uncontracted extension root was presented.                                                                    |
| `native-custom-tool-discovery` | Native custom-tool discovery | `sdk.ts` `discoverCustomToolPaths`/`loadCustomTools`, independent of extension flags; `custom-tools/loader.ts` `loadTool` imports before factory/name inspection   | `no-supported-mechanism`            | Excludes configured/workspace custom-tool roots before import and emits an unconditional blocker. `withHostGuard` and preloaded paths are never treated as import boundaries.               |
| `plugin-entry-points`          | Plugin entry points          | `plugins/loader.ts` `getEnabledPlugins`, includes project roots and linked dependencies                                                                            | `no-supported-mechanism`            | Enumerates plugin roots as excluded before import and emits an unconditional blocker. `marketplace.autoUpdate: off` is posture, not exclusion.                                              |
| `configured-module-roots`      | Configured module roots      | `PI_CONFIG_FILES` / `OMP_PROFILE` / `PI_PROFILE` selectors that can add module/config layers                                                                       | `candidate-to-verify`               | Deployment env posture: verifies forbidden configuration variables (`PI_CONFIG_FILES`, `OMP_PROFILE`, `PI_PROFILE`, `XDG_CONFIG_HOME`) are absent from observed process env.                |
| `workspace-owned-dependencies` | Workspace-owned dependencies | Linked/installed package resolution reachable from a project cwd                                                                                                   | `candidate-to-verify`               | Verifies launch working directory matches neutral deployment launch cwd (`ompLaunchCwd`) where `.omp/` is empty. Workspace-derived dependency roots are excluded.                           |
| `symlinked-linked-roots`       | Symlinked/linked roots       | Any discovery candidate reaching the owned root or escaping it via a link                                                                                          | `candidate-to-verify`               | Reuses row 2 filesystem-root canonical identity: rejects links escaping canonical owned roots with `symlink_escape` or `trusted_identity_mismatch`.                                         |
| `load-refresh-rediscovery`     | Load/refresh rediscovery     | `--trusted-extension` trusted-module loading happens before session construction on new; recovery/registry transitions re-discover native state                    | `candidate-to-verify`               | Bootstrap runs at module load and produces a frozen decision. Session lifecycle events (`session/new`, `session/load`) verify the current session resource generation against the decision. |

---

## Trusted-Extension Module Bootstrap Sequence

The extension module — the generated native-loadable bundle cut from canonical source `OMP_TRUSTED_EXTENSION_PATH` (`src/acp/omp/extension/index.ts`); image face `/opt/air/omp/extension/index.js`, development face `build/omp-extension/index.js`, per `docs/OMP_PACKAGING.md` §4–§5 — loads synchronously at agent startup:

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

- Critical skill IDs resolve strictly to the pinned instruction layout (`review/SKILL.md`, `destructive/SKILL.md`, `lsp/SKILL.md`, `readiness/SKILL.md`) inside the read-only deployment-owned skills root (`/opt/air/skills`), declared by the pinned owned-settings `skills` block (`skills.enabled: true`, `skills.customDirectories: [/opt/air/skills]`, all seven foreign-source toggles false — row 28 `pin-omp-owned-skill-roots`, docs/OMP_SETTINGS.md §7). **The pinned layout is currently UNPOPULATED**: the repository `skills/` tree installed verbatim at `/opt/air/skills` ships none of those four instruction files, so an on-image registration observably mints ZERO critical references (each identifier denies fail-closed on absence — the safe empty posture, never a fallback); populating the layout is an operator mount of the root-owned tree, and until it happens no critical-skill authority exists in production.
- Workspace candidates with identical names are excluded from critical-name resolution before any collision or precedence decision; name-only authority is denied and an unregistered selector never authorizes anything.
- Ordinary (non-critical) skills remain enabled and discoverable globally; the `skills.*` pin declares the owned root only and expands no critical-id set.
- Re-evaluated across `new`, `load`, and `refresh` events; candidates carrying a stale generation ID or foreign session ID are rejected, and a replacement of an accepted instruction identity denies that identifier alone (never re-mints trust from fresh metadata).

---

## Honesty Gates & Operative Boundaries

Two honesty gates remain open as named data exports in `src/acp/omp/discovery-guard.ts`:

### 1. `preImportExclusionGate`

- **Status**: `unresolved`
- **Pinned Verdict**: `"extension flags alone incompatible and the supported full mechanism unresolved"`
- **Disposition (row 27, DECIDED 2026-10-09)**: `DECISION_1_DEPLOYMENT_ADMISSION` — the selected control is _deployment admission_: the deployment keeps executable custom tools and plugin entry points out of the workspace, loads the owned extension only from the image path (`--no-extensions` keeps ambient discovery off), the pre-native STARTUP CHECK rejects a workspace executable module, and fail-closed session rejection is the fallback. The native unresolved/verbatim verdict stands UNCHANGED alongside the disposition (`runtimeUnverified: UNVERIFIED`); no repository mock clears the native gate, and the disposition claims no supported native mechanism.

### 2. `criticalSkillSelectionGate`

- **Status**: `unresolved`
- **Pinned Verdict**: `"name-only trust incompatible and canonical selection unresolved"`
- **Disposition (row 27, DECIDED 2026-10-09)**: `DECISION_7_SKILL_OWNERSHIP_ADMISSION` — owned-settings skill-root ownership selection; row 28 (`pin-omp-owned-skill-roots`) LANDED the settings skill-root selection checks (pinned `skills` block in both overlays, `ownedSkillRoots` on the source plan, the `observeOwnedSkills` registration-time producer, and identity/replacement-attested client admission), the existing canonical critical-skill checks are retained here, and this record remains the decided disposition only.

Neither gate carries a pending "another user decision required" blocker anymore (row 27): decisions 1 and 7 pinned their dispositions on 2026-10-09.

### Decision-1 Deployment Admission (row 27)

`computeDiscoveryDecision` accepts an `executableObservation` — the accepted pre-native observation for one exact workspace + resource generation (`src/acp/omp/executable-sources.ts`). ONLY a matching `absent-clean` observation at the decision's own generation admits the two native executable-discovery surfaces under the deployment control instead of the unconditional unsupported-native-status rejection. An absent, stale, or foreign observation never reuses a previous clean result: both `no-supported-mechanism` blockers stay verbatim (fail-closed fallback), the pinned surfaces table never changes, and excluded-root records are still emitted for every configured root. The extension's restricted-identity startup check supplies this observation at production load; development/unidentified loads take no observation and fail closed exactly as before.

### Operative Security Boundary

While these gates stand open, discovery-side exclusion is defense in depth. Restricted execution-time default-deny (row 14) and ACP filesystem authorization (rows 2–4) constitute the operative security boundaries.

Automated unit and mock tests validate **decision logic only** (which roots and names are excluded, fail-closed error payload). Passing tests do not constitute evidence that the native upstream binary enforces pre-import exclusion.

---

## Downstream Handoff

- **Row 13 (cancelled readiness gate)**: no readiness channel or acknowledgement exists (cancelled by user decision); the load-time decision and resource generation are consumed read-only by the row-16 enforcement wiring.
- **Row 14 (`enforce-omp-restricted-tool-policy`)**: Provides execution-time tool inventory default-deny.
- **Row 20 (`package-pinned-omp-runtime`) + `package-bun-compatible-omp-extension` (C3)**: Packages the GENERATED single-artifact bundle of the module tree authored here at `/opt/air/omp/extension/index.js`, digest-covered by `PACKAGE-MANIFEST.sha256`.

---

## User-Owned Runtime Verification Checklist

The following items cannot be certified by mock or unit tests and remain unverified until observed in a real runtime environment:

- [ ] **Real Trusted-Module Load**: Pinned OMP executable loads the generated trusted-extension bundle (`/opt/air/omp/extension/index.js`, cut from `OMP_TRUSTED_EXTENSION_PATH` source) via `--trusted-extension` — with no import map and no download (`docs/OMP_PACKAGING.md` §7).
- [ ] **Hostile Code Suppression**: Hostile custom tools or plugins with executable top-level code do not run during startup.
- [ ] **Critical Skill Resolution**: Critical skills resolve strictly to canonical owned `SKILL.md` on session `new`, `load`, and `refresh` events.

---

## Related Documentation

- [OMP Compatibility Ledger (`docs/OMP_COMPATIBILITY.md`)](OMP_COMPATIBILITY.md)
- [OMP Spawn & Process Scoping (`docs/OMP_SPAWN.md`)](OMP_SPAWN.md)
- [OMP Settings & Composition (`docs/OMP_SETTINGS.md`)](OMP_SETTINGS.md)
- [Agent Permissions Specification (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section B: trusted-module load, hostile custom-tool top-level code, critical-skill resolution, cancelled readiness handshake with accepted extension-load risk).
