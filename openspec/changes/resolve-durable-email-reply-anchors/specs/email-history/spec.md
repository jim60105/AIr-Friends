# Spec Delta

## ADDED Requirements

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
