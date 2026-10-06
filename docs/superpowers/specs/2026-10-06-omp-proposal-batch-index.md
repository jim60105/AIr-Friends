# OMP Integration Proposal Batch Index

- Date: 2026-10-06
- Design: `docs/superpowers/specs/2026-10-06-omp-integration-design.md` (approved).
- Status: 24 OpenSpec proposals generated one-by-one on `master`, each `openspec
  validate --strict` valid, each budgeted <=8h including implementation, unit/mock tests, and
  documentation. One whole-batch rubber-duck review ran after completion; its two blocking
  findings are fixed in-row (extension dependency closure in row 20 D5 + row 14b import rule;
  opencode.json baseline rule in row 15). No proposal is implemented, applied, or archived.
- Acceptance contract: automated evidence is unit + mock integration only. All real-runtime
  verification (design section 15) is user-owned and ships unverified.

## 1. Application order (single writer, serial)

Apply strictly in this order. The order is a topological sort that also serializes every
shared-file claim the proposals register.

| #  | Change                                | Batch row     | Budget |
| -- | ------------------------------------- | ------------- | ------ |
| 1  | establish-omp-compatibility-contracts | P0            | 8.0h   |
| 2  | canonicalize-acp-filesystem-roots     | P1a           | 7.75h  |
| 3  | secure-acp-filesystem-access          | P1b           | 8.0h   |
| 4  | enforce-acp-filesystem-authorization  | P1c           | 8.0h   |
| 5  | normalize-acp-destructive-targets     | P1d           | 8.0h   |
| 6  | modernize-acp-session-config          | P2            | 8.0h   |
| 7  | add-omp-agent-configuration           | P3a           | 8.0h   |
| 8  | translate-omp-owned-settings          | P3b           | 8.0h   |
| 9  | spawn-mode-scoped-omp-agents          | P3c           | 8.0h   |
| 10 | isolate-omp-process-pools-by-mode     | P4a           | 8.0h   |
| 11 | restore-mode-owned-acp-sessions       | P4b           | 7.5h   |
| 12 | guard-omp-executable-discovery        | P5a           | 8.0h   |
| 13 | gate-omp-policy-readiness             | P5b           | 8.0h   |
| 14 | define-omp-restricted-tool-decisions  | P5c-i (14a)   | 7.0h   |
| 15 | harden-acp-command-path-gate          | P5c-iii (14c) | 5.5h   |
| 16 | wire-omp-restricted-tool-enforcement  | P5c-ii (14b)  | 8.0h   |
| 17 | disable-restricted-agent-lsp          | P5d           | 8.0h   |
| 18 | make-skill-staging-agent-portable     | P6            | 8.0h   |
| 19 | control-omp-url-fetch-transport       | P7a           | 8.0h   |
| 20 | adapt-omp-web-search                  | P7b           | 8.0h   |
| 21 | adapt-omp-public-code-search          | P7c           | 8.0h   |
| 22 | package-pinned-omp-runtime            | P8            | 8.0h   |
| 23 | cover-omp-mocked-acp-lifecycle        | P9a           | 8.0h   |
| 24 | finish-omp-mocked-skill-handoff       | P9b           | 8.0h   |

Ordering notes:

- 14c (harden-acp-command-path-gate) is independent of 14a/14b but is placed between them so
  every `src/acp/client.ts` edit (rows 4, 5, 13, 14c) precedes the extension-side consumers.
- The trusted-extension tree is strictly serial: 12 -> 13 -> 14b -> 17(row-17 fetch) ->
  18(search); row-19's 6th slot is reserved-but-unconsumed; row 20 cuts digests after the final
  content lands. Any later content into `/opt/air/omp` inputs must recut
  `PACKAGE-MANIFEST.sha256` in the same commit (row 20 D5 invariant).
- Rows 21 (code search) and 22 depend on rows 17-20 exactly per their `## Batch` lines.

