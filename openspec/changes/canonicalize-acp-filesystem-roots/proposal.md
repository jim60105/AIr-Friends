## Why

ACP path checks currently conflate lexical containment, session payload staging, and process temporary state. The approved integration needs one agent-generic, physically grounded root/path decision contract before secure access adapters and client sinks can enforce it consistently.

## What Changes

- Implement reusable session-context path expansion, canonical root identity, and existing/new-target resolution helpers, with explicit fail-closed results instead of lexical fallback on filesystem errors.
- Classify physical targets against the requesting session workspace, its canonical Skill API staging directory, shared Agent workspace, and an independently trusted read-only skills root. Process TMPDIR/state is not a staging grant.
- Preserve OpenCode's legacy session token forms and resolve relative paths against session cwd, never the daemon cwd or another session's fallback. Keep native YOLO broad workspace/shared containment without restricted tool clamps.
- Define contained versus escaping symlink decisions and a complete, operation-neutral handoff to secure access consumers. A canonical precheck is not race-proof and does not perform the protected file IO.
- Cover real helper decisions with temporary filesystem fixtures and deterministic metadata-error mocks; document the consumer contract and evidence limitations.

## Capabilities

### New Capabilities

None; reuse the existing ACP integration capability.

### Modified Capabilities

- `acp-integration`: Add common canonical session-root identity, contextual path resolution, physical target classification, trusted-skills root and fail-closed observation requirements. These additive helper requirements do not cut over existing runtime callbacks or replace P0 compatibility requirements.

## Impact

Eventual implementation owns new `src/acp/filesystem-roots.ts`, new `tests/acp/filesystem-roots.test.ts`, a focused helper-contract section in existing `docs/AGENT_PERMISSIONS.md`, and a focused `CHANGELOG.md` entry. Consume P0's `CriticalSkillContract` and evidence verdict without redefining native APIs, discovery or skill selection. No dependency upgrades, config/environment fields, compatibility shims or migrations; `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain intentionally unchanged.

Do not edit production client/connector/orchestrator/factory, Skill API handlers, or syscall adapters here. `secure-acp-filesystem-access` (row 3) owns no-follow/root-relative access and path-replacement safety through actual IO. `enforce-acp-filesystem-authorization` (row 4) owns client callback/permission cutover, restricted authorization/extensions and bounded denial recording. Destructive normalization, native skill discovery, process mode/state allocation and prompt payload migration belong to their later slices. This helper library is complete and directly testable, but does not claim deployed sink hardening before rows 3/4.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Consume P0 verdict; finalize helper signatures against existing session/staging semantics | 0.50 |
| Implement contextual expansion and canonical root/target decision helpers | 3.00 |
| Consumer-visible temporary-filesystem and mocked-error unit tests | 2.00 |
| Permission documentation, consumer handoff and changelog | 0.75 |
| Applicable focused type/unit checks and proposal/spec verification, no live acceptance | 0.50 |
| Contingency for edge-case/review fixes | 1.00 |
| **Total hard ceiling** | **7.75** |

Core is 6.75 hours plus 1 hour contingency; implementation, tests, documentation and verification together stay below 8 hours. No native runtime/source-mechanism research or low-level IO implementation is hidden in this allocation.

## Batch:

depends-on: establish-omp-compatibility-contracts

- Row 2 / P1a. P0's actual source verdict gates application: incompatible/unresolved required boundaries remain blockers even if P0 artifacts/tasks and synthetic mocks pass. In particular, unresolved critical-skill selection cannot be promoted to native support by this library. Proposal drafting may continue while application is blocked.
- Code-conflict: row 3 imports root identities/target observations into `src/acp/filesystem-access.ts`; row 4 adapts per-session context and replaces obsolete client-local path logic in `src/acp/client.ts`. Both consume this contract, not new competing canonicalizers. This row introduces no client cutover or aliases.
- Consumer/conflict: row 5 destructive normalization and row 12 critical-skill discovery consume canonical identities without revising P0 completeness/provenance contracts; rows 9/10/11 own process namespaces/context restoration, row 16 owns staging payload recipes. Serialize any later change to `src/acp/filesystem-roots.ts`/its unit test and update consumers together.
- Shared-file conflict: `docs/AGENT_PERMISSIONS.md` and `CHANGELOG.md` need serial integration with filesystem, policy and final documentation slices.
- Spec-conflict: additive uniquely named requirements in `acp-integration`; rows 3/4/5 add access/sink/destructive behavior separately and preserve these and P0 requirements. Existing workspace/sandbox specifications remain unchanged in this helper-only slice; runtime amendments belong to their sink owner.
