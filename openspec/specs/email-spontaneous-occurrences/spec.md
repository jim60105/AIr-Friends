# email-spontaneous-occurrences Specification

## Purpose
Provides durable spontaneous schedule occurrence identity as a complete observable prerequisite for safe email authorization or durable autonomous delivery within the approved platform boundary.

## Requirements

### Requirement: Stable restored occurrence

An overdue restored email schedule SHALL retain its original occurrence identity and selected target/thread before any new selection or send.

#### Scenario: Crash before next schedule

- **WHEN** SMTP accepts or becomes uncertain and process dies before saving the next schedule
- **THEN** restart recovers the same occurrence and performs no replacement selection or additional DATA transaction

### Requirement: Atomic successor scheduling

Email spontaneous scheduling SHALL durably bind target before execution and atomically replace a terminal occurrence with its next distinct schedule.

#### Scenario: Snapshot failure

- **WHEN** selection or successor persistence fails
- **THEN** automatic work stops for review instead of allocating a replacement identity
