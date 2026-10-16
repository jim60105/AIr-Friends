# Tasks

## 1. Correct bundled capability and browser text (2 hours)

- [ ] 1.1 Update `prompts/agent_permissions.md` to separate shared restricted rules from OpenCode-only pre-gate denials, qualify shared-workspace writes by existing authorization/extension policy, and express OMP stdout handling as a recommendation while retaining native tool lifecycle advice.
- [ ] 1.2 Condition browser operator-policy assertions in `prompts/browser_automation.md` on restricted mode; preserve tolerated fd redirects and per-segment chains, browser close and the 403/429 fallback. Remove no policy from enforcement code or authored agent configuration.

## 2. Select corrective guidance from session context (1.5 hours)

- [ ] 2.1 Extend the existing self-research correction builder and its callsite with explicit selected `agentType` and resolved `yoloDecision.enabled`; implement design D2's four-mode wording without changing same-session retry behavior, note paths, trusted root delivery or bounded rejection formatting.
- [ ] 2.2 Preserve the existing missing-response delivery builder and its recipes; document the completed read-only audit of its edit/write recommendation so the correction does not introduce a second delivery convention.

## 3. Delivered-prompt regressions (2 hours)

- [ ] 3.1 Add table-driven rendering assertions for every existing entry template including the affected fragments, both engines and both modes, plus permitted/forbidden shared-workspace writes. Assert actual allowed/denied wording, fd-redirect tolerance and absence of OpenCode attribution in OMP.
- [ ] 3.2 Extend `tests/core/session-orchestrator.test.ts` no-note correction coverage for each engine/mode, including a per-session mode differing from global defaults; inspect delivered retry text and retain existing one-retry, audit/metric, rejection diagnostics, completion-fingerprint and no-platform-reply assertions.
- [ ] 3.3 Preserve literal skills-root/session/staging and missing-response recovery regressions, including background-completion advice and native-YOLO LSP denial; do not count rendered wording as native shell execution evidence.

## 4. Documentation and final verification (1 hour)

- [ ] 4.1 Update engine documentation and the release note with the wording correction, unchanged enforcement posture and affected operator override fragments.
- [ ] 4.2 Run focused prompt/retry tests after all edits, then project type/lint/format checks and strict OpenSpec validation. Record exercised results without claiming an observed redirection denial or newly tested native permission behavior.
