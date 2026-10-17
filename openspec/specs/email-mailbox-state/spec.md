# email-mailbox-state Specification

## Purpose
Defines durable mailbox processing evidence so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: First activation boundary

The first successful mailbox activation SHALL persist its current position before processing only subsequent arrivals.

#### Scenario: Boundary survives crash

- **WHEN** the bot restarts after initialization but before any new mail
- **THEN** existing inbox entries remain excluded

### Requirement: Discovery and processing durability

Progress SHALL never discard accepted unstarted work. Each entry SHALL retain its processing state separately from the scan cursor.

#### Scenario: Cursor advances

- **WHEN** one message fails and a later UID is discovered
- **THEN** the failure is terminal or review-required and later work remains processable

### Requirement: Uncertain receive recovery

Work with an uncertain agent outcome SHALL require review rather than automatic replay.

#### Scenario: Crash after agent start

- **WHEN** a started entry has no terminal result on restart
- **THEN** it becomes review-required and no new agent is started for it
