## Why

Native OMP delete/move requests and multi-operation patches are not equivalent to OpenCode `kind: "edit"`: the pinned permission gate can present only one delete or move in its explicit location list (`getEditDestructiveIntent` returns a single target; `extractPermissionLocations` cannot recover omitted later operations), so a location-list-driven approval would authorize a larger patch than what was verified. The current client classifies only `kind: "edit"`/legacy titles and checks whatever locations arrive, which is first-target-only by construction, and never rejects unparseable or endpoint-missing destructive input before mutation. Design §8 requires the complete target set normalized into one common all-target destructive policy that fails closed.

## What Changes

- Add a pure destructive-normalization module (`src/acp/destructive-policy.ts`) that consumes P0's `DestructiveIntentContract` shape — trustworthy native tool identity and exact raw input, parser/edit-syntax provenance, ordered operations (`delete:{path}`, `move:{source,destination}`, patch mutations), complete target set and execution binding — and emits either a complete normalized operation list or one bounded fail-closed failure. Unknown syntax, missing move endpoint, title-only intent, first-target-only location lists and raw-input/execution-binding mismatch are rejected without any side effect.
- Route destructive-shaped permission requests (ACP `delete`/`move` kinds, native delete/move titles, and multi-operation patch shapes) in `requestPermission` through the normalizer BEFORE the generic edit/write locations path, and authorize every target through the row-4 filesystem-policy decision: every deletion target and move source requires existing-target observation plus delete-role write authorization, every move destination and patch mutation target requires create/overwrite authorization, and trusted read-only skills targets are denied as sources and destinations. No approval depends on the first target alone; a patch whose first target is allowed and a later target escapes the boundary is denied with zero mutation attempts.
- **BREAKING on adoption:** native delete/move permission requests that previously fell through to unknown-tool rejection or were approved from their (possibly first-target-only) location list are now evaluated against the complete decoded operation set; an incomplete or unparseable target set is always denied instead of falling through.
- Reconcile the trusted-extension and client decision surfaces by exporting the normalizer + all-target decision table as the single shared module the later OMP restricted-tool adapter (row 14) must import: the same operation set and completeness verdict decide both surfaces, and an incomplete native location list can never authorize a larger patch on either side. This change ships the client-side consumption and the shared decision module plus conformance fixtures only; the extension-side handler wiring is row 14's owner.
- Keep YOLO behavior unchanged: destructive permission requests in YOLO remain auto-approved under the existing `yolo_mode` rule with no restricted clamp (D6); the documented non-ACP-execution limitation from row 4 still applies.
- Preserve bounded diagnostics: one bounded rejection reason per destructive denial from a finite added set (incomplete/unparseable intent, escaping/disallowed target, binding mismatch), reusing the existing rejection buffer, audit mirroring and static error messages; retry-prompt sections keep working.
- Keep the generic-command argument path gate exactly as-is: its lexical path-argument policy is unchanged here, and tool-inventory/provenance/default-deny expansion is a non-goal owned by `enforce-omp-restricted-tool-policy`.

## Capabilities

### New Capabilities

None; reuse the existing ACP integration capability.

### Modified Capabilities

- `acp-integration`: Add complete destructive-intent normalization, all-target destructive authorization, and a shared client/extension decision-surface requirement; amend the restricted-mode permission requirement so destructive-shaped requests bypass the first-target-only locations approval. Predecessor canonical-root, secure-access, sink-authorization and P0 compatibility requirements are consumed, not redefined.

## Impact

Eventual implementation owns new `src/acp/destructive-policy.ts` and `tests/acp/destructive-policy.test.ts`; amendments to the edit/write classification branch of `src/acp/client.ts` `requestPermission()` (destructive routing before locations approval, new rejection reasons through the existing recording/audit helpers); reuse of the row-4 `filesystem-policy.ts` decision (no second authorization convention); native-shaped P0 destructive fixtures extended for multi-delete, complete move, missing destination, first-allowed-then-escaping patch, unparseable patch and binding-mismatch cases in existing ACP test files; focused sections in `docs/AGENT_PERMISSIONS.md` (Layer 3 destructive routing, reason table) and one `CHANGELOG.md` entry.

