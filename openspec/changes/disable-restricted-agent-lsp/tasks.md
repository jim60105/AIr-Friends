# Tasks: disable-restricted-agent-lsp

## 1. Pinned-source audits (2.00 hours)

- [ ] 1.1 Audit OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` for every consumer of `enableLsp`/`lsp.enabled`/`lsp.diagnosticsOnWrite`/`lsp.diagnosticsOnEdit`/`lsp.formatOnWrite` (`packages/coding-agent/src/lsp/tool.ts`, `packages/coding-agent/src/tools/settings.ts`, `packages/coding-agent/src/main.ts`, the edit/write/read tool paths and tool construction), and determine whether a restricted session's first `edit`/`write` (or a read-side diagnostic/format route) can cold-start a language server with `enableLsp:false` + `lsp.enabled:false` in effect. Record exactly one design-D2 verdict (a/b/c) with exact source symbols; the verdict is data referenced by docs and tests. Verification: verdict record exists with symbols; no verdict text asserts executed-native behavior.
- [ ] 1.2 Resolve the exact upstream source revision for OpenCode `1.18.21` packaging and audit whether the per-agent `permission.lsp` denial gates ONLY the explicit `lsp` tool or also the automatic language-server boot attached to read/edit/write diagnostics, and whether the top-level `lsp` config disable is process-global. Record the design-D3 outcome: restricted-only implicit scoping supported / unsupported-gate / unresolved with the missing evidence named. Verification: outcome record cites source files; a global-disable-bleeds-YOLO finding, if present, is explicit.

## 2. OMP restricted wiring (0.75 hours)

- [ ] 2.1 Add `--no-lsp` to the restricted branch of `src/acp/agent-factory.ts` `buildBaseAgentConfig()`'s assembled OMP argument list (row 9's assembly; the native-yolo branch and OpenCode branch untouched; consume row 8's `--config` overlays opaquely — never re-derive or relocate the `lsp.enabled:false` pin). Verification: unit test asserts `--no-lsp` appears exactly once in restricted args, the ordered `--config` set still ends with the restricted mode document carrying the pin, and the native-yolo args contain no `--no-lsp`.

## 3. OpenCode restricted configuration (1.00 hours)

- [ ] 3.1 Remove the `"lsp": "allow"` entry from the `build` agent permission map in `agent-config/opencode.json` so the agent's `"*": "deny"` default denies the explicit tool; leave the `yolo` agent block byte-identical and add NO top-level global `lsp` disable. If task 1.2 showed implicit startup is per-agent controllable via this same permission, record that; otherwise record the D3 gate (`userDecisionRequired`, pin consumed as-is, any version bump noted as a separate decision, never applied). Verification: parsed-config test asserts build's map has no `lsp` grant and default-deny coverage; a structural test asserts the serialized `yolo` block equals its pre-change content and no global `lsp` key exists at top level; the recorded outcome (supported/gate) is present in docs.

## 4. Cold-start decision path — conditional (1.00 hours)

- [ ] 4.1 Verdict (b) only: append ADDITIVE default-deny rows for the LSP cold-start trigger to the 14a inventory table in `src/acp/omp/tool-inventory.ts` on the existing `lsp-adjacent` route surface, with design-§6/P0 citations, without editing any shipped row's semantics or adding a new decision shape; enforcement rides 14b's existing handler unchanged. Verification: unit fixture presents the trigger call, the composed decision denies with the bounded reason, every pre-existing 14a table-driven test passes unmodified.
- [ ] 4.2 Verdict (c) and/or OpenCode D3 gate: record the unresolved gate(s) as machine-readable status data (agent, exact source symbols, uncovered startup path, `userDecisionRequired`) consumed by the docs task and the suite; verify the launch/config wiring still ships and no artifact text claims complete restricted suppression while a gate is open. Verdict (a): verify the verdict record cites the audited consumers and that no inventory change was made.

## 5. Consumer-visible unit/mock tests (2.00 hours)

- [ ] 5.1 `tests/acp/restricted-lsp.test.ts`: OMP restricted launch carries `--no-lsp` AND the row-8 overlay pin (composition consumed, not copied); OMP native-yolo launch carries no `--no-lsp` and no `lsp.*` key in its overlays (re-assert row 8's invariant) and loads no trusted extension; the residual-route decision fixture yields fail-closed deny through the existing handler composition (verdict b) or the gate record is complete and every doc string avoids a completeness claim (verdict c/a). Every test name SHALL describe wiring, never native suppression.
- [ ] 5.2 OpenCode configuration tests: parse `agent-config/opencode.json` — the `build` agent denies `lsp` via its default with no allow grant present; the `yolo` permission content is byte-equal to the recorded pre-change fixture; no top-level global LSP kill-switch exists; assert the documented verdict pairing (explicit deny applied + implicit scoping supported-or-gated) matches the recorded audit outcome, so a doc/code drift fails the suite.
- [ ] 5.3 Extend `tests/acp/agent-factory.test.ts` for the flag addition without touching row 9's existing invariants (no-YOLO-flag, `--config` ordering, disjoint mode overlay sets all still pass); run the repository's existing Deno test patterns over `tests/acp/` and record green results as wiring evidence only.

## 6. Documentation and changelog (0.75 hours)

- [ ] 6.1 `docs/AGENT_PERMISSIONS.md`: remove `lsp` from the restricted `build` agent's allowed read-only tool row, add an LSP section stating per agent the mechanism, recorded audit verdict (supported / additive-row / `userDecisionRequired` gate), and the evidence limit — unit/mock proves wiring, never native suppression.
- [ ] 6.2 Handoff checklist: carry the design §15 lines — restricted LSP removal including implicit startup on BOTH agents, native YOLO LSP availability on both agents — marked unverified until user observation; keep source claims, mock evidence, and runtime evidence in separate columns.
- [ ] 6.3 `CHANGELOG.md` entry under Unreleased: restricted OpenCode `build` agent loses the `lsp` permission and restricted OMP launches add `--no-lsp`; state the per-agent verdicts honestly, including any open `userDecisionRequired` gate; serial-append, do not rewrite sibling entries.

## 7. Verification (0.25 hours)

- [ ] 7.1 Run `openspec validate disable-restricted-agent-lsp --strict` plus the touched unit/mock suites once; confirm zero new config/env/Helm fields (so `config.example.yaml`, `.env.example`, `helm/values.yaml` stay untouched — if implementation surfaces any field, synchronize all three in this change); confirm no edited file outside proposal §Impact was modified and no predecessor artifact was rewritten.
