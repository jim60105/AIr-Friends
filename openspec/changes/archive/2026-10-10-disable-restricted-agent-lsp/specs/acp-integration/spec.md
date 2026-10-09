## ADDED Requirements

### Requirement: OMP Both Modes Carry The LSP Disable

OMP restricted and native-YOLO sessions SHALL both carry `--no-lsp` in their factory launch arguments. Restricted mode SHALL retain the existing `lsp.enabled: false` overlay pin. Row 17 SHALL land before row 25, which exclusively owns the native-YOLO overlay LSP pin and settings content/composition/validator cutover. No restricted tool policy SHALL be copied into YOLO.

#### Scenario: Restricted flag and settings pin compose
- **WHEN** a restricted OMP launch is assembled
- **THEN** --no-lsp SHALL appear exactly once and the ordered owned overlays SHALL retain the restricted lsp.enabled false pin
- **AND** native implicit-startup suppression SHALL remain unverified until user observation

#### Scenario: Native-YOLO carries its own disable
- **WHEN** a native-YOLO OMP launch and mode overlay are assembled
- **THEN** its launch arguments SHALL carry --no-lsp exactly once, independently of the later row-25 settings pin
- **AND** its native approval posture and mode-isolated state SHALL remain unchanged with no restricted handler or approval-record load

### Requirement: OpenCode Both Agents Explicitly Deny The LSP Tool

`agent-config/opencode.json` SHALL explicitly deny the lsp tool per agent for BOTH build and yolo. No top-level global LSP clamp SHALL be introduced; all unrelated permission entries SHALL retain the predecessor posture.

#### Scenario: Build and yolo explicit denies override defaults
- **WHEN** the OpenCode agent permission maps are parsed
- **THEN** build.permission.lsp and yolo.permission.lsp SHALL both be deny
- **AND** no global lsp false or equivalent clamp SHALL exist
- **AND** yolo's otherwise permissive policy SHALL remain unchanged

#### Scenario: Shared-file predecessors are preserved
- **GIVEN** numbered batch row 15 has landed before this change at row 17
- **WHEN** LSP denials are applied
- **THEN** unrelated predecessor build and yolo permissions SHALL remain unchanged
- **AND** later regression baselines SHALL use the config as landed after both rows rather than pre-batch yolo bytes

### Requirement: LSP Implicit Startup Coverage Retains Pinned Evidence Limits

The change SHALL audit pinned OMP v18.6.1 and OpenCode 1.18.21 implicit server startup and cold-start routes separately from explicit tool denial. Recorded incompatible/unresolved verdicts SHALL remain unchanged by DECIDED deployment dispositions or passing mocks. Incomplete coverage SHALL be named without claiming complete native suppression or inventing a global clamp, restricted YOLO handler or version bump.

#### Scenario: Consultable restricted residual route denies
- **GIVEN** a source-cited residual startup route reachable through a restricted tool call
- **WHEN** its LSP-adjacent decision is consulted
- **THEN** an additive default-deny row SHALL block it through existing restricted enforcement
- **AND** shipped inventory rows and handler semantics SHALL remain unchanged

#### Scenario: Native-internal or YOLO residual remains explicit
- **GIVEN** a startup route outside restricted handler coverage
- **WHEN** the source audit records coverage
- **THEN** the exact uncovered route and symbols SHALL be recorded
- **AND** no artifact SHALL claim the restricted handler prevents that route or native suppression is complete

#### Scenario: OpenCode explicit denial is not implicit-startup evidence
- **WHEN** build and yolo explicit lsp denial tests pass
- **THEN** they SHALL establish permission-map wiring only
- **AND** the pinned implicit-scoping incompatibility and automatic-startup coverage limits SHALL remain recorded
- **AND** OpenCode 1.18.21 SHALL remain pinned

### Requirement: Both-Agent LSP Evidence And Documentation Boundary

Documentation, CHANGELOG and handoff SHALL state decision 5's OMP restricted+YOLO and OpenCode build+yolo posture, separating source claims, unit/mock wiring evidence and user-owned native observations. Native implicit-startup suppression in all four agent/mode combinations SHALL remain unverified until observed.

#### Scenario: Wiring suite has no native claim
- **WHEN** config, launch and conditional-decision fixtures pass
- **THEN** evidence SHALL cover both OMP disable carriers, both OpenCode per-agent denies, no global clamp and preservation of unrelated permissions only
- **AND** no test SHALL certify native language-server suppression

#### Scenario: Permission docs and checklist match the decision
- **WHEN** permission docs, changelog and runtime checklist are written
- **THEN** both agents and both modes SHALL be named with their selected carriers and recorded coverage limits
- **AND** all native implicit-startup observations SHALL be explicitly unverified
