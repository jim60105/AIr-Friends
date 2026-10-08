## MODIFIED Requirements

### Requirement: Restricted and YOLO Overlay Non-Contamination

Restricted-only pins SHALL appear exclusively in the restricted composition. The native-yolo composition SHALL select the pinned native YOLO approval mode and SHALL contain no per-tool approval records, approval-record resets or provider-disable clamp. Both compositions SHALL carry the shared deployment pin `lsp.enabled: false` required by decision 5, without imposing the restricted capability set on native YOLO.

#### Scenario: YOLO document carries no restricted clamp
- **WHEN** the deployment-owned native-yolo overlay and emitted settings composition are parsed and validated
- **THEN** both SHALL select native YOLO approval and require boolean `lsp.enabled: false`
- **AND** neither SHALL contain per-tool approval content, approval null-reset or a restricted provider-disable clamp

#### Scenario: Restricted document retains its pins
- **WHEN** the restricted overlay and composition are validated
- **THEN** their existing restricted pin set SHALL remain present
- **AND** the shared deployment LSP pin SHALL have the same false value as native-yolo

#### Scenario: Missing or invalid disable is rejected
- **WHEN** either mode document omits the LSP disable, enables it, supplies a non-boolean value or introduces an unregistered LSP key
- **THEN** owned-settings validation SHALL reject the document

#### Scenario: Factory and OpenCode carriers remain separately owned
- **GIVEN** disable-restricted-agent-lsp has landed before this follow-up
- **WHEN** the final carrier interface is inspected through repository tests
- **THEN** its factory flags SHALL disable LSP for both OMP launch modes and its OpenCode maps SHALL deny LSP per agent for build and yolo without a global clamp
- **AND** this follow-up SHALL own the native-YOLO asset/composition pin without modifying those flags/maps or asserting native implicit server suppression