## 2. Dependency-errata and contracts the index owns

- Row 12 (`guard-omp-executable-discovery`) declares an extra dependency on
  `canonicalize-acp-filesystem-roots` (row 2) beyond the pre-split contract line (1,8,9).
  Accepted: it consumes row-2 canonical identity read-only; numbered order already satisfies it.
- `src/utils/omp-paths.ts`: authored/owned by row 9; rows 10/16 are read-consumers; row 20 holds
  the sole authorized append-only image-exports seam (image-first resolution helpers).
- `agent-config/opencode.json`: uniquely edited by row 15 (build-agent permission map only;
  `yolo` block byte-identical). Rows 23/24 byte-compare OpenCode flows against the file AS LANDED
  after row 15, never a hardcoded pre-batch baseline (row 15 conflict note, batch-review fix).
- `src/acp/client.ts` serial chain: row 4 (sink cutover) -> row 5 (destructive routing) -> row 13
  (readiness prompt gate) -> row 14c (command-gate branch) -> row 14b consumes none of it ->
  row 18 avoids it entirely (payload.ts doc/tests only). No parallel edits.
- `agent-factory.ts` serial chain: row 7 (no omp branch) -> row 8 (consume-only selectors) ->
  row 9 (omp launch branch owner) -> row 15 (restricted `--no-lsp` only) -> row 18 (retry-builder
  surfaces only) -> row 20 (must not touch).
- `agent-connector.ts` serial chain: row 6 (config/model/reasoning + caches) -> row 10 (mode
  acquisition) -> row 11 (recovery; additive trailing-options only) -> row 13 (readiness hook
  attach).
- Extension dependency closure (batch-review blocking fix): the installed extension resolves ALL
  imports inside `/opt/air/omp/extension` via row 20's build-time copy of 14a pure modules into
  `_daemon/` + one `mod.ts` barrel; dev mode resolves the same committed files; the extension
  never imports `/app/src`. Row 20 owns the closure list; adding an extension-consumed pure
  module extends the list and the digest manifest in the same change.
- Row 21 seams (pre-declared, flagged): at most one test-only executable/command-override hook on
  the row-9 factory launch path, only if no existing injection point suffices. Row 24 may need one
  test-only ephemeral `SKILL_API_PORT`/`SKILL_JWT_DIR` spawn-env control; both decide seam-vs-no-
  seam at implementation and name it in the commit body.
- Row 24 owns final CHANGELOG consolidation (row 21 explicitly deferred it); row 22's landed
  entry is preserved/reconciled, not duplicated. Row 24's config-trio audit is a verification
  backstop for fields introduced by rows 7/20 (`AGENT_DEFAULT_TYPE` omp value,
  `AGENT_OMP_MIN_VERSION`).
- Row 21 deletion discipline is bounded to OMP-batch-owned test files; OpenCode-inherited
  regression cases are never deletable as superseded (batch-review fix).

## 3. User decisions required (consolidated decision sheet)

These gates were discovered honestly during proposal generation. They BLOCK SECURITY
CONSUMPTION of specific boundaries at the pinned OMP v18.6.1 / OpenCode 1.18.21; they do not
block proposal generation or local mock work. Each artifact carries `userDecisionRequired`
markers; applying the batch means shipping fail-closed behavior at every unresolved seam.

