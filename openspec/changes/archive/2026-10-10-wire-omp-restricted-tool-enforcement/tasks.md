## 1. Predecessor consumption and slot survey (0.75 hours)

- [x] 1.1 Read 14a exports, row 12 trusted tree/ownership/resourceGeneration, row 9 restricted launch identity, and pinned emitToolCall/getAllTools semantics. Confirm this change owns synchronous slot registration/attachment and live registryEpoch derivation; row 13 is removed and no readiness artifact is consumed.

- [x] 1.2 Re-verify from pinned source (`extensions/runner.ts` `emitToolCall` blocking handler errors/timeouts; `extensions/types.ts` synchronous registration + `getAllTools` source metadata) that the handler-body attach rides supported surfaces, and record each mechanism element with its ledger tier. Confirm synchronous slot registration/attachment uses the pinned surfaces, with no readiness establishment or channel.

## 2. Handler body with per-call composition (1.75 hours)

- [x] 2.1 Synchronously register the restricted handler slot and attach `enforcement.ts` (sibling in the contracted trusted-extension tree): `ToolCallObservation` assembled fresh per call (current recorded origin from the live tool-metadata surface, current `registryEpoch`, current `resourceGeneration`, decoded input shape) and the composition order — inventory decision → provenance decision → alternate-(capability, route) table → destructive-shaped calls to the destructive decision → advisory approval-record cross-check — with zero wiring-owned decision tables. Verify no memoization across calls, no catch-and-continue, and that an allow-gated/sink-routed/admitted outcome returns only the named completing authority.

- [x] 2.2 Implement the bounded `EnforcementError` shape: one code from the finite union of 14a reason codes plus wiring codes (`rejected_enforcement_seam`, `rejected_stale_observation`, `rejected_pending_adapter`), fields limited to capability id, route surface, origin category, stale element, seam marker; surfaced through the pinned tool-call error path row 12 already uses for bounded ACP errors. Verify no path content, payload, model text, secret, or token field is representable, no `requestPermission()`/elicitation call on any block path, and no feeding of the retry-permission-rejection buffer.

## 3. Registry-refresh re-admission (1.00 hours)

- [x] 3.1 Implement the post-start MCP refresh path: advance `registryEpoch` from the live tool-metadata observation (never chat content, never name-only diff), rely on per-call fresh observation (no cached records to invalidate — assert the absence of any cache), and re-invoke the MCP-admission decision for the fresh epoch per affected call. Verify refreshed-owned tools proceed only to the completing authority, refreshed-untrusted tools stay denied, zero elicitation/form calls occur, no one-shot acknowledgement is representable; registry epoch and resource generation are the only freshness inputs.

## 4. Restricted-only posture and seam fail-closed tables (1.00 hours)

- [x] 4.1 Attach the handler body only in the restricted-process registration branch gated on the module's own restricted-mode launch identity (structural exemption — no mode check inside the decision path), and make the handler entry fail closed on a non-restricted observed process identity. Verify the YOLO bootstrap branch registers nothing and loads no restricted approval records (D6), and OpenCode never loads the extension.

- [x] 4.2 Implement composition/ordering, freshness/error data and inherited verdicts with DECIDED dispositions. No readiness channel/state or handshake seam. Keep MCP audit-needed basis, record-reset incompatible evidence with settings-discovery-path control, destructive unresolved evidence with complete ACP-mediated boundary, and pending-adapter denials. No status relabel.

## 5. Consumer-visible unit/mock tests (1.75 hours)

- [x] 5.1 `tests/acp/omp-tool-enforcement-wiring.test.ts`: denied-tool fixture (unlisted name) reaches the fail-closed bounded error; wrong-origin same-name fixture blocked while owning-origin proceeds to completing authority; every alternate-(capability, route) pair fixture blocked beneath an allowed ordinary route; surviving-lower-layer `allow` fixture never short-circuits (composition-order test); stale-epoch and stale-generation fixtures deny re-observe; handler-throw fixture fails closed; every error inspected for finite fields and absence of payload/secret content; no permission/elicitation call asserted absent.

- [x] 5.2 Live-not-cached provenance test: mutate the registry fixture's recorded origin between two identical calls and assert the decision changes (a memoizing implementation fails). Refresh suite: post-start owned-MCP refresh re-admitted on the fresh epoch with zero interaction calls; refreshed-untrusted stays denied; stale-after-admission re-denies (no one-shot ack); epoch-advance and stale-resourceGeneration denial use live registry observations only. YOLO fixture registers no handler; OpenCode flow loads no extension handler; non-restricted entry fails closed.

- [x] 5.3 Test fail-closed record-survival, incomplete destructive input, pending adapter and provenance fixtures; preserve inherited verdicts and DECIDED dispositions. Label synthetic tool observations and assert no mock claims native invocation/enforcement or client-observable readiness. Reuse 14a/4/5/12 fixtures unchanged; no removed row-13 suite dependency.

## 6. Documentation and changelog (0.75 hours)

- [x] 6.1 Write OMP_ENFORCEMENT.md composition/freshness/refresh/error tables and DECIDED dispositions with pinned verdicts unchanged; cross-link tool-policy and permission docs; append CHANGELOG. Record no readiness handshake, accepted runner.emit extension-load risk, non-YOLO native approval plus client ACP fallback, and unverified real handler invocation/block/live provenance checklist. No OMP_READINESS.md dependency.

- [x] 6.2 Verify `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain untouched because the change introduces zero new configuration or environment fields; if implementation surfaces any new field, synchronize all three in this change rather than deferring.

## 7. Verification and contingency (1.00 hours)

- [x] 7.1 Run repository `fmt:check`, `lint`, `check`, and the focused unit suites (`tests/acp/omp-tool-enforcement-wiring.test.ts` plus the unmodified 14a/4/5/12 suites), plus `openspec validate wire-omp-restricted-tool-enforcement --strict`; report only exercised outcomes; verify no task launches a real `omp`, agent, provider, container, or bwrap.

- [x] 7.2 Use at most the embedded contingency for review fixes, delivering the complete wiring, tests, and docs within **8 hours total** (0.75 + 1.75 + 1.00 + 1.00 + 1.75 + 0.75 + 1.00). Verify the deliverable is complete with unresolved mechanism evidence preserved and every actual policy denial fail-closed, zero decision logic forked from 14a, zero readiness/prompt-gate changes, and no claim that a mock certifies native invocation, enforcement, reset, or decoding.
