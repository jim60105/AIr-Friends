# Tasks: disable-restricted-agent-lsp

## 1. Pinned-source audits (2.00 hours)

- [ ] 1.1 Read decision 5 and the dated approved-design clarification; audit OMP v18.6.1 `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` enableLsp/lsp consumers, tool construction and read/edit/write diagnostics/format cold-start in both modes. Record exact symbols and residual outcomes without clearing inherited verdicts or claiming mock native evidence.
- [ ] 1.2 Audit OpenCode 1.18.21 tree `826d9ad46a22bef0294998e08daa3c4904fea28f` explicit permission.lsp and automatic diagnostics/server boot separately. Preserve implicit-scoping incompatibility and name remaining startup coverage; no global clamp or version bump.

## 2. OMP both-mode wiring (0.75 hours)

- [ ] 2.1 Add `--no-lsp` to BOTH OMP factory launch branches over the unchanged restricted overlay pin. Row 17 lands before row 25 `pin-omp-yolo-lsp-settings`; do not edit agent-config/omp/native-yolo.yml or src/acp/omp-settings.ts content/composition/validator, which row 25 exclusively owns. Verify both modes carry the flag, no unrelated settings/state/env change, and native YOLO keeps native approval mode with no restricted handler.

## 3. OpenCode both-agent configuration (1.00 hours)

- [ ] 3.1 Apply strictly after numbered row 15 harden-acp-command-path-gate; serialize agent-config/opencode.json writes. Explicitly set build.permission.lsp and yolo.permission.lsp to deny. Keep all unrelated predecessor permission entries unchanged; no top-level/global LSP clamp. This intentionally changes the yolo block only for LSP.

## 4. Conditional restricted cold-start decisions (1.00 hours)

- [ ] 4.1 For consultable restricted residual routes only, append cited default-deny data rows on existing lsp-adjacent inventory surfaces; do not alter shipped row semantics or handler wiring. Verify composed fixture denials with bounded reasons.
- [ ] 4.2 Record native-internal, native-YOLO and implicit OpenCode coverage gaps with exact symbols and preserved verdicts. Keep decision 5 DECIDED independently from native support; incomplete coverage must not produce a complete-suppression claim.

## 5. Consumer-visible unit/mock tests (2.00 hours)

- [ ] 5.1 Test both-mode `--no-lsp` flags and unchanged restricted overlay pin, correct overlay order/state isolation, and no restricted handler/approval records in YOLO. Revise old no-YOLO-LSP-flag assertions only; settings asset/composition/validator tests belong to row 25. Do not delete unrelated factory invariants.
- [ ] 5.2 Parse OpenCode config and assert explicit lsp deny for build and yolo, no global clamp, and unrelated permission entries equal the file as landed after numbered row 15. Never require full yolo byte equality across the LSP change.
- [ ] 5.3 Test conditional restricted cold-start denials and residual evidence records without native suppression claims. Supply final lifecycle/handoff baselines from opencode.json as landed after numbered rows 15 and 17.

## 6. Documentation and changelog (0.75 hours)

- [ ] 6.1 Update AGENT_PERMISSIONS.md with LSP-all-off disposition for OMP restricted+YOLO and OpenCode build+yolo, explicit per-agent denial, selected OMP carriers, and distinct implicit-startup evidence limits.
- [ ] 6.2 Carry all four native implicit-startup observations to the user runtime checklist marked unverified; preserve pinned incompatible/unresolved verdicts and separate source, mock and runtime evidence.
- [ ] 6.3 Append CHANGELOG entry for both-agent/both-mode LSP denial and residual coverage, with no global-clamp or native-suppression claim.

## 7. Verification and contingency (0.50 hours)

- [ ] 7.1 Run strict OpenSpec validation and focused config/factory/decision tests once; no live agents or language-server observation. Confirm no new config/env/Helm fields (synchronize trio only if eventual implementation introduces one), declared impact only, and row 25 retains exclusive native-yolo settings content/validator and same-change digest ownership.
- [ ] 7.2 Contingency reserve 0.25h within the 8.00h ceiling; report both-mode factory flags, row 17 → row 25 serialization, shared-file baseline and every unverified runtime property.
