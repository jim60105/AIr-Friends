# OMP Executable Discovery Guard & Canonical Ownership Specification

## Overview

The `guard-omp-executable-discovery` integration protects restricted OpenCode / OMP agent sessions against unauthorized top-level executable code discovery and module imports. It establishes:

1. **Load-Time Discovery Bootstrap**: A pure pre-import exclusion decision computed at trusted-extension module load, before any dynamic tool, plugin, or configured module can import.
2. **Audited Surface Verification**: Table-driven evaluation of all 7 P0-audited executable discovery routes. Surfaces without supported mechanisms keep their pinned `no-supported-mechanism` status; the two native executable-discovery surfaces are admitted ONLY under the DECIDED decision-1 deployment control with a matching accepted pre-native observation, and the entrypoint otherwise throws on the remaining blockers.
3. **Exact Owned-Module Ownership**: Only the DECLARED generated artifact at its declared canonical root — the fixed image face or the build-owned development face — with satisfying PHYSICAL evidence is admitted. Workspace copies, cache directories, symlink escapes, name-only matches and raw source files are unconditionally untrusted.
4. **Canonical Critical-Skill Ownership**: Critical skill IDs resolve strictly to canonical instruction files (`SKILL.md`) inside the read-only deployment-owned skills root. Workspace shadowing is excluded, and stale/foreign session generations reject.
5. **Honesty Gates**: Two honesty gates keep their verbatim pinned `unresolved` verdicts beside their DECIDED (2026-10-09, rows 27/28) dispositions. Neither gate carries a pending user-decision blocker any longer, and no native security guarantee follows from either.

---

## Audited Discovery Surfaces Table (§2)

