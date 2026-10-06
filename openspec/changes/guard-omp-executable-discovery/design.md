## Context

See `proposal.md` — Why. Binding inputs: approved design §7 "Before executable discovery" plus the skill-ownership paragraphs ("Fix critical skill selection to canonical paths in the owned skills directory. Disable or exclude untrusted project discovery from critical-name resolution; name-only filtering is insufficient. Do not disable skills globally."), §13 error handling ("Missing/invalid owned configuration or failed trusted-module initialization fails the affected restricted session; do not use an unguarded fallback"), and P0's pinned verdicts at OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

P0 verbatim, consumed unchanged and never softened:

- **Pre-import exclusion** — "`--no-extensions` plus exact trusted module alone is incompatible as a complete boundary. Overall mechanism unresolved: trace provider disabling and plugin enumeration independently, initial/load rediscovery, root symlinks and dependency resolution. Do not equate `withHostGuard` or SDK `preloadedCustomToolPaths` with an executable-supported import guard." Source positions: `main.ts` `buildSessionOptions` trusted-path branch canonicalizes exact module files and disables extension discovery, `createAcpSessionFactory` loads trusted modules before session construction; `sdk.ts` custom-tool block still calls `discoverCustomToolPaths`/`loadCustomTools` independently; `custom-tools/loader.ts` `loadTool` imports before factory/name-conflict inspection; `plugins/loader.ts` `getEnabledPlugins` includes project roots and linked dependencies.
- **Critical skill ownership** — "Name-only approval is incompatible with canonical ownership. Audit supported source disabling/custom root selection, ordering, symlink containment and current-session resource resolution across new/load/refresh; preserve owned skills without globally disabling them." Source positions: `extensibility/skills.ts` `resolveCollision` can let a custom-directory skill override a provider skill; `setActiveSkills` is a process-global snapshot used by `skill://`; SDK skill input alone does not establish supported ACP selection/reload.

Predecessor consumption (no redefinition): row 2 `filesystem-roots.ts` canonical root identity and failure reasons; row 8 `ompSettingsForMode` composition/env posture and the deliberately unpinned `skills.*` keys; row 9 `OMP_TRUSTED_EXTENSION_PATH` plus owned state-root constants in `src/utils/omp-paths.ts` and the neutral deployment launch cwd.

## Goals / Non-Goals

**Goals:** One deployment-owned trusted-extension module whose load-time bootstrap produces a single frozen pre-import exclusion decision over every P0-audited surface, plus canonical critical-skill ownership data — each observable, table-driven, fail-closed, and testable through decision objects rather than source-text snapshots. An ACP-client-visible failure when the required exclusion cannot be established.

**Non-Goals:** No authenticated readiness channel or client prompt gate (row 13); no restricted tool inventory/provenance execution policy or alternate URI/device blocking (row 14); no LSP work (row 15); no checksum/notice/install packaging (row 20); no transport (rows 17–19); no factory/connector/client/pool edits; no new loader hook, internal-API patch, fork, or pin change; no claim that any mock demonstrates native enforcement. No new config/env/Helm field.

## Decisions

### 1. Bootstrap shape: one frozen decision, computed at module load, before any untrusted import

