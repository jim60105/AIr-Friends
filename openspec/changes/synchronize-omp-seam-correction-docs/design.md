# Design

## Context

The current batch index describes 27 original changes as archived, but C1-C7 as unapplied proposals. The actual archived OMP baseline is 35: 27 original, seven C followups and `2026-10-13-unify-omp-skill-root-resolution`. Cancelled readiness row 13 is not an applied change and the original historical row-21 code-search entry is superseded by C1's removal. Unrelated non-OMP archive entries are excluded from this count.

Current launch assembly already consumes the generated .js bundle, not raw source. `OMP_SPAWN.md:33` and `OMP_DISCOVERY.md:62` are stale; the index still describes copied `_daemon` imports. `OMP_TOOL_POLICY.md:15-17` says there is no runtime consumer despite existing enforcement wiring. Discovery's session-failure section also promises a hard session/new/load rejection on extension hook/load failure, contrary to the accepted risk and absence of an authenticated readiness channel.

## Goals / Non-Goals

Synchronize current status and deployment contract without rewriting historical archives or inventing acceptance evidence. Consolidate after each functional owner has documented its behavior; record the user's accepted native local read/search status, the authorized ambient native mutation posture and the latest-version investigation without a false confinement claim.

No implementation, archive, main-spec sync, readiness restoration, pin update, configuration change, runtime launch or repetition of the user's observations. The final docs apply does not convert merely proposed changes to applied.

## Decisions

### Separate baseline, new proposals and evidence

Rewrite current-status paragraphs/table to list the 35 archived baseline changes and five new proposals separately. Retain the historical original rows and proposal-time evidence with explicit historical labels. Row 13 stays cancelled with no readiness channel; row 21 stays historical/superseded by C1. C1-C7 become archived baseline, not queued changes, and the skill-root-resolution archive gets its current ownership row.

Add this batch's issue owner, decision, dependency and code-conflict matrix. Proposed/applied state comes from real artifacts and merged implementation status at future apply time. Artifact existence or strict OpenSpec validation proves proposed completeness, not implementation or native runtime success. The accepted native local-IO decision removes the former protected-IO prerequisite, and the user's explicit authorization of the ambient native mutation risk removes the former mutation-route gate: do not retain an obsolete user-decision blocker, an application-blocked mutation status, a pending mutation prerequisite or a claim of native filesystem confinement.

### Correct exact deployment wording

Document canonical source `src/acp/omp/extension/index.ts` as a build input. Development launch selects `build/omp-extension/index.js` resolved to an absolute path by assembly; image launch selects `/opt/air/omp/extension/index.js`. Packaging contains the single generated locked ESM artifact and explicit supported native-host/typebox facade, with manifest coverage. Remove copied `_daemon` and raw-source launch claims rather than preserving deprecated alternatives. Keep module deployment root separate from mutable per-spawn/pool state root and session roots.

### Truthful boundary documentation

After owners land, synchronize native builtin versus SDK provenance, direct `api.getAllTools`, physically observed owned replacements, delivered quoted skills root and all per-spawn recovery callers. Remove no-consumer/pooled-only language only where source now supports the corrected claim. Distinguish supported ACP bash/write sink completion and callback-only protected filesystem policy from accepted native local read/search and authorized ambient native write/edit under approval and ambient OS permissions, recording the mutation residual risk.

Replace OMP_DISCOVERY's hard extension-load rejection/never-extensionless guarantee with the approved residual risk: source enforces deployment preflight and owned handler decisions, but pinned native extension error handling can log failures without observable authenticated readiness. This documentation change must not add a gate or claim the absence of a handler is detected. Keep fail-closed daemon settings/executable preflight guarantees only at their actual seams. Unresolved native pinned verdict strings remain unchanged alongside DECIDED deployment-admission/skill-selection dispositions; they are not a pending second user approval for those old decisions. Issue 1's newer decision accepts native local read/search, including ambient readability beyond daemon roots, with remote/device routes still denied.

### Ownership and file audit matrix

| File or surface | Factual correction owner | Final pass |
| --- | --- | --- |
| OMP_ENFORCEMENT, OMP_TOOL_POLICY, OMP_SETTINGS, OMP_COMPATIBILITY | native admission / owned evidence | remove stale taxonomy, api.ctx, no-consumer and false callback-completion statements; record accepted native local read/search, the authorized ambient native mutation posture with its residual risk, supported settings and latest-version/no-bump investigation |
| OMP_NETWORK and skill-URI handoff sections | owned evidence | valid physical origin precedes completing policy; preserve absent-credential deny/no fallback |
| Prompt variable docs and skill invocation recipes | delivered root | all delivered templates/retry use literal trusted root and quoted arguments |
| OMP_RECOVERY | per-spawn recovery | all owning callers, mandatory OMP context, legacy OpenCode distinction, no readiness |
| OMP_SPAWN, OMP_DISCOVERY, OMP_PACKAGING | this final docs change, with predecessors' new evidence types | generated path contract, immutable deployment root/state root separation, accepted extension-load residual risk |
| 2026-10-06-omp-proposal-batch-index.md and design current-status cross-links | this final docs change | archived 35 baseline, C followups/unify, cancelled readiness, superseded search, new proposed batch and accepted native decision |
| CHANGELOG and USER-RUNTIME-VERIFICATION | each behavior owner plus final deduplication | factual history, evidence limits, no duplicate or checked runtime rows |
| README/operator configuration/environment audit references | final cross-link pass only | existing defaultAgentType/skillsDir/AGENT_WORKSPACE and documented deployment contract; no new knobs |

