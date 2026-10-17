# Spec Delta

## Purpose

Defines sender-scoped message and thread history so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Sender and thread isolation

Recent history SHALL require both the initiating user and an internal thread. Subjects SHALL NOT establish thread membership.

#### Scenario: Forged reference

- **WHEN** user B references user A wire Message-ID
- **THEN** no A message is returned or joined

### Requirement: Identifier conflicts preserve evidence

Missing, duplicate or conflicting message identifiers SHALL NOT overwrite stored messages or authorize history access.

#### Scenario: Duplicate wire ID

- **WHEN** distinct raw messages claim the same Message-ID
- **THEN** both immutable source records survive and ambiguous threading requires review

### Requirement: Durable source bytes

Source bodies and attachments SHALL remain unchanged outside disposable session directories.

#### Scenario: Forward later

- **WHEN** the originating session tmp area has been reclaimed
- **THEN** the selected original and every attachment remain available by internal ID