The module tree lives at the `OMP_TRUSTED_EXTENSION_PATH`-contracted development path (imported from `src/utils/omp-paths.ts`, never hardcoded). Entry composition (final installed layout is row 20's, same relative structure): module entry `index.ts`; `bootstrap.ts` (load-time sequence); `surfaces.ts` (surface enumeration + statuses); `ownership.ts` (owned-module and dependency-closure trust); `critical-skills.ts` (canonical selection table); all pure logic re-exported from the AIr-side decision module `src/acp/omp/discovery-guard.ts` so tests and the connector-side error mapping consume the same tables rather than a copy.

Load-time sequence, in this order, with no await between steps 1–4:

1. Resolve identity: canonicalize the module's own path and the owned skills root through row 2's root-identity primitives; record canonical path, dev/ino where available, and the row-9 owned-root segments.
2. Compute the dependency-closure trust set: the module file plus the pinned image-owned closure roots (row 20's installed tree). Development-tree mode admits only the source-owned module directory; HOME, workspace, and npx-cache spellings are never closure members.
3. Enumerate the §2 surfaces and produce one `DiscoveryDecision`: `{ surfaces: [{ id, mechanism, status, evidence, exclusion }], trusted: [canonical paths], blockers: [surface ids], criticalSkills, resourceGeneration }`.
4. Freeze it (`Object.freeze`, deep) — the decision cannot be re-opened by later native state.

`status` per surface is exactly one of `supported`, `candidate-to-verify`, `no-supported-mechanism`, taken from the pinned ledger rather than inferred. `exclusion` records the mechanism this change applies. **The bootstrap never imports a candidate module to inspect its metadata or factory** (design §7, P0); discovery-root enumeration is path/metadata observation only, matching row 2's metadata-only posture.

### 2. Surface table: every P0-audited discovery/import route and this change's mechanism

| Surface | Pinned source route | Status per pin | Mechanism this change applies |
| --- | --- | --- | --- |
| Ambient extension discovery | `main.ts` `buildSessionOptions` trusted-path branch: exact canonical module files, extension discovery disabled; `--no-extensions` + `--trusted-extension` (row 9) | `supported` **for this surface only** | Consume row 9's flags unchanged; the module verifies its own canonical identity and that no additional extension root was presented to it. Never generalize to custom tools/plugins. |
| Native custom-tool discovery | `sdk.ts` `discoverCustomToolPaths`/`loadCustomTools`, independent of extension flags; `custom-tools/loader.ts` `loadTool` imports before factory/name inspection | `no-supported-mechanism` (P0 unresolved) | Decision records every configured/workspace-derived custom-tool root as excluded and emits a blocker; no import for inspection; no reliance on `withHostGuard` or SDK `preloadedCustomToolPaths` (P0 bars either being called an import guard). |
| Plugin entry points | `plugins/loader.ts` `getEnabledPlugins`, includes project roots and linked dependencies | `no-supported-mechanism` (P0 unresolved) | Same treatment: plugin roots and linked-dependency entries are enumerated and marked excluded; blocker emitted; row 8's `marketplace.autoUpdate: off` is posture, not exclusion. |
| Configured module roots | `PI_CONFIG_FILES` / `OMP_PROFILE` / `PI_PROFILE` selectors that can add module/config layers | `candidate-to-verify` | Deployment env posture only: row 7 never passes, row 8 keeps them un-set by workspace content, row 9 never sets them. The decision verifies they are absent from the observed process env and records the reliance as unverified native behavior. |
| Workspace-owned dependencies | Linked/installed package resolution reachable from a project cwd | `candidate-to-verify` | Row 9's deployment-derived neutral launch cwd whose dependency and `.omp/` layers are empty by construction. The decision verifies the launch cwd is the contracted owned segment, and treats any workspace-derived cwd as an excluded root. |
| Symlinked/linked roots | Any discovery candidate reaching the owned root or escaping it via a link | `candidate-to-verify` | Row 2 canonical identity: verify owned candidates stay within the owned canonical root and mark any escaping link untrusted (`symlink_escape`/`trusted_identity_mismatch`). Detection, not a native loader guarantee. |
| Load/refresh rediscovery | `--trusted-extension` trusted-module loading happens before session construction on new; recovery/registry transitions re-discover native state | `candidate-to-verify` | The bootstrap runs per process/trusted-module load and its decision is re-consulted on `session/new` and `session/load` (a load on the same process reuses the frozen decision plus a fresh §5 generation check); no path reopens the decision. |

`withHostGuard` is never referenced as evidence anywhere in this change. A surface with `no-supported-mechanism` remains a blocker even after the mechanism is applied: the decision is *correct and fail-closed*, not *sufficient*, and §6 records the consequence.

### 3. Fail-closed session setup, observable through ACP

`bootstrap.ts` publishes the decision and fails module initialization when the required exclusion is not established: any surface with `no-supported-mechanism`, a violated identity/closure check, an escaping owned-root symlink, or an absent/contradicted env posture. Initialization failure means the trusted module is not loaded; per design §7/§13 the affected `session/new` / `session/load` fails — never a partially guarded session, never an unguarded or extensionless fallback, never OpenCode substitution.

Client-observable shape: the failure surfaces as an ACP request error on session creation, reaching `AgentConnector.createSession()` through the existing `connection.newSession(...)` rejection inside `raceAgainstCrash`, so the orchestrator sees the ordinary session-creation failure path. The error message is bounded and names the failing surface id and status (e.g. `pre-import exclusion not established: native-custom-tool-discovery (no-supported-mechanism)`), never credential, secret, or file content. Row 9's launcher-side absent-module throw remains the process-side counterpart; neither path degrades into the other.

### 4. Exact owned-module ownership, including name-only non-trust

Trusted = the module at the row-9 contracted path plus its pinned image-owned dependency closure. Everything else is untrusted, and specifically gains nothing:

- A module occupying a workspace path, a HOME path, or an npx/cache-discoverable path — including one that is byte-identical to the owned module — is not trusted and is recorded as an excluded root.
- Any candidate whose name matches a critical skill id or a critical tool name is **not** trusted by name. Name-only trust is rejected per P0; the only trust route is canonical identity within the owned root (§1 step 1–2).
- A symlink or linked package that leaves the owned canonical root is untrusted even when its destination is otherwise readable, reusing row 2's decision (`symlink_escape`, `trusted_identity_mismatch`) and its dev/ino observations. No second canonicalizer, no lexical prefix shortcut.
- YOLO spawns receive the same module identity: ownership is a deployment fact, not a mode-dependent claim, and nothing here adds a restricted-only tool denial (row 14's domain).

### 5. Critical-skill selection: canonical, ownership-pinned, ordinary skills untouched

`critical-skills.ts` produces, for each critical skill id, the `CriticalSkillContract` tuple — canonical owned `SKILL.md` path, read-only owned skills root identity, source identity, collision decision, session resource generation — validated against row 2's `trusted-skills` root and consumed read-only by row 4's trusted-read exception and row 16's payloads.

- Untrusted project/workspace discovery is excluded from **critical-name resolution**: workspace/project same-name files, custom-directory candidates, and escaping links cannot satisfy a critical id. P0's `resolveCollision` behavior is recorded as the reason name/collision ordering alone is insufficient.
- Only critical-name resolution is pinned. Skills stay globally enabled: no `skills.*` settings key is introduced or pinned (row 8 deliberately left them unpinned), no provider skill is removed, and "disable skills" is never a success case.
- Event surfaces for new/load/refresh: `session_start` plus the initial skill snapshot (new), the recovery re-discovery on `session/load`, and every registry transition replacing the active-skill snapshot (P0's `setActiveSkills` process-global snapshot consumed by `skill://`). Each resolution consults the current canonical selection and current resource generation; a stale generation or another session's snapshot fails with the contract's stale-resource reason. Row 13 owns the authenticated readiness channel and the deny-until-ready prompt gate; row 12 ships only this ownership data plus the generation counter it consumes.

### 6. Honesty gates, recorded exactly as rows 8/9 shipped the reset gate

Two named, data-level gates ship open:

- `preImportExclusionGate = { status: "unresolved", boundary: "pre-import exclusion", pinnedVerdict: "extension flags alone incompatible; supported full mechanism unresolved", affectedSurfaces: [...], residualRisk, userDecisionRequired: true }`
- `criticalSkillSelectionGate = { status: "unresolved", boundary: "critical skill ownership", pinnedVerdict: "name-only trust incompatible; canonical selection unresolved", affectedEvents: ["new","load","refresh"], residualRisk, userDecisionRequired: true }`

Consequences stated in the module, docs, and spec: full security consumption of OMP session setup is blocked until each gate has a source-backed supported mechanism adopted through an **explicit user decision** plus a P0 ledger revision — the same posture row 8's `recordResetGate` and row 9's inherited launch gate carry. While blocked, row 14's execution-time default-deny plus rows 2–4's sink authorization are the operative restricted boundaries; discovery-side exclusion is defense in depth, not a substitute.

Tests validate decision logic only: which roots/paths/names would be excluded under the contract, with a fixture importer spy asserted untouched on every rejection, plus the fail-closed error shape. No test asserts that the native binary skipped an import, and the two blockers can never be cleared by a passing mock (P0's fixture rule). Synthetic positive fixtures are labeled synthetic and kept separate from the pinned ledger.

### 7. Alternatives considered

- **Post-import tool-name/lifecycle filter as the boundary** — rejected: P0 and design §7 bar it; top-level code already ran.
- **`withHostGuard` or SDK `preloadedCustomToolPaths` as the guard** — rejected by name in P0's verdict.
- **A `skills.*` or custom exclusion settings key to pin selection** — rejected: no such registered key establishes critical-name ownership; inventing one contradicts row 8's schema-key validator and is explicitly not protection.
- **A deployment-configurable module/skills path** — rejected for the same trust-widening reason row 9 recorded for a configurable binary path; constants only, so zero config/env/Helm synchronization.
- **Name-plus-version or name-plus-hash trust** — rejected: neither establishes canonical root membership; identity is the row-2 observation set.

## Risks / Trade-offs

- **Gate misread as enforcement** → gates ship as named data, docs and specs repeat that unit/mock evidence proves decision logic only, and row 22's checklist keeps the runtime item user-owned.
- **`candidate-to-verify` overstated as support** → each such row names its reliance (row 7/8/9 env and cwd posture) and stays unverified until the user's runtime observation; none of them individually closes §2's blockers.
- **Process-global native skill state** (P0) → pooled processes share one snapshot; the generation check plus row 10/11's mode-distinct namespaces bound staleness, but cannot make native selection owned while the gate is open.
- **Row 13/14 extension of the same tree** → serial integration under one owner; this change's tables are the shared vocabulary so successors extend rather than fork them.
- **Development-tree path drift before row 20** → docs state that the contracted constant is the single source and that row 20 must install to it rather than redefine it.

## Migration Plan

Additive: a new module tree plus a pure decision module, tests, and docs. Nothing launches OMP with the module until row 9's fail-closed spawn (already requiring the path) and row 20's install exist, so the change is inert in normal deployment; rollback is reverting one commit. No data migration, no compatibility shim, no configuration change.

## Verification and Handoff

Applicable checks at implementation: repository `fmt:check`, `lint`, `check`, focused `test:unit` for `tests/acp/omp-discovery-guard.test.ts`, plus `openspec validate guard-omp-executable-discovery --strict`. No live `omp`, agent, provider, container, or bwrap run. User-owned runtime checklist (unverified until observed, tracked with row 22): real trusted-module load, hostile custom-tool/plugin top-level code not executing, and critical skill resolution on new **and** load **and** refresh. `docs/OMP_DISCOVERY.md` carries the §2 table, the §6 gate status, the consumer handoff to rows 13/14/20, and the evidence limits; `CHANGELOG.md` gets one focused entry.