Preserve the selected configuration trio, public code search removal, native YOLO separation, both-agent/both-mode LSP disable and unchanged sandbox/egress behavior. Pin versions remain OMP18.6.1, ACP SDK0.14.1 and the existing embedded MCP provenance.

## Serial Delta Projection and Application Matrix

| Issue | Change | Depends on | Budget | Shared edit ordering |
| --- | --- | --- | --- | --- |
| 1 Native builtin source/admission | admit-trusted-omp-native-builtins | none | 8h | precedes issue2 for native registration/provenance |
| 2 Owned physical module evidence | bind-omp-owned-module-evidence | issue1 | 8h | preserves issue1 direct roster/native-local authority |
| 3 Delivered skill root/quoted recipes | render-delivered-skill-root-contract | none | 5.5h | precedes issue4 for session-orchestrator |
| 4 All recorded OMP recovery context | thread-per-spawn-omp-recovery-context | issue3 | 7h | preserves issue3 render/delivery edits |
| 5 Current docs/history reconciliation | synchronize-omp-seam-correction-docs | issues1,2,3,4 | 3h | last substantive/current-doc writer |

Every substantive writer owns focused docs and a history entry. All pairs therefore conflict on append-only CHANGELOG; serialize those commits and let issue5 deduplicate final history without creating runtime dependencies. Issues1/2 also overlap current provenance/enforcement docs and bundle inputs. Issues3/4 overlap orchestrator delivery/recovery callers. Issue5 overlaps all current documentation. Every ordering edge is shared-file serialization only: no change in the batch is gated on an unmet mutation or runtime prerequisite.

Project deltas in order1,2,3,4,5. Issue1 fully modifies live-provenance and inventory requirements, retaining every existing scenario title while replacing the universal native-read callback promise with approved local-native authority. Issue2 modifies exact owned-module trust and native-event context requirements; it does not overwrite issue1's builtin union or reinstate fake session filesystem evidence. Its packaging declaration grants authority only to exact generated deployments. Issue3 modifies the delivered-template requirement. Issue4 modifies recovery threading and adds agent-specific mandatory OMP context; the existing optional trailing API remains optional for legacy OpenCode only. Issue5 adds documentation requirements without rewriting historical runtime verdicts.

The main ACP protected-filesystem callback requirement remains unchanged and applies only when those callbacks execute. It does not confine direct native IO. All MODIFIED blocks retain their complete preexisting scenario sets. Archive/sync is outside this assignment; projection here is a planning contract, not an applied main-spec change.

Issue1's ordinary mutation restoration runs under the pinned native approval path and the process's ambient OS permissions: the user explicitly authorized accepting the ambient native mutation risk and the residual risk is recorded, so there is no application-blocked status and no pending mutation prerequisite. Issue2 follows issue1, and issue5 is last, purely by shared-file/dependency serialization; issues1, 3 and 4 are independently actionable. All artifact phases can still be proposed; strict validation is not proof that any producer exists or that implementation or runtime acceptance has landed. Do not mark the full builtin issue complete on artifact existence alone.

## Risks / Trade-offs

A current-status edit can accidentally falsify historical proposal evidence. Keep history labeled and archives frozen. Native local-IO adoption does not fix root confinement; keep its accepted ambient-readability risk and the authorized ambient native mutation risk explicit without manufacturing a remaining decision blocker or claiming ACP-sink protection for the paths that bypass it. Source/mock evidence does not prove native handler execution or packaged runtime behavior.

## Migration Plan

Documentation-only cutover after the serialized substantive writers. Update existing files, remove obsolete claims and consolidate history; no new parallel documentation convention. Budget: baseline/source comparisons 1h, docs edits 1h, focused cross-link/status/style checks and history reconciliation 1h.

## Verification Plan

Compare index membership against the 35 actual OMP archive directories and read each relevant current source contract. Use documentation-only checks for stale raw launch/copy claims, legacy no-consumer/pooled-only assertions, dependency/status links and contradictory readiness wording. Leave every unexercised runtime checklist entry UNVERIFIED, retaining user-observed helper/render failures as observations without rerunning them. No native agent, provider, container, browser, project test/build/lint/formatter or implementation acceptance is part of proposal creation.
