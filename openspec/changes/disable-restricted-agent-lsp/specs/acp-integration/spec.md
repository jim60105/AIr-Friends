## ADDED Requirements

### Requirement: OMP Restricted Launch And Settings Both Carry The LSP Disable

For restricted OMP mode the factory SHALL assemble the full pinned candidate disable mechanism: the `--no-lsp` CLI argument (mapping to `enableLsp:false`) on top of the restricted overlay's already-pinned `lsp.enabled: false` setting consumed unchanged from the row-8 composition, and neither carrier alone SHALL be treated as complete suppression in documentation or tests until the lazy cold-start audit records its verdict.

#### Scenario: Restricted arguments carry the flag and the overlay pin
- **GIVEN** the factory assembles a restricted `omp acp` launch from the row-8 restricted composition
- **WHEN** the argument list is produced
- **THEN** it SHALL contain `--no-lsp` exactly once
- **AND** the ordered `--config` overlay set SHALL still be the row-8 restricted composition whose mode document carries `lsp.enabled: false`
- **AND** no LSP value SHALL be re-derived in the factory

#### Scenario: Native-YOLO OMP launch gains no LSP clamp
- **GIVEN** the factory assembles a native-yolo `omp acp` launch
- **WHEN** the argument list and overlay set are produced
- **THEN** no `--no-lsp` argument SHALL appear
- **AND** no `lsp.*` key SHALL appear in any native-yolo overlay file
- **AND** the trusted extension — the only carrier of LSP deny decisions — SHALL NOT be loaded for this launch

#### Scenario: The flag is the only LSP addition and the overlay pin stays put
- **WHEN** the restricted launch assembly is inspected
- **THEN** `--no-lsp` SHALL be the only LSP-related addition to the row-9 restricted argument list, gating startup discovery/warmup per the pinned compatibility evidence
- **AND** the row-8 overlay pin SHALL NOT be moved, duplicated, or removed by this change

### Requirement: OMP Lazy Cold-Start Route Is Audited Into A Decision Or An Honest Gate

The implementation SHALL audit the pinned OMP `v18.6.1` source (`2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`) for a lazy language-server cold-start route reachable from a restricted session's `edit`, `write`, or read-side diagnostic/format paths while `enableLsp:false` and `lsp.enabled:false` are in effect, and SHALL record exactly one of three verdicts with source symbols: no residual route, a restricted-tool-surface route, or a native-internal route.

#### Scenario: Residual tool-reachable route lands as an additive deny row
- **GIVEN** the audit finds a cold-start trigger that arrives as a consultable restricted tool call despite the flag and settings pin
- **WHEN** the inventory table is extended
- **THEN** the extension SHALL be additive data rows with citations on the existing `lsp-adjacent` route surface
- **AND** every pre-existing inventory row SHALL be unchanged
- **AND** the existing enforcement handler SHALL block a fixture call to that trigger fail-closed with a bounded reason

#### Scenario: Native-internal residual fails closed as a recorded gate
- **GIVEN** the audit finds a cold-start route that fires inside native tool execution with no consultable tool call
- **WHEN** the change is completed
- **THEN** an unresolved-gate record SHALL name the exact source symbols and `userDecisionRequired`
- **AND** the launch/overlay wiring SHALL still ship unchanged
- **AND** no artifact SHALL claim the restricted session cannot start a language server

#### Scenario: No mock certifies native suppression
- **GIVEN** any unit or mock fixture in this change's suite
- **WHEN** it passes
- **THEN** it SHALL be cited only as config/flag/decision-wiring evidence
- **AND** native restricted LSP suppression INCLUDING implicit startup SHALL remain listed unverified on the user runtime checklist

#### Scenario: Verdict (a) records the composed mechanisms as the supported path
- **GIVEN** the audit finds no residual route
- **WHEN** a verdict is recorded
- **THEN** the composed mechanisms SHALL be cited as the supported suppression path pending user runtime verification

#### Scenario: Verdict (b) blocks through additive rows on the wired handler
- **GIVEN** the audit finds a residual route reachable through the restricted tool surface
- **WHEN** the restricted tool inventory is extended
- **THEN** the route SHALL be blocked by ADDITIVE default-deny rows keyed on the existing `lsp-adjacent` route surface, enforced by the already-wired handler without any new wiring
- **AND** no shipped inventory row's semantics SHALL be edited

#### Scenario: Verdict (c) ships the supported parts behind an honest gate
- **GIVEN** the audit finds a residual native-internal route no configuration decision can reach
- **WHEN** the change ships
- **THEN** the supported parts SHALL ship and the residual SHALL be recorded as an unresolved gate with `userDecisionRequired`
- **AND** no documentation, test name, or changelog entry SHALL describe restricted LSP suppression as complete

