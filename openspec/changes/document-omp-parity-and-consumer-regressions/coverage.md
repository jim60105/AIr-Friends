# Approved parity batch coverage and scheduling

This planning batch covers all 37 items of `docs/superpowers/specs/2026-10-14-omp-opencode-parity-simplification-design.md`, committed as `cece826`. The design is authoritative; old current requirements are changed or removed by owning deltas. Implementation is not authorized by these proposals.

## Change keys and estimates

| Key | Change | Task work | Integration/repair | Total estimate |
|---|---|---:|---:|---:|
| A | normalize-omp-destructive-acp-ingress | 4.00 h | 1.50 h | 5.50 h |
| B | simplify-omp-session-boundaries | 5.25 h | 1.50 h | 6.75 h |
| C | simplify-omp-recovery-context | 3.50 h | 1.00 h | 4.50 h |
| D | cutover-omp-native-runtime | 6.25 h | 1.50 h | 7.75 h |
| E | simplify-omp-container-installation | 4.00 h | 1.00 h | 5.00 h |
| F | document-omp-parity-and-consumer-regressions | 6.50 h | 1.00 h | 7.50 h |

Total batch estimate is 37.00 engineer-hours. Every individual estimate is strictly below 8 hours, includes tests/docs and repair allowance, and is an estimate rather than a guarantee. Each task has its own estimate in tasks.md. No task is left as architectural exploration for a gpt-luna worker.

## Valid decomposition of the coupled architecture

The full original core plus lifecycle/callback/recovery and packaging work exceeds a workday. A provides a functioning ACP ingress correction and shared destructive type owner. B provides functioning shared callback/lifecycle consumers while keeping the scanner/settings modules still imported by the old bootstrap/factory. C provides functioning shared recovery while preserving OpenCode optional ownership checks. These are product behavior changes, with no placeholder module or runtime shim.

D replaces all remaining tightly coupled config/launch/extension/build consumers in one cutover. It does not delete ompSettingsForMode while an inventory still imports it, change cwd while registration still infers mode from it, remove executable-sources while bootstrap still uses it, or delete deployment-module while the bundler still needs declarations. Native network replacements and skill URI trust disappear with that closed extension. The ordinary authored models install is moved during D because native launch needs it then. E deletes the still-live manifest build command and special installation policy together. F extends cross-component/native consumer evidence and consolidates documentation; it never repairs missing imports or postponed core tests.

## Dependency/conflict matrix and implementation order

Behavioral DAG: B -> C; A+B+C -> D; D -> E; D+E -> F. A and B are behavior-independent but edit shared files, so use serial order **A, B, C, D, E, F**. There is one integration owner per shared file at each stage. Spec requirement ownership below prevents independent changes from replacing the same requirement accidentally.

| Pair | Behavioral dependency | Shared-file conflict | Scheduling decision |
|---|---|---|---|
| A/B | None | client.ts, agent-connector.ts, filesystem/destructive client fixtures, OMP_TOOL_POLICY.md, CHANGELOG | A then B |
| A/C | None | agent-connector.ts, agent-connector.test.ts, lifecycle fixtures, CHANGELOG | A then C |
| B/C | C requires B | agent-connector.ts, session-orchestrator.ts, callback/recovery/lifecycle/handoff fixtures, OMP_RECOVERY.md | B then C |
| A/B/C with D | D requires all three | types.ts, factory/connector references, client/lifecycle/mock fixtures, OMP docs, acp-integration capability | D starts after all three |
| D/E | E requires D | Containerfile, bundle/package smoke, omp-packaging.test.ts, OMP_PACKAGING.md, container-packaging capability | D owns models COPY/native closure; E owns manifest/install policy |
| D/F | F requires D | native authored fixture/smoke, handoff/mock builder, current OMP docs and feature site | D migrates old imports/tests now; F adds consumer breadth |
| E/F | F requires E | packaging/checklist documentation, config-write observer, CHANGELOG | E then F |

No implementation worktrees are needed for these proposals. Batch planning commits touch only their own `openspec/changes/<change>/` directory and stay on master. Implementation branches are a later os-apply concern.

### Shared-file and requirement ownership

