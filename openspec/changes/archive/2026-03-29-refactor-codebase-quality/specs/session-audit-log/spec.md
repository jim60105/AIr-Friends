## MODIFIED Requirements

### Requirement: Audit writer creation integrated into shared session lifecycle
The creation and attachment of `SessionAuditWriter` to session registry SHALL be handled by the shared `runAgentSession()` method rather than duplicated in each `process*` method.

#### Scenario: Audit writer created by shared lifecycle
- **WHEN** `runAgentSession()` executes and audit is enabled
- **THEN** the audit writer SHALL be created and attached to the session registry as part of the shared lifecycle, not in individual `process*` methods
