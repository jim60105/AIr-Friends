## Why

Rows 7/8 made `omp` a selectable agent type and authored the owned mode overlays, but `createAgentConfig()` still has no `omp` branch — every OMP request throws `Unknown agent type`, so no native `omp acp` process can exist. Design §5/§7/§12 require that the spawn itself carries the security posture: restricted launches pin native non-YOLO approval mode and load the restricted overlay set; native YOLO launches on its own owned settings with no restricted clamps and never via a process-wide toggle (`getSessionModeOverride("omp", true)` stays `null`); mutable state is mode-scoped under the process `TMPDIR/omp-agent` without inheriting profile/XDG selectors; and the exact trusted-extension module is referenced by immutable deployment-owned path (design D3). The factory is where rows 7's credential filter, row 8's overlays/prompt mapping, and the row 12/20 owned-module path meet, and it must be wired now so pool acquisition (row 10) has a real launch to acquire.

## What Changes

- Add an `omp` launch branch to `src/acp/agent-factory.ts` `createAgentConfig()` that consumes row 8's `ompSettingsForMode(mode)` composition and produces a native `omp acp` command for exactly two spawn modes resolved from the existing `yolo` argument: `false => restricted`, `true => native-yolo`. Command, args ordering, overlay files, and prompt mapping are taken from row 8's selectors — no second overlay convention, no re-derived approval mode.
- Restricted launch: `omp acp --no-extensions` + row 8's ordered `--config` overlays (shared-first, restricted mode document LAST, then the owned `models.yml` overlay) + the exact `--trusted-extension <owned module path>` argument (design D3) + `--system-prompt <owned SYSTEM.md>` from row 8's prompt mapping, with the restricted composition's pinned non-YOLO native approval mode consumed as-is (row 8 pins `tools.approvalMode: write`; the factory NEVER relies on an implicit native default and NEVER passes any yolo/auto-approve flag in this mode).
- Native-YOLO launch: the native-yolo overlay composition ONLY — its own owned `--config` files plus the shared `models.yml`/system-prompt mapping — with NO restricted overlay file, no restricted approval records, no LSP pin, no provider-disable array appearing in its argument set (design D6: native YOLO, no restricted tool clamps). Mode selection stays spawn-time: `getSessionModeOverride("omp", true)` remains `null`, so OpenCode's session-mode API is never used to steer an OMP process (design D7/D8), and native YOLO is never implemented as a process-wide toggle on a mixed-mode process.
- Mode-scoped process state: the factory sets `PI_CODING_AGENT_DIR` under the selected process's `TMPDIR/omp-agent` with a mode-distinct final segment (`restricted` vs `native-yolo`), and gives each OMP mode its own neutral launch `cwd` segment, so restricted and native-YOLO processes never share a mutable state root or a discoverable project cwd — independent of how pool keys are later composed (row 10). A per-spawn OMP process never reuses a state root across modes.
- Profile/XDG selector posture: the OMP branch sets no `OMP_PROFILE`/`PI_PROFILE`/`PI_CONFIG_FILES`, never exports them, and inherits none (row 7's filter keeps them out; the factory additionally must not set them); the launch cwd is a deployment-derived neutral directory whose `.omp/` layer is empty by construction, so global/project hostile layers stay non-hostile per row 8's precedence contract.
- `XDG_DATA_HOME` interaction, resolved as row 7 deferred: for OMP the factory sets `XDG_DATA_HOME` under the process's mode-scoped state area — never the shared home-rooted default — so any XDG-basedir data (tool-output-style artifacts) stays inside process-scoped state; OpenCode's per-session/per-pool `XDG_DATA_HOME` behavior (`sessionXdgDataHome`) is consumed unchanged and OpenCode's launch branch is not edited.
- Canonical Skill API payload staging stays independent of OMP process state: staging remains the `{workspace}/tmp/{sessionId}` canonical location the client gate and Skill API already resolve; partitioning OMP `TMPDIR/omp-agent` state must not move, alias, or gate payload containment on the pool-wide or mode-wide temporary root (design §5).
- Immutable trusted-module path: the factory references the owned trusted extension by one exported path constant/selector pointing at a deployment-owned, agent-non-writable root (the same tree row 8's overlays live in; installed with checksums by row 20). The factory performs no content checks: if the module is absent at implementation/launch time the OMP spawn fails with an explicit error (fail closed, no unguarded fallback) and full application stays gated by P0/rows 12/20.
- Environment and egress: the branch populates the unfiltered base env from row 7's contract (`GEMINI_API_KEY`, `OPENROUTER_API_KEY` only; no `GOOGLE_GENERATIVE_AI_API_KEY`/`OPENCODE_API_KEY`) and passes through the existing `SandboxManager` filtering, `egressProxy`/`unrestrictedEgress`/sandbox decisions, and bwrap/unshare wrapping unchanged (design §9); no yolo-only network rule is added here.
- Explicit non-goals (owned elsewhere): pool acquisition/identity across modes (`isolate-omp-process-pools-by-mode`, row 10); same-mode reconnect/`session/load` and gate-context restore (`restore-mode-owned-acp-sessions`, row 11); pre-import discovery exclusion + critical-skill provenance bootstrap (`guard-omp-executable-discovery`, row 12); authenticated policy-readiness gate (`gate-omp-policy-readiness`, row 13); restricted tool inventory/provenance policy (`enforce-omp-restricted-tool-policy`, row 14); LSP disable implementation — row 15 consumes this change's overlay pin only; absolute staging prompt text (`make-skill-staging-agent-portable`, row 16); network transport adaptation (`control-omp-url-fetch-transport`, row 17); checksum/notice packaging + version health (`package-pinned-omp-runtime`, row 20). No P0 contract redefinition; row 7's supported-type predicate and credential list and row 8's overlay lists are consumed, never forked.
- No new `config.yaml`, `.env`, or Helm field is introduced: the binary is `omp` on `PATH` (installed by row 20, mirroring `opencode`), state roots derive from the existing workspace/bot-data roots, and the trusted-module path is a source constant — so `config.example.yaml`, `.env.example`, and `helm/values.yaml` are intentionally unchanged, and this change reuses no config fields from rows 7/8.

## Capabilities

### New Capabilities

None. Reuse the existing ACP integration capability; spawn-mode-scoping requirements extend it rather than fork a parallel specification.

### Modified Capabilities

- `acp-integration`: Add spawn requirements for mode-scoped OMP launches — restricted and native-YOLO argument assemblies, spawn-time-only mode selection with `getSessionModeOverride("omp", true)` staying `null`, mode-distinct `PI_CODING_AGENT_DIR`/process TMPDIR/cwd ownership with canonical payload staging preserved, the deployment-owned trusted-extension path with fail-closed absence behavior, and the OMP `XDG_DATA_HOME` posture — while consuming row 7's Supported Agent Types / SandboxManager Environment Filtering requirements and row 8's owned-settings requirements unchanged. The OpenCode launch behavior (command, env, YOLO mode switching, per-session `XDG_DATA_HOME`) is unchanged and regression-tested.

## Impact

Eventual implementation owns: `src/acp/agent-factory.ts` (the `omp` branch of `buildBaseAgentConfig`, mode resolution, state/TMPDIR/cwd wiring, trusted-module path constant/selector, `getSessionModeOverride` unchanged-in-behavior documentation for `omp`), an OMP-path helper module `src/utils/omp-paths.ts` (mode-scoped `PI_CODING_AGENT_DIR`/state/cwd roots derived from the same pure-helper pattern as `src/utils/opencode-paths.ts`, plus the trusted-extension path selector shared with the client gate/packaging), consumer-visible tests `tests/acp/agent-factory-omp.test.ts` (launch-arg assembly both modes, mode distinctness, no-clamp-in-yolo, `PI_CODING_AGENT_DIR` scoping, trusted-module wiring, staging-location independence, OpenCode no-regression) with row-8 composition fixtures, `docs/OMP_SPAWN.md` (launch posture tables, the XDG_DATA_HOME interaction statement, staging-vs-process-state separation), focused CHANGELOG entry. Shared-file conflicts: `agent-factory.ts` with rows 7/8/20 (this change owns the `omp` launch branch; row 7/8 consume-only; row 20 adds only version health elsewhere); `sandbox-manager.ts` with rows 7/10 (consume-only here — no edits expected); `docs/OMP_SETTINGS.md` (row 8-owned, cross-linked only); `CHANGELOG.md` serial.

Application gates inherited, not removed: P0's compatibility verdicts and row 8's unresolved record-reset gate continue to gate security consumption of OMP launches; the trusted-extension module's content/readiness/packaging are rows 12/13/20, and the pinned official binary is absent from development environments (row 20). This change ships factory code plus unit/mock tests only — no mock certifies native OMP enforcement, and `omp` selection remains non-functional end-to-end until those successors land.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Predecessor consumption (row 8 composition signature, row 7 predicate/credential set), mode-resolution + `omp` branch skeleton | 1.00 |
| Restricted + native-YOLO argument assembly (overlay ordering, `--no-extensions`, `--trusted-extension`, `--system-prompt`, no-YOLO-flag invariant) | 1.25 |
| Mode-scoped state/TMPDIR/cwd wiring (`omp-paths.ts`), XDG posture, canonical staging independence | 1.25 |
| Trusted-module path constant + fail-closed absence check; egress/sandbox pass-through verification | 0.75 |
| Consumer-visible unit tests (both-mode arg assembly, distinctness, no-clamp, state scoping, staging, OpenCode no-regression) | 2.00 |
| `docs/OMP_SPAWN.md` + row-8/row-7 cross-links + CHANGELOG | 0.75 |
| Applicable focused type/unit checks and OpenSpec verification, no live agents | 0.50 |
| Contingency for review fixes | 0.50 |
| **Total hard ceiling** | **8.00** |

Core is 7.5 hours plus 0.5 contingency. Pool identity, reconnect/load, discovery exclusion, readiness, tool policy, LSP implementation, staging prompt text, transport, and packaging are owned by rows 10–20 and would exceed this change if attempted.

## Batch:

depends-on: establish-omp-compatibility-contracts
depends-on: add-omp-agent-configuration
depends-on: translate-omp-owned-settings

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts (P0) | Application gate | P0's recorded verdicts gate security consumption of every OMP launch; the trusted-module/exclusion contracts stay P0-defined — this change only points the flag at the contracted path. Do not edit P0 artifacts or claim a recorded incompatibility is resolved. |
| add-omp-agent-configuration (row 7) | Required predecessor, same-file shared | Consumes row 7's `SUPPORTED_AGENT_TYPES` predicate, `omp` credential key set, and never-pass filter unchanged; row 7's deferred `XDG_DATA_HOME`/scoped-state decision is resolved HERE (OMP sets a scoped value; OpenCode's per-session behavior untouched). Serialize `agent-factory.ts`/`sandbox-manager.ts` after row 7; no second supported-type list or credential allowlist. |
| translate-omp-owned-settings (row 8) | Required predecessor, selector consumer | Launch arguments come ONLY from `ompSettingsForMode(mode)` (ordered `--config` paths, mode document last, owned `models.yml`, SYSTEM.md prompt mapping, env posture, approval-mode pin); the factory does not re-derive the approval mode, fork overlay ordering, or copy overlay content. Row 8's unresolved record-reset gate is inherited verbatim. `agent-config/omp/*` install is row 20's. |
| isolate-omp-process-pools-by-mode (row 10) | Required successor, same-file shared | Row 10 adds mode to pool identity and acquires processes produced here; THIS change makes process state mode-distinct independently of pool-key composition so no intermediate ever shares state roots. `agent-factory.ts` signature changes (mode already available via `yolo`) must not be re-shaped by row 10; serialize factory edits. |
| guard-omp-executable-discovery (row 12) | Security successor | The trusted-extension module's CONTENT and pre-import exclusion logic live there; this change supplies only the exact path selector they extend. A launch before row 12's module exists fails closed. |
| gate-omp-policy-readiness (row 13) | Successor | Readiness gating is post-spawn per session; this change neither implements nor bypasses it. |
| enforce-omp-restricted-tool-policy (row 14) | Security successor | Row 14 remains the operative restricted boundary (execution-time default-deny) while row 8's reset gate stands; nothing here adds tool-level clamps to YOLO. |
| disable-restricted-agent-lsp (row 15) | Successor | Row 15 consumes the restricted overlay's `lsp.enabled: false` pin this change passes through; it must not move the pin into the factory or leak it into the YOLO argument set. |
| make-skill-staging-agent-portable (row 16) | Follow-on | Consumes that canonical `{workspace}/tmp/{sessionId}` staging survives OMP state partitioning here; absolute staging prompt text is row 16's, not this change's. |
| control-omp-url-fetch-transport (row 17) | Downstream | Reuses the unchanged `egressProxy`/`unrestrictedEgress` posture this change passes through; no transport logic here. |
| package-pinned-omp-runtime (row 20) | Successor, same-owned-tree | Row 20 installs the `omp` binary (making PATH resolution succeed), the owned overlays outside agent-writable roots, and the trusted module at the path constant defined here; checksum/notice work must honor this change's contracted module path. |
| modernize-acp-session-config (row 6) | Independent sibling | Connector-side model/reasoning only; factory untouched there. |
| finish-omp-mocked-skill-handoff (row 22) | Final regression/docs | Must not restate config sync (zero new config/env fields here) and extends docs only. |

- Shared-file conflict: `src/acp/agent-factory.ts` — this change owns the OMP launch branch; rows 7/8 are consume-only against it and row 20 must not touch it; apply after row 7/8 and serialize any row 10 factory edits. `src/acp/sandbox-manager.ts` — shared with rows 7/10; this change plans zero edits there (pass-through only). `src/utils/omp-paths.ts` is new here; rows 12/16/20 import its trusted-module path constant rather than hardcoding a path. `docs/OMP_SPAWN.md` new here; `docs/OMP_SETTINGS.md` stays row 8-owned; `CHANGELOG.md` serial as usual.
- Spec-conflict: ADDED requirements are uniquely named within `acp-integration`; downstream rows consume the spawn-time-mode-only rule and mode-distinct state roots unchanged and must not modify the trusted-extension requirement into an in-factory trust mechanism.

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
