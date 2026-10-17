# Spec Delta

## Purpose

Defines durable smtp operation identity so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Stable logical operation

All email submission requests SHALL be bound to a durable owner-scoped logical operation before any SMTP side effect.

#### Scenario: Concurrent repeats
- **WHEN** two callers request the same logical action
- **THEN** one durable operation is reserved and changed payload returns conflict

### Requirement: Unknown is absorbing for automatic sends

A submitting operation without a durable outcome SHALL become unknown on recovery and SHALL NOT be automatically resubmitted.

#### Scenario: Tail lacks outcome
- **WHEN** a submitting record exists and the final outcome record is truncated
- **THEN** the operation stays unknown and automatic sends remain blocked

### Requirement: Missing evidence blocks submission

Corruption or missing submission evidence SHALL block affected automatic sends without treating the operation as absent.

#### Scenario: Unattributable corrupt intent
- **WHEN** journal corruption prevents identifying its owning operation
- **THEN** the whole mailbox submission lane is blocked for review

