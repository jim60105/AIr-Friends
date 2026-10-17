# email-mailbox-polling Specification

## Purpose
Defines serialized imap polling and reconciliation so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Restart and read-independent reception

Later starts SHALL discover mail arriving during downtime regardless of Seen flags, while first activation SHALL exclude preexisting messages.

#### Scenario: Restart smoke

- **WHEN** a local IMAP fixture adds Seen mail while the bot is stopped
- **THEN** restart admits that new UID exactly once to the durable unstarted queue

### Requirement: Replacement reconciliation

Changed UIDVALIDITY SHALL reconcile against durable message and processing evidence before admission; ambiguity SHALL stop affected automatic work.

#### Scenario: Mailbox replacement

- **WHEN** old mail reappears under new UIDs with conflicting identifiers
- **THEN** matching evidence prevents replay and ambiguous entries require review

### Requirement: Failure isolation and serialization

Polling rounds SHALL not overlap. Malformed per-message failures SHALL become terminal or review-required without blocking later entries; connection failure SHALL preserve progress.

#### Scenario: Mixed failures

- **WHEN** one malformed message precedes valid mail and then a connection drops
- **THEN** valid later entries remain eligible and the next round resumes from durable evidence
