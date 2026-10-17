# email-history Specification

## Purpose
Defines sender-scoped message and thread history so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

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

### Requirement: Durable explicit reply anchors

Explicit email reply anchors SHALL resolve from retained durable history by authenticated owner, internal thread and immutable record ID, independently of recent-context bounds. The selected anchor SHALL determine wire threading and its verified initiating sender SHALL remain the recipient. Failed resolution SHALL NOT substitute an anchor or create a thread. Implicit latest-anchor behavior SHALL remain unchanged.

#### Scenario: Explicit anchor older than recent context

- **WHEN** an explicit original anchor is retained in a thread with at least 201 records and is absent from the last 200 records
- **THEN** the reply can resolve that original anchor and its verified initiating sender
- **AND** recent model context remains bounded

#### Scenario: No recent inbound source

- **WHEN** the retained explicit inbound anchor is valid but all records in the recent window are outbound
- **THEN** recipient and threading resolution still use the original verified inbound source without depending on a recent inbound record

#### Scenario: Missing or mismatched anchor

- **WHEN** the explicit anchor is absent, corrupt, belongs to a different owner or thread, or lacks usable wire threading identifiers
- **THEN** no SMTP submission occurs and an explicit refusal is returned without substituting another anchor

#### Scenario: Explicit outbound anchor

- **WHEN** the explicit retained anchor is outbound and a verified same-owner-thread inbound source exists outside recent context
- **THEN** the selected outbound anchor determines threading and the verified inbound source determines recipient
- **AND** absence of such a verified source causes refusal without owner-wide sender substitution