| Surface ID                     | Name                         | Pinned Route                                                                                                                                                       | Status                              | Applied Mechanism                                                                                                                                                                           |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ambient-extension-discovery`  | Ambient extension discovery  | `main.ts` `buildSessionOptions` trusted-path branch: exact canonical module files, extension discovery disabled; `--no-extensions` + `--trusted-extension` (row 9) | `supported` (for this surface only) | Consume row 9 flags unchanged; verifies canonical module identity and that no uncontracted extension root was presented.                                                                    |
| `native-custom-tool-discovery` | Native custom-tool discovery | `sdk.ts` `discoverCustomToolPaths`/`loadCustomTools`, independent of extension flags; `custom-tools/loader.ts` `loadTool` imports before factory/name inspection   | `no-supported-mechanism`            | Excludes configured/workspace custom-tool roots before import and emits a blocker UNLESS the decision carries a matching accepted `absent-clean` executable-source observation for this exact workspace and generation (DECIDED decision 1, row 27), which admits this surface under the deployment control. `withHostGuard` and preloaded paths are never treated as import boundaries. |
| `plugin-entry-points`          | Plugin entry points          | `plugins/loader.ts` `getEnabledPlugins`, includes project roots and linked dependencies                                                                            | `no-supported-mechanism`            | Enumerates plugin roots as excluded before import and emits a blocker under the same decision-1 admission rule. `marketplace.autoUpdate: off` is posture, not exclusion.                    |
| `configured-module-roots`      | Configured module roots      | `PI_CONFIG_FILES` / `OMP_PROFILE` / `PI_PROFILE` selectors that can add module/config layers                                                                       | `candidate-to-verify`               | Deployment env posture: verifies forbidden configuration variables (`PI_CONFIG_FILES`, `OMP_PROFILE`, `PI_PROFILE`, `XDG_CONFIG_HOME`) are absent from observed process env.                |
| `workspace-owned-dependencies` | Workspace-owned dependencies | Linked/installed package resolution reachable from a project cwd                                                                                                   | `candidate-to-verify`               | Verifies launch working directory matches neutral deployment launch cwd (`ompLaunchCwd`) where `.omp/` is empty. Workspace-derived dependency roots are excluded.                           |
| `symlinked-linked-roots`       | Symlinked/linked roots       | Any discovery candidate reaching the owned root or escaping it via a link                                                                                          | `candidate-to-verify`               | Reuses row 2 filesystem-root canonical identity: rejects links escaping canonical owned roots with `symlink_escape` or `trusted_identity_mismatch`.                                         |
| `load-refresh-rediscovery`     | Load/refresh rediscovery     | `--trusted-extension` trusted-module loading happens before session construction on new; recovery/registry transitions re-discover native state                    | `candidate-to-verify`               | Bootstrap runs at module load and produces a frozen decision. Session lifecycle events (`session/new`, `session/load`) verify the current session resource generation against the decision. |

---

## Trusted-Extension Module Bootstrap Sequence

The extension module — the generated native-loadable bundle cut from canonical source `OMP_TRUSTED_EXTENSION_PATH` (`src/acp/omp/extension/index.ts`); image face `/opt/air/omp/extension/index.js`, development face `build/omp-extension/index.js`, per `docs/OMP_PACKAGING.md` §4–§5 — loads synchronously at agent startup:

1. **Identity Resolution**: Checks process environment variables and launch working directory.
2. **Declared-Module Resolution**: Matches this module's own loaded file URL against the DECLARED deployment faces and reports the declared artifact it belongs to as the decision's module trust root. When the loaded URL matches no declared face, the decision claims NO module trust root rather than defaulting to the image path (the `.ts` source constant remains a build input, never a load entry).
3. **Surface Evaluation**: Evaluates all 7 surfaces, records excluded candidate roots, and identifies blockers.
4. **Deep Freeze**: Produces an immutable, deeply frozen `DiscoveryDecision` record.
5. **Fail-Closed Gate**: If any blocker is present in `decision.blockers`, the module throws an immediate initialization error:
   ```
   Error: pre-import exclusion not established: <surface-id> (<status>)
   ```

No candidate modules are ever imported or evaluated during discovery inspection.

---

## Extension-Load Failure Is Not Observable Readiness

1. **Module-level fail-closed gate.** Whenever a blocker remains in `decision.blockers`, the
   extension entrypoint throws a bounded initialization error naming the failing surface and
   status (e.g. `pre-import exclusion not established: native-custom-tool-discovery
   (no-supported-mechanism)`). The message carries **no credentials, secrets, or file contents**,
   and no candidate module is ever imported or evaluated during discovery inspection.
2. **What the pinned host does with that failure.** The pinned host catches extension
   import/factory failures and continues WITHOUT the failed extension
   (`extensibility/extensions/loader.ts`), and lifecycle-hook errors are reported by `runner.emit`,
   which only logs them — neither path fails session startup. An extension that fails to load
   therefore leaves a RUNNING session without the restricted capability set, and there is **no
   authenticated handler-readiness signal**: row 13 (`gate-omp-policy-readiness`) is cancelled, so
   no channel, handshake, acknowledgement or assertion exists anywhere.
3. **What IS fail-closed, and where.** Two different deployment-side seams exist and are not the
   same check repeated. LAUNCH ASSEMBLY (`src/acp/agent-factory.ts`) validates the owned assets —
   the selected generated extension artifact, every resolved `--config` overlay document and the
   owned skill-root declarations — before the process is created and fails the launch closed. The
   connector's PER-REQUEST preflights then recheck the settings-source plan and the workspace
   executable observation immediately before spawn, before `session/new`, and before
   recovery/`session/load` (`docs/OMP_SPAWN.md` section 3, `docs/OMP_SETTINGS.md` section 6); they
   do not repeat the assembly-time asset stat. All of these are daemon-side guarantees; they are
   NOT a claim about native handler presence.
4. **No over-claim.** This documentation asserts neither authenticated handler presence, nor a
   guaranteed `session/new`/`session/load` rejection on extension failure, nor never-extensionless
   execution. The residual risk is accepted and recorded
   (`docs/USER-RUNTIME-VERIFICATION.md` section B; decision register §1a decision 2).

---

## Owned-Module and Skills-Root Canonical Identity

### Module Ownership

- Declared artifacts (`bind-omp-owned-module-evidence`, `src/acp/omp/deployment-module.ts`): the fixed image face `/opt/air/omp/extension/index.js` (root-owned, non-agent-writable tree) and the build-owned development face `<canonical checkout>/build/omp-extension/index.js` (developer-owned by design). `OMP_TRUSTED_EXTENSION_PATH` (`src/acp/omp/extension/index.ts`) remains the canonical SOURCE origin and the packaging build input — never an alternative load entry.
- The declaration also carries the permitted dependency closure; the bundler substitutes the canonical source root into the emitted artifact and refuses to ship a bundle whose emitted edges exceed that closure.
- Physical evidence (`src/acp/omp/owned-module-evidence.ts`): the declared root and artifact are observed with complete metadata (dev/ino/size/mtime/mode/uid/nlink), a link-free ladder, `nlink === 1`, containment via the shared canonical `isWithinRoot`, and the posture requirement (image: root-owned and not group/other-writable; development: one owner, not group/other-writable). One accepted observation is ANCHORED at registration; every later observation must still match it (identity, fingerprint, accepted generation), so a replaced artifact, moved inode/fingerprint, rotated generation or posture violation denies and never silently re-anchors. A trusted developer rebuild requires a fresh launch.
- Module identity is independent of the process state namespace: per-spawn (`{workspace}/tmp/omp-agent/{mode}/cwd`) and pooled (`{dataRoot}/omp-pools/{key}/omp-agent/{mode}/cwd`) launches observe the SAME declared artifact, and neither state root gains deployment-module authority.
- The evidence is not a session identity: no session id, session role or `CanonicalTarget` stands in for it, and it grants no read/write/destructive authority.
- Honesty: physical self-evidence proves declared location and identity stability only — not content authentication, not that the official host loaded the module, and not mount/ACL-independent immutability. Ancestors above the declared root are a packaging fact.
- Workspace copies, home directories (`~/.omp`), and package caches (`node_modules`, `.cache`) are untrusted (`outside_roots`).
- Candidates matching critical tool/skill names outside the owned root are untrusted (`trusted_identity_mismatch`). Name-only trust is rejected.
- Symlinks leaving the owned root are untrusted (`symlink_escape`).
- Identity evaluation is mode-independent: permission mode is not an input of the ownership decision at all.

### Critical-Skill Ownership

- Critical skill IDs resolve strictly to the pinned instruction layout (`review/SKILL.md`, `destructive/SKILL.md`, `lsp/SKILL.md`, `readiness/SKILL.md`) inside the read-only deployment-owned skills root (`/opt/air/skills`), declared by the pinned owned-settings `skills` block (`skills.enabled: true`, `skills.customDirectories: [/opt/air/skills]`, all seven foreign-source toggles false — row 28 `pin-omp-owned-skill-roots`, docs/OMP_SETTINGS.md §7). **The pinned layout is currently UNPOPULATED**: the image stages that root from the deployment-controlled bundled catalog plus the reserved `lib` only (`scripts/stage-owned-skills.ts`, `unify-omp-skill-root-resolution` D2/D7 — never a broad copy of whatever a development machine installed under `skills/`), and that staged tree ships none of those four instruction files, so an on-image registration observably mints ZERO critical references (each identifier denies fail-closed on absence — the safe empty posture, never a fallback); populating the layout is an operator mount of the root-owned tree, and until it happens no critical-skill authority exists in production.
- Workspace candidates with identical names are excluded from critical-name resolution before any collision or precedence decision; name-only authority is denied and an unregistered selector never authorizes anything.
- Ordinary (non-critical) skills remain enabled and discoverable globally; the `skills.*` pin declares the owned root only and expands no critical-id set.
- Re-evaluated across `new`, `load`, and `refresh` events; candidates carrying a stale generation ID or foreign session ID are rejected, and a replacement of an accepted instruction identity denies that identifier alone (never re-mints trust from fresh metadata).

---

## Honesty Gates & Operative Boundaries

Two honesty gates remain open as named data exports in `src/acp/omp/discovery-guard.ts`:

### 1. `preImportExclusionGate`

- **Status**: `unresolved`
- **Pinned Verdict**: `"extension flags alone incompatible and the supported full mechanism unresolved"`
- **Disposition (row 27, DECIDED 2026-10-09)**: `DECISION_1_DEPLOYMENT_ADMISSION` — the selected control is _deployment admission_: the deployment keeps executable custom tools and plugin entry points out of the workspace, loads the owned extension only from the selected generated artifact (the image face `/opt/air/omp/extension/index.js`, or the generated development entry `build/omp-extension/index.js` when the owned tree is absent; `--no-extensions` keeps ambient discovery off), the pre-native STARTUP CHECK rejects a workspace executable module, and fail-closed session rejection is the fallback. That rejection is the DAEMON-side pre-native check (`docs/OMP_SPAWN.md` section 3): a merely failed or absent extension is not a session-level fail-closed guarantee (see the load-failure section above). The native unresolved/verbatim verdict stands UNCHANGED alongside the disposition (`runtimeUnverified: UNVERIFIED`); no repository mock clears the native gate, and the disposition claims no supported native mechanism.

### 2. `criticalSkillSelectionGate`

- **Status**: `unresolved`
- **Pinned Verdict**: `"name-only trust incompatible and canonical selection unresolved"`
- **Disposition (row 27, DECIDED 2026-10-09)**: `DECISION_7_SKILL_OWNERSHIP_ADMISSION` — owned-settings skill-root ownership selection; row 28 (`pin-omp-owned-skill-roots`) LANDED the settings skill-root selection checks (pinned `skills` block in both overlays, `ownedSkillRoots` on the source plan, the `observeOwnedSkills` registration-time producer, and identity/replacement-attested client admission), the existing canonical critical-skill checks are retained here, and this record remains the decided disposition only.

Neither gate carries a pending "another user decision required" blocker anymore (row 27): decisions 1 and 7 pinned their dispositions on 2026-10-09.

### Decision-1 Deployment Admission (row 27)

`computeDiscoveryDecision` accepts an `executableObservation` — the accepted pre-native observation for one exact workspace + resource generation (`src/acp/omp/executable-sources.ts`). ONLY a matching `absent-clean` observation at the decision's own generation admits the two native executable-discovery surfaces under the deployment control instead of the unconditional unsupported-native-status rejection. A matching observation admits ONLY those two surfaces: every other blocker still applies, and the entrypoint still throws whenever any blocker remains. An absent, stale, or foreign observation never reuses a previous clean result: both `no-supported-mechanism` blockers stay verbatim (fail-closed fallback), the pinned surfaces table never changes, and excluded-root records are still emitted for every configured root. The extension's restricted-identity startup check supplies this observation at production load; development/unidentified loads take no observation and fail closed exactly as before.

### Operative Security Boundary

While these gates keep their pinned verdicts, discovery-side exclusion is defense in depth. Restricted execution-time default-deny (row 14) and ACP filesystem authorization (rows 2–4) constitute the operative security boundaries. The ACP filesystem boundary covers the callbacks that actually execute; it does NOT confine direct native local IO, whose accepted posture is recorded in `docs/OMP_ENFORCEMENT.md` ("Accepted native local posture").

Automated unit and mock tests validate **decision logic only** (which roots and names are excluded, fail-closed error payload). Passing tests do not constitute evidence that the native upstream binary enforces pre-import exclusion.

---

## Downstream Handoff

- **Row 13 (cancelled readiness gate)**: no readiness channel or acknowledgement exists (cancelled by user decision); the load-time decision and resource generation are consumed read-only by the row-16 enforcement wiring.
- **Row 14 (`define-omp-restricted-tool-decisions` / `wire-omp-restricted-tool-enforcement`)**: Provides the pure restricted tool inventory plus its wired native `tool_call` consumer (default-deny by absence).
- **Row 20 (`package-pinned-omp-runtime`) + `package-bun-compatible-omp-extension` (C3)**: Packages the GENERATED single-artifact bundle of the module tree authored here at `/opt/air/omp/extension/index.js`, digest-covered by `PACKAGE-MANIFEST.sha256`.
- **`bind-omp-owned-module-evidence`**: Declares the image/development faces, embeds the canonical source root in the emitted bundle, and supplies the physical deployment-module evidence the owned `read`/`web_search` replacement admission consumes (`docs/OMP_ENFORCEMENT.md` §Module evidence vs session evidence).

---

## User-Owned Runtime Verification Checklist

The following items cannot be certified by mock or unit tests and remain unverified until observed in a real runtime environment:

- [ ] **Real Trusted-Module Load**: Pinned OMP executable loads the generated trusted-extension bundle (`/opt/air/omp/extension/index.js`, cut from `OMP_TRUSTED_EXTENSION_PATH` source) via `--trusted-extension` — with no import map and no download (`docs/OMP_PACKAGING.md` §7) — and its loaded artifact is observed at the DECLARED image face with satisfying physical evidence.
- [ ] **Hostile Code Suppression**: Hostile custom tools or plugins with executable top-level code do not run during startup.
- [ ] **Critical Skill Resolution**: Critical skills resolve strictly to canonical owned `SKILL.md` on session `new`, `load`, and `refresh` events.

---

## Related Documentation

- [OMP Compatibility Ledger (`docs/OMP_COMPATIBILITY.md`)](OMP_COMPATIBILITY.md)
- [OMP Spawn & Process Scoping (`docs/OMP_SPAWN.md`)](OMP_SPAWN.md)
- [OMP Settings & Composition (`docs/OMP_SETTINGS.md`)](OMP_SETTINGS.md)
- [Agent Permissions Specification (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section B: trusted-module load, hostile custom-tool top-level code, critical-skill resolution, cancelled readiness handshake with accepted extension-load risk).
