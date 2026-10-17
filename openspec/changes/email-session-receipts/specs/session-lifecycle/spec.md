# Spec Delta

## ADDED Requirements

### Requirement: Durable agent-start fence

An email work item SHALL durably record started before the agent or delivery can act, and SHALL not be replayed automatically after an uncertain started outcome.

#### Scenario: Queue crash
- **WHEN** the process dies with accepted work waiting for the execution lease
- **THEN** restart resumes that unstarted work without treating merely emitted events as completed

### Requirement: Explicit receive completion

Email processing completion SHALL depend on explicit lifecycle and side-effect receipts rather than swallowed event-handler errors.

#### Scenario: Handler throws
- **WHEN** downstream event handling fails after work starts
- **THEN** journal records review-required and later polls do not replay it