### Requirement: OpenCode Restricted Agent Denies LSP Without Touching YOLO

The `build`/restricted OpenCode agent configuration SHALL NOT grant the `lsp` permission, the existing agent-level `"*": "deny"` default SHALL deny the explicit tool, the `yolo` agent block SHALL remain byte-identical to its current permissive policy, and no global top-level `lsp` disable SHALL be applied while restricted-only removal is in effect.

#### Scenario: Build agent denies the lsp tool, yolo keeps everything
- **WHEN** the restricted OpenCode agent configuration is parsed
- **THEN** the `build` agent's permission map SHALL contain no `lsp` allow grant and its default deny SHALL cover the tool
- **AND** the `yolo` agent's permission content SHALL be unchanged
- **AND** no top-level global `lsp: false` (or equivalent kill-switch) SHALL be present

#### Scenario: Unsupported implicit scoping gates application rather than bleeding
- **GIVEN** the pinned-source audit shows implicit language-server startup is controllable only through the process-global `lsp` configuration
- **WHEN** the change completes
- **THEN** the global disable SHALL NOT be applied
- **AND** the per-agent explicit-tool deny SHALL remain applied
- **AND** the recorded incompatibility SHALL state that restricted-only implicit suppression is unattainable on the pinned `1.18.21` configuration and requires a user design decision

#### Scenario: Version bump is not an implementation shortcut
- **GIVEN** the audit suggests a newer OpenCode might scope implicit startup per-agent
- **WHEN** this change is implemented
- **THEN** the `1.18.21` pin SHALL be consumed as-is
- **AND** any bump SHALL be recorded as a separate user decision, not applied here

#### Scenario: Implicit startup is resolved by the pinned-source audit
- **GIVEN** pinned OpenCode `1.18.21`
- **WHEN** the implementation determines whether per-agent permission denial also suppresses IMPLICIT language-server startup (automatic server boot with read/edit/write diagnostics) or whether server boot is driven only by the process-global `lsp` configuration
- **THEN** the audit SHALL record which mechanism drives server boot
- **AND** the global disable SHALL NOT be applied when it would also remove YOLO's LSP

#### Scenario: Unscopable implicit startup still ships a strict improvement
- **GIVEN** implicit startup cannot be scoped restricted-only by the pinned `1.18.21` configuration
- **WHEN** the change completes
- **THEN** the explicit-tool deny SHALL still land as a strict improvement
- **AND** the incompatibility SHALL be recorded with `userDecisionRequired`
- **AND** no artifact SHALL present restricted LSP removal as complete

### Requirement: Restricted-Only LSP Evidence And Documentation Boundary

The change's documentation and handoff SHALL separate, per agent, what the pinned-source audit claims, what unit/mock tests mechanically prove, and what remains user-owned runtime verification: restricted launch/overlay wiring and YOLO exemption are unit/mock-provable, while restricted native LSP removal including implicit startup and native YOLO LSP availability SHALL appear on the user runtime checklist marked unverified.

#### Scenario: Documentation mirrors the recorded verdicts
- **GIVEN** the audits recorded their verdicts for both agents (supported, additive-row extension, or `userDecisionRequired` gate)
- **WHEN** the LSP documentation section is written
- **THEN** each agent's verdict, mechanism, and evidence limit SHALL be stated without upgrading an unresolved verdict into a supported claim
- **AND** the checklist SHALL carry the native implicit-startup and YOLO-availability observations as explicit unverified items

#### Scenario: Consumer-visible suite covers the wiring without native claims
- **WHEN** the restricted-LSP unit/mock suite runs
- **THEN** it SHALL assert: restricted launch carries `--no-lsp` plus the overlay pin; YOLO launches carry neither (both agents); the OpenCode `build` agent denies `lsp` while the `yolo` agent block is unchanged and no global disable exists; the cold-start decision fixture yields deny on a residual-route fixture (verdict b) or the gate record is present and complete (verdict c); and every test label SHALL describe wiring, never native suppression

#### Scenario: Unit and mock suites own only the wiring claims
- **WHEN** the change's documentation classifies what its suite mechanically proves
- **THEN** the restricted launch/overlay carrying the disable, the OpenCode restricted agent denying the explicit tool while `yolo` keeps it, the cold-start decision path returning deny on fixtures, and YOLO exemption on both agents SHALL be presented as unit/mock-provable

#### Scenario: AGENT_PERMISSIONS.md reflects the restricted tool list and verdicts
- **WHEN** `docs/AGENT_PERMISSIONS.md` documents the restricted agent
- **THEN** it SHALL no longer list `lsp` among the restricted `build` agent's allowed read-only tools
- **AND** it SHALL state the recorded per-agent mechanism verdicts with their evidence limits
