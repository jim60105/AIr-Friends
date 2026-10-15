# Spec Delta

## ADDED Requirements

### Requirement: OMP Native Tool Interruptions Have Explicit Log Outcomes

Failed tool updates from configured OMP sessions SHALL be classified from native `rawOutput.details` metadata at the client logging boundary. A proven unexecuted skip SHALL log at INFO as `skipped`; a recognized started interruption SHALL log at INFO as `interrupted` with execution `started`. Both SHALL retain raw status `failed` and SHALL NOT imply successful work or verification. Every other failed update SHALL retain ERROR logging.

#### Scenario: Genuine synthetic skip
- **GIVEN** a configured OMP session reports raw status `failed`
- **AND** its details contain `source: "interrupt_skipped"`, `__synthetic: true` and `executed: false` without conflicting started markers
- **WHEN** the client logs the update
- **THEN** it SHALL log at INFO with classification `skipped`, execution `not_started` and raw status `failed`
- **AND** it SHALL NOT report a command failure or successful execution

#### Scenario: Started native interruption
- **GIVEN** a configured OMP session reports raw status `failed`
- **AND** its details contain `source: "interrupt_skipped"`, `__interrupted: true` and `execution: "started"` without conflicting synthetic markers
- **WHEN** the client logs the update
- **THEN** it SHALL log at INFO with classification `interrupted`, execution `started` and raw status `failed`
- **AND** it SHALL NOT claim that execution never began or that side effects are absent

#### Scenario: Service parameter and command failures stay errors
- **GIVEN** an OMP failed update contains a service-mode parameter error or a genuine command failure without recognized interruption metadata
- **WHEN** the client logs the update
- **THEN** it SHALL retain ERROR severity with classification `failed` and the existing failure diagnostics

#### Scenario: Text resemblance cannot suppress an error
- **GIVEN** a failed update has interruption-looking prose, missing or incorrectly typed markers, contradictory execution markers, or an unknown source
- **WHEN** the client logs the update
- **THEN** it SHALL retain ERROR severity
- **AND** it SHALL NOT classify by matching human-readable message text

#### Scenario: Other agents retain current behavior
- **GIVEN** an OpenCode session or a client without an authoritative OMP discriminator reports a failed update with the same details
- **WHEN** the client logs the update
- **THEN** it SHALL retain ERROR severity
- **AND** payload metadata SHALL NOT select the configured agent type

### Requirement: Tool Outcome Logging Does Not Change Execution Evidence

Tool-outcome classification SHALL preserve existing non-failed updates, audit phases, metrics and response-state behavior. It SHALL use the existing structured logger and masking rules, adding only bounded classification/execution fields. Interruption logs SHALL NOT introduce raw content, payloads, credentials or full-update serialization beyond existing failure diagnostics.

#### Scenario: Skip is not verification
- **WHEN** an OMP skip or started interruption is classified
- **THEN** the classification SHALL NOT mark a tool completed, satisfy a delivery/verification requirement or trigger automatic re-execution
- **AND** raw status `failed` SHALL remain available for correlation with the original tool-call ID

#### Scenario: Existing diagnostic contracts remain
- **WHEN** a recognized interruption is logged
- **THEN** the entry SHALL contain the tool-call ID, raw status, classification and bounded execution state using existing structured logging
- **AND** no new audit phase, metric label, unmasked content field or serialized raw update SHALL be added for that interruption

#### Scenario: Completed updates remain unchanged
- **WHEN** any agent reports a completed, pending or in-progress tool update
- **THEN** its existing INFO update path and execution behavior SHALL remain unchanged
