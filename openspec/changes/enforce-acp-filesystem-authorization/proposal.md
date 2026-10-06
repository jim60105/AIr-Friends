## Why

Canonical root observations (`canonicalize-acp-filesystem-roots`) and protected root-relative IO (`secure-acp-filesystem-access`) exist as libraries, but every live ACP filesystem sink still decides with lexical `resolve()`/`startsWith()` checks and executes ordinary `Deno.readTextFile`/`Deno.writeTextFile`. Restricted ordinary writes therefore still depend on a preceding `requestPermission()` round trip, a symlink or raced path replacement can redirect a callback operation outside its root, arbitrary user-workspace files remain writable, and there is no read path at all to the deployment-owned skills root that does not also imply a name-only trust rule.

## What Changes

- Cut `ChatbotClient.readTextFile()`/`writeTextFile()` over to the predecessor protected access operations: each callback resolves the requesting session's context, obtains canonical roots/target observations, applies the policy decision, selects the authorized physical root role, and performs content IO only through that operation. No ordinary path-based content read/write remains on any callback path; a failed observation or authorization never downgrades to path IO.
- Enforce restricted ordinary-write authorization **independently of any preceding permission request**: allow the requesting session's own canonical staging root, or shared Agent workspace writes only with `canWriteAgentWorkspace` plus an allowed write extension; deny every remaining ordinary user-workspace target — including an otherwise-allowed `.md` file — as its own new bounded reason.
- **BREAKING on adoption:** ordinary restricted structured writes into the user's own workspace (outside the session staging root) are no longer permitted; the existing test asserting an arbitrary in-workspace `.py` write succeeds is replaced by the containment/staging cases.
- Preserve native YOLO broad ACP containment: workspace/shared membership alone authorizes a YOLO callback write with no staging-only rule, extension filter, `canWriteAgentWorkspace` requirement, or restricted LSP/tool/command clamp; external/sibling escapes stay denied and docs state that non-ACP native execution is unconstrained.
- Read-side cutover: the existing workspace/shared containment plus `.jsonl`/`.md`/`.txt` read-extension rule is preserved unchanged, physical rather than lexical, and the new read-only trusted-skills root is added to `readTextFile` and to the restricted read-path classification in `requestPermission`, replacing the current name/`$HOME`-derived `isWithinDir` skills rule. Trusted-root reads require the predecessor critical-skill provenance/current-generation binding, grant read only, and deny escape links even under YOLO.
- Add specific bounded denial diagnostics: one bounded rejection reason per denial, recorded on every filesystem sink denial path, preserving existing shared authorization/extension reason codes and adding restricted in-workspace, canonical-observation, secure-access and trusted-skills read reasons; no content, secret or unbounded error text.
- Remove the obsolete bypasses and client-local path logic they replace: private lexical predicates (`isWithinDir` sinks use, `isPathAllowed`, `isAgentWorkspacePath`, `isWithinTmpDir`, client-local `resolveSessionPath`) and the legacy HOME/`Deno.cwd()` skills auto-approve branch. The generic-command path-argument gate keeps its own lexical policy here unchanged; destructive edit/write normalization stays with its owner.
- Cover callbacks, permission-path classification, registration and affected callers/tests so no obsolete bypass remains; document consumer-visible semantics and evidence limits.

## Capabilities

### New Capabilities

None; reuse the existing ACP integration capability.

### Modified Capabilities

- `acp-integration`: Amend the restricted/YOLO permission-handling and file-callback requirements so ACP read/write sinks decide on canonical physical observations, enforce restricted staging/shared/extension authorization independently of `requestPermission`, deny ordinary user-workspace mutation, preserve YOLO broad containment, admit the read-only trusted-skills root, and record bounded denial reasons. Predecessor canonical-root and secure-access requirements are preserved, not redefined.

## Impact

Eventual implementation owns: amended `src/acp/client.ts` (callbacks, shared session-gate decision path, skills read classification, rejection recording, removal of replaced private predicates) and a small focused sink-policy module `src/acp/filesystem-policy.ts`; amendments in `src/acp/types.ts` and `src/acp/agent-connector.ts` for the per-session context that carries the owning Skill API session id and deployment-owned trusted-skills provenance, plus the lifecycle/registration points in `src/core/session-orchestrator.ts` (per-session context registration and existing staging provisioning surfaced as an explicit denial instead of an implicit mkdir); updated/extended `tests/acp/client.test.ts` and a new `tests/acp/filesystem-authorization.test.ts`, with the existing in-workspace-write-success and HOME-skills cases replaced. Documentation: existing `docs/AGENT_PERMISSIONS.md` (Layers 3/4, decision-reason table, Known Limitations) and a focused `CHANGELOG.md` entry.

