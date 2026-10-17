# Spec Delta

## Purpose

Defines pre-send natural-language destination grants so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Grant producer is separate from sending

Third-party delivery SHALL require a session-scoped grant produced from the authenticated current request before the sending tool operates. Tool parameters SHALL NOT create or enlarge grants.

#### Scenario: Quoted destination only

- **WHEN** an address appears only in forwarded/quoted content or attachments
- **THEN** no destination grant is produced

### Requirement: Ambiguity closes sending

Ambiguous authorship, destination or action, or failed intent interpretation SHALL produce no sending grant and SHALL request clarification through the normal user reply path.

#### Scenario: Preflight invalid

- **WHEN** the interpreter times out, emits invalid JSON or tries tools
- **THEN** no grant exists and the normal agent is instructed to clarify without sending

### Requirement: Session and source binding

Grants SHALL bind owner, session, requested action and selected accessible source. They SHALL expire with that session and SHALL not transfer to autonomous sessions.

#### Scenario: Stale or altered request

- **WHEN** a later session or tool supplies a different recipient/source/action
- **THEN** the original grant cannot authorize that delivery