| Gate                                                                           | Verdict at pin                                                                                                                                   | Where recorded              | Consequence if undecided                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-import executable-discovery exclusion                                      | no-supported-mechanism (unresolved)                                                                                                              | P0 ledger; row 12           | Restricted OMP `session/new`+`load` fail closed (bounded ACP error)                                                                                                                                                                                     |
| Critical-skill canonical ownership                                             | incompatible name-only trust; selection unresolved                                                                                               | P0 ledger; row 12           | Critical skills unowned-resolution denied; legacy HOME/npx copies lose trust                                                                                                                                                                            |
| Authoritative approval-record reset                                            | INCOMPATIBLE (deep-merge loses null barrier)                                                                                                     | P0 ledger; rows 8/9/14a     | Lower-layer grants may survive; restricted runtime default-deny (14a/14b) is the operative boundary                                                                                                                                                     |
| Complete destructive-intent decoding                                           | UNRESOLVED                                                                                                                                       | P0 ledger; rows 5/14a/14b   | Undecodable destructive shapes deny fail-closed                                                                                                                                                                                                         |
| Authenticated readiness control channel + native-to-ACP identity binding       | PARTIAL; channel no-supported-mechanism                                                                                                          | P0 ledger; row 13           | `ReadinessChannel` seam unimplemented -> every real restricted session denied at the first-prompt gate                                                                                                                                                  |
| MCP admission mechanism basis                                                  | needs-mechanism-audit (no P0 boundary row)                                                                                                       | 14a/14b                     | Operator-MCP refresh admission runs the decision; basis never inflated to supported                                                                                                                                                                     |
| OMP restricted-only LSP incl. lazy cold-start                                  | CANDIDATE                                                                                                                                        | P0 ledger; row 15           | `--no-lsp` + overlay pin ship; cold-start residual gets additive deny row or gate                                                                                                                                                                       |
| OpenCode restricted-only LSP mechanism                                         | UNAUDITED at 1.18.21                                                                                                                             | row 15                      | Explicit `build` deny lands as strict improvement; NO global disable bleed; full removal gated                                                                                                                                                          |
| Native transport bypasses (loadPage/fetchBinary redirect:follow)               | PARTIAL                                                                                                                                          | P0 ledger; rows 17/18       | Completed routes only via registerTool replacement; bypass routes stay blocked_pending_adapter                                                                                                                                                          |
| D4 public code-search parity                                                   | PREMISE FALSE: OpenCode 1.18.21 removed codesearch upstream (sst/opencode 2481dde, 2026-05-12); no OMP backend under the approved credential set | row 19; docs/OMP_NETWORK.md | Decide: provision a read-only code-search credential via row-7's approved path (flips reserved 6th-slot registerTool completion, new proposal), or accept the documented capability regression. Never a keyless-scraping or secret-promotion workaround |
| Row-15 audit OpenCode version bump (if the LSP mechanism needs newer OpenCode) | deferred                                                                                                                                         | row 15 caveat               | Separate user decision; pin stays 1.18.21                                                                                                                                                                                                               |
| Digest-manifest recuts                                                         | invariant                                                                                                                                        | row 20                      | Any content change to `/opt/air/omp` inputs recuts `PACKAGE-MANIFEST.sha256` in the same commit                                                                                                                                                         |

## 4. Coverage map (design -> owner)

Design sections 5-12 requirement rows all have owning proposals; the whole-batch review found no
coverage orphans and no DAG cycles. Highlights: section 5 pooling/state (9/10/11), section 6
capability matrix (2/3/4/5/14a/14b/14c/15/17/18/19), section 7 settings/discovery/readiness
(8/12/13), section 8 sinks/destructive (2/3/4/5), section 9 network (17/18/19), section 10 flow
(6/9/10/11/13), section 11 staging (16), section 12 settings/packaging (7/8/20), section 14
mock-only acceptance (per-row suites + 23/24 combined), section 15 checklist (24 ships
`docs/USER-RUNTIME-VERIFICATION.md`, all items unverified until user observation).

## 5. Evidence limits (binding on every row)

Mock/temp-filesystem tests certify this codebase's decisions only. No mock certifies: native
trusted-extension load, pre-import enforcement, native ACP delegation shapes, restricted LSP
suppression incl. implicit startup, cross-mode native load rejection, native fetch/search
traffic routing, digest/asset bytes, or image/architecture behavior. Those are design section-15
user-owned checks, tracked in `docs/USER-RUNTIME-VERIFICATION.md` at row 24.