Consume predecessor `filesystem-roots`/`filesystem-access` exports and P0's `CriticalSkillContract`/evidence verdict without redefining them, and consume pinned ACP/OMP platform behavior rather than inventing client-visible API methods. No new configuration/environment field is introduced, so `config.example.yaml`, `.env.example` and `helm/values.yaml` remain intentionally unchanged. No dependency upgrade, compatibility shim, migration or command-policy change.

Non-goals owned elsewhere: delete/move/multi-file patch target normalization and incomplete-intent handling (`normalize-acp-destructive-targets`); the generic-command argument path gate and unrestricted tool-inventory/provenance/default-deny policy (`enforce-omp-restricted-tool-policy`); native OMP delegation, discovery, readiness and real-runtime enforcement (`establish-omp-compatibility-contracts` gates plus later trusted-module/readiness slices); recursive safe directory materialization and staging provisioning redesign; Skill API/Skill-handler payload containment; dashboard/workspace/memory/Skill-API filesystem APIs; process pool, mode and state-namespace allocation; absolute staging payload recipes; network/transport; packaging. Genuine predecessor incompatibilities remain application gates for this change, not reasons to skip proposal generation.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Consume predecessor verdict/exports; align callback and gate decision contracts and context plumbing | 0.50 |
| Implement restricted/YOLO sink policy and read/write callback cutover with obsolete-logic removal | 2.50 |
| Trusted-skills read-root wiring, requestPermission read classification, bounded denial reasons | 1.00 |
| Consumer-visible unit/temp-filesystem/mock tests incl. replaced legacy cases | 2.00 |
| Permission documentation and changelog (no config synchronization needed) | 0.50 |
| Applicable focused checks and spec verification, no live acceptance | 0.50 |
| Contingency for edge-case/review fixes | 1.00 |
| **Total hard ceiling** | **8.00** |

Core is 7.00 hours plus 1 hour contingency. No low-level IO primitive, ABI, syscall, discovery/readiness or command-policy work is hidden in this allocation.

## Batch:

depends-on: canonicalize-acp-filesystem-roots
depends-on: secure-acp-filesystem-access

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| canonicalize-acp-filesystem-roots | Required observation API; selects roles, never grants | Read-only import of `src/acp/filesystem-roots.ts`; preserve root roles, prospective staging and fail-closed reasons. Shared `docs/AGENT_PERMISSIONS.md`, `CHANGELOG.md` and additive `acp-integration` requirements; apply predecessor first. |
| secure-acp-filesystem-access | Required protected IO backend | Imports its read/write operations with no ordinary-IO fallback; surfaces `parent_missing`/`root_unavailable` for unprovisioned staging instead of inventing mkdir. Shared docs/changelog/spec only, never its modules. |
| establish-omp-compatibility-contracts | Application gate + trusted-skill provenance | Consumes the actual verdict and `CriticalSkillContract` identity for the read-only root; an unresolved/incompatible critical-skill boundary blocks application of this change even with passing local fixtures. Do not edit its artifacts or manufacture native support. |
| normalize-acp-destructive-targets | Later shared gate consumer | Both classify edit/write requests in `requestPermission`; this change only changes physical classification, read-skills approval and rejection reasons, leaving destructive shape/normalization untouched. Serialize further edits to that branch and to `src/acp/client.ts`. |
| enforce-omp-restricted-tool-policy | Later policy consumer | Shares `src/acp/client.ts`, `docs/AGENT_PERMISSIONS.md`, the rejection-reason vocabulary and `acp-integration`; adds no tool-inventory, URI/device or provenance clamps here and must not re-add an implicit permission-request dependency for ordinary writes. |
| gate-omp-policy-readiness | Later client consumer | Reuses the per-session context/provenance plumbing extended here; owns readiness state and the prompt gate, not sink authorization. |
| make-skill-staging-agent-portable | Later payload consumer | Same staging root and session-id semantics, no literal-token path edits here; shared docs/changelog only. This change surfaces a missing provisioned staging directory as a bounded denial rather than precreating it. |
| isolate-omp-process-pools-by-mode / restore-mode-owned-acp-sessions | Context producers | Mode/state identity and restored per-session context are theirs; this change only adds the fields the sink decision needs to the existing per-session context and its registration points. |
| cover-omp-mocked-acp-lifecycle / finish-omp-mocked-skill-handoff | Final regression/docs | Combined lifecycle mocks and the final docs pass may extend the sink cases; keep per-path unit cases here and avoid duplicate same-path assertions. |

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