| Surface | Owners in order | Exact responsibility |
|---|---|---|
| src/acp/client.ts | A -> B | A configured-agent destructive ingress; B remove critical metadata checks while preserving shared callback roots |
| src/acp/types.ts | A -> D | A optional internal ClientConfig.agentType; D OmpPermissionMode and removal of settingsSourcePlan |
| src/acp/agent-connector.ts | A -> B -> C | A configured client type; B scanner/root-baseline retirement; C optional shared recovery |
| src/core/session-orchestrator.ts | B -> C | B removed scanner error classifications; C OMP ownership bookkeeping/context type retirement |
| src/acp/omp/compatibility-contracts.ts | A -> D | A moves shared types with every consumer; D deletes ledger after last live consumers disappear |
| src/acp/omp/* and extension/* | D, with B retiring daemon owned-skills consumers and A adding destructive-ingress | D complete native capability/build closure; B retains owned-skills/critical-skills for old native bootstrap; never delete still-consumed prerequisites before D |
| src/utils/omp-paths.ts, factory, sandbox, process pool | D | Replace old mode cwd/agent-home/state plans with authored files and native XDG data roots |
| scripts/omp/bundle-extension.ts / bundle-declaration.ts | D | D native ESM build and deployment declaration removal |
| Containerfile | D -> E | D native HOME models path consumed by launch; E ordinary install conventions and manifest closure |
| tests/mocks/omp-mock-session.ts and consumer fixtures | D -> F | D all dead-import/governance migration; F real-component handoff/native evidence extension |
| acp-integration requirements | A -> B -> C -> D | A adds ingress requirements; B retires mixed critical/shared-root contract for a shared-root replacement; C retires mandatory OMP recovery contracts for shared/OpenCode replacements; D retires remaining mixed governance contracts for native launch/tool requirements |
| container-packaging requirements | D -> E | D native-loadable closure and declaration removal; E install/manifest/single-tree changes |
| configuration-and-deployment requirements | D -> F | D generated-artifact/current path requirement; F replaces historical current-governance docs requirements and adds manual/evidence documentation |
| skills-and-reply requirements | F | consumer suite requirements only; preserve JWT/auth/payload/reply rules |
| shared-acp-process-pool requirements | C | add normal OMP mode-entry recovery; retained mode keys and global lease requirements unchanged |
| current OMP docs / CHANGELOG | A -> B -> C -> D -> E -> F | Each owner updates its affected current behavior immediately; F reconciles inventory without deferring earlier docs/tests |

## All 37 design dispositions

A task reference is `Key 1.N`. “Retain” means implementation intentionally remains unchanged, with consumer non-regression coverage rather than speculative inverse assertions.

| Item | Feature | Disposition | Primary owner/task and acceptance |
|---:|---|---|---|
| 1 | Optional agent type | Retain shared supported set/default/load validation | F 1.3,1.5; factory/dashboard consumer selection unchanged |
| 2 | Compatibility contracts/audit | Remove governance ledger and fixed postures; retain source evidence | D 1.4,1.6; shared types first moved by A 1.1 |
| 3 | Mode-owned settings | Simplify to hand-authored native YAML; delete mirror/schema simulation | D 1.1,1.2,1.7; native consumption plus actual config-write observation |
| 4 | Settings-source isolation | Remove identity/preflight isolation | B 1.1,1.3; D 1.2,1.4 removes still-consumed factory/bootstrap closure |
| 5 | Both-mode LSP disable | Native tool deny only; remove global/flag cold-start suppression | D 1.1,1.3; F 1.2 explicit native tool deny without startup assertion |
| 6 | Mode launch | Retain native launch policy; simplify generated/validated/path state | D 1.2,1.7; authored configuration + native XDG model/data behavior |
| 7 | Mode process pool | Retain mode-separated OMP process keys and global lease | C 1.3,1.5; D 1.2; F 1.5 OpenCode reuse preserved |
| 8 | Pre-import guard/critical skills | Remove bootstrap and critical exclusions | D 1.3,1.4,1.5; no empty first-stage replacement |
| 9 | Workspace executable preflight | Remove scans and lifecycle wiring | B 1.1,1.3; D 1.4 deletes bootstrap's final scanner consumer |
| 10 | Restricted tool inventory | Minimal actual capability map + default deny | D 1.3; F 1.2 unmatched effectful tool cannot dispatch |
| 11 | Runtime enforcement | Native callback only for wildcard default deny; shared ACP gate for policy | D 1.3,1.5; actual dispatch and rejected-write outcomes |
| 12 | Native extension wiring | Retain official on(tool_call), delete registry/evidence machinery | D 1.3,1.4,1.7; native load and later F 1.2 native dispatch |
| 13 | Builtin provenance | Remove source tuple/admission | D 1.3,1.4,1.5; mapped capability policy applies |
| 14 | Physical module evidence | Remove runtime/build anchors and deployment surface; normal install | D 1.4; E 1.1,1.2,1.5 |
| 15 | Destructive operations | Retain common decoder/all-target policy, add OMP ingress shape | A 1.1–1.5; D 1.3 removes extension duplicate; F 1.2 native cases |
| 16 | Filesystem boundary | Retain existing shared callbacks/no-follow/authorization, scoped to real callbacks | B 1.2,1.4,1.5; A 1.4; F 1.2,1.5 actual native route recorded |
| 17 | Syscall confinement | Retain shared sandbox/mount mechanism unchanged | B 1.2; D 1.2 shared observation retained; F 1.5 confinement suite |
| 18 | Command path gate | Retain common syntax/path policy unchanged | A 1.4,1.5; D 1.3 no duplicate; F 1.2,1.5 consumer allow/deny |
| 19 | Skill script inventory | Retain exact shared entrypoint/configured root | B 1.2,1.5; F 1.1,1.4,1.5 |
| 20 | URL fetch transport | Remove project transport/routes/read replacement; native read | D 1.1,1.3,1.4; F 1.2 native URL result |
| 21 | Web search | Remove backend/credential gate/search replacement; native search | D 1.3,1.4; F 1.2 actual native capability/provider result |
| 22 | Network replacement admission | Remove completion markers and gates with replacements | D 1.3,1.4,1.5 |
| 23 | Replacement native contracts | Remove schema/result mirrors with replacements | D 1.4,1.5; F 1.2 tests operations, not result-byte equality |
| 24 | Dedicated public code search | Do not recreate removed dedicated capability or add native-service prohibition | D 1.6 removed obsolete spec; F 1.3 disposition docs |
| 25 | Owned skill root declaration | Author root in native YAML; remove startup writer/unique-source gate | D 1.1,1.2,1.4; F 1.4 manual deployment instructions |
| 26 | Skill reads/handoff | Native skill:// read; retain actual script root/prompt/handoff | D 1.3,1.5; F 1.1,1.2 native read/current-session delivery |
| 27 | Skill trust ladders | Remove OMP root baseline/critical/generation/URI validation | B 1.2,1.4 removes daemon producer consumers and moves native-only type; D 1.3,1.4 removes remaining producer/extension closure |
| 28 | Single skills root | Retain common resolver/install/inventory/mounts; manual native declaration | B 1.2,1.5; F 1.1,1.4,1.5 |
| 29 | Binary version/package | Retain pin, per-architecture download checksum and version health | E 1.1,1.3,1.5; F 1.5 record actual architecture/version |
| 30 | Native extension bundle | Retain single native-loadable frozen ESM; remove trust evidence/declarations | D 1.4,1.7; E 1.2,1.5 |
| 31 | Extension architecture | Replace governance core with native capability difference only | D 1.3,1.4,1.5 |
| 32 | Recovery ownership | Remove mandatory OMP record/full-context gates; preserve OpenCode optional checks | C 1.1–1.5; B scan precondition retirement |
| 33 | Dashboard agent selection | Retain shared UI/type selection; no UI edits | F 1.3,1.5 dashboard consumer suite |
| 34 | Thought logging | Retain common buffer/audit payload unchanged | F 1.3,1.5 existing client thought consumer cases |
| 35 | ACP lifecycle testing | Keep consumer lifecycle/OpenCode behavior; remove governance postures | B 1.4; C 1.3; D 1.5; F 1.5 |
| 36 | Skill handoff testing | Retain real-component chain/session isolation with authored settings | D 1.5 migrates fixtures now; F 1.1,1.2,1.5 adds breadth/native evidence |
| 37 | Current docs/decisions | Sync current docs/specs/checklists and fix OpenCode discovery mistake | Each unit's docs tasks; F 1.3–1.5 final inventory/config-trio reconciliation |

## Native reachability decisions resolved during planning

Native tools.approval uses exact keys and has no wildcard. The official on(tool_call) result blocks dispatch. OMP native ACP supports no per-session approval mode, so mode-separated processes stay. Native destructive bridge provides execute kind for Bash but can omit kind on delete/move and embeds first-operation-only edit locations; A normalizes single native shapes and retains shared patch denial.

Native main constructs ModelRegistry with its default path. No model-config-file CLI switch is assumed. Config is HOME/.omp/agent/models.yml; mode data uses existing XDG_DATA_HOME/omp (must exist before spawn). Native dirs source keeps config and XDG data separate on this pin. This replaces isolated HOME/PI_CODING_AGENT_DIR state without runtime YAML copy/symlink or an invented flag. Containerfile installs the authored model file in D, so this is not deferred to E.

Restricted-only loading supplies mode selection to the extension; no cwd inference/new env flag is necessary. Native tool mapping represents read/URL/skill, local search, todo, web search, modify and execute. Native result/redirect/search-backend differences remain. Actual external-directory behavior is exercised/reported without widening callback policy.

## Acceptance and evidence boundary

Proposal validation certifies artifact syntax only. No implementation, build, native agent, paid model, proxy, image or platform check has been executed by proposal creation. Planned focused acceptance commands are in each tasks.md, with native version and missing-prerequisite reporting. Use exact 18.6.1 native evidence and label any local-version mismatch. F’s loopback provider is a scripted model fixture; native tool dispatch is real, model reasoning is mocked. Public search success/proxy route/platform delivery requires separately observed credentials/network/platform context and is never inferred from env vars or mocks.