Consume P0's `DestructiveIntentContract` and actual compatibility verdict, row-2 root/target observations and row-4 sink policy without redefining roots, IO primitives, expansion or write policy. No new configuration/environment field is introduced, so `config.example.yaml`, `.env.example` and `helm/values.yaml` remain intentionally unchanged. No dependency upgrade, compatibility shim, migration or command-policy change.

Non-goals owned elsewhere: the OMP trusted-extension `tool_call` handler and restricted tool-inventory/provenance/default-deny wiring that import this module (`enforce-omp-restricted-tool-policy`; its all-target destructive adaptation is a consumer of this contract, and any generic-command argument-gate hardening is likewise theirs); native OMP destructive decoding mechanism proof — the P0 destructive-intent boundary is recorded unresolved/incompatible at the pin, and that verdict gates application of this change exactly as with other downstream consumers (drafting proceeds, application halts, no speculative parser is invented here); recursive directory deletion semantics and IO primitives (`secure-acp-filesystem-access`/`canonicalize-acp-filesystem-roots`); client sink authorization and read-only trusted-skills rules (row 4); readiness gating (`gate-omp-policy-readiness`); LSP policy (row 15); staging payload recipes (row 16); network/search, packaging, pooled lifecycle mocks and the final docs pass (rows 17–22). Genuine predecessor incompatibilities remain application gates, not license to weaken the policy.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Consume P0 contract/verdict and row-2/4 exports; align normalizer and decision signatures | 0.75 |
| Implement destructive normalization with fail-closed completeness/binding validation | 2.00 |
| Route and authorize all targets in `requestPermission` with bounded reasons | 1.50 |
| Consumer-visible unit/mock/temp-filesystem tests incl. P0-shaped fixtures and conformance table | 2.00 |
| Permission docs and changelog (no config synchronization needed) | 0.50 |
| Applicable focused checks and spec verification, no live acceptance | 0.50 |
| Contingency for edge-case/review fixes | 0.75 |
| **Total hard ceiling** | **8.00** |

Core is 7.25 hours plus 0.75 hour contingency. No root/IO primitive, tool-inventory, extension-handler or command-gate work is hidden in this allocation.

## Batch:

depends-on: canonicalize-acp-filesystem-roots
depends-on: enforce-acp-filesystem-authorization

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| canonicalize-acp-filesystem-roots | Required observation API | Read-only import of root/target observations for every destructive target; move sources are existing-only requests, destinations may be prospective. Preserve fail-closed reasons; no second canonicalizer. Serialize edits to its module/tests. |
| enforce-acp-filesystem-authorization | Required sink policy | Reuses its `filesystem-policy.ts` decision and `SessionGateContext`; destructive targets are authorized through the same restricted/YOLO rules, never a parallel convention. Both amend the `requestPermission` edit/write branch — apply row 4 first and serialize; this change inserts destructive routing before the locations approval only. |
| establish-omp-compatibility-contracts | Application gate + data contract | Consumes `DestructiveIntentContract` and the actual destructive-intent verdict, which is recorded unresolved/incompatible at the pin; that verdict blocks application even with passing local fixtures, and no speculative native decoder may be invented to clear it. Do not edit its artifacts or fixtures' semantics; extend fixtures additively. |
| enforce-omp-restricted-tool-policy | Later consumer + reconciler | Row 14's extension-side all-target destructive adaptation and generic-command gate hardening import this module unchanged; its adapter conformance is tested against the table exported here. Shares `src/acp/client.ts`, `docs/AGENT_PERMISSIONS.md`, the rejection-reason vocabulary and `acp-integration`; serialize and extend, never fork, the normalizer. |
| gate-omp-policy-readiness | Ordering consumer | Readiness denial precedes this policy at the prompt gate; no destructive request reaches this evaluation before readiness passes. Shares only the client gate ordering and reason vocabulary. |
| cover-omp-mocked-acp-lifecycle / finish-omp-mocked-skill-handoff | Final regression/docs | Combined lifecycle mocks may reuse the conformance fixtures; keep per-path unit cases here and avoid duplicate same-path assertions; final docs pass extends rather than rewrites the destructive section. |

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
