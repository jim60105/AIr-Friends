# Spec Delta

## MODIFIED Requirements

### Requirement: Reminder origin survives restart

Email reminders SHALL persist and reuse their initiating user thread and reply anchor after restart. Preflight and submission SHALL resolve retained anchors by durable owner-thread-record lookup regardless of recent-context limits. Invalid origins SHALL remain review-required without sending. Disabled review-required reminders SHALL NOT be automatically re-enabled.

#### Scenario: Restart due reminder

- **WHEN** a stored email reminder becomes due during downtime
- **THEN** one signed email targets the initiating user in its original thread

#### Scenario: Original anchor outside recent window after restart

- **GIVEN** an enabled email reminder retains its original inbound anchor and the same thread has at least 201 records, excluding that anchor from the last 200
- **WHEN** the archive and reminder store reopen and the reminder becomes due
- **THEN** preflight accepts the durable original anchor and submission resolves that same anchor
- **AND** one signed email targets the original verified sender in its originating thread without enlarging recent model context

#### Scenario: Revoked account with retained anchor

- **WHEN** an original anchor is durable but its owner is no longer currently permitted
- **THEN** no SMTP submission occurs

#### Scenario: Completed or uncertain aged-anchor operation

- **WHEN** a due reminder has an aged retained anchor and its stable logical operation is submitted, unknown or submitting
- **THEN** no new SMTP submission occurs across subsequent ticks or restart even if reminder completion persistence failed

#### Scenario: Missing or foreign original anchor

- **WHEN** the persisted anchor is missing, corrupt, cross-owner or cross-thread
- **THEN** the reminder is review-required and no replacement anchor or new thread is selected

#### Scenario: Retained but unthreadable original

- **WHEN** a retained original anchor lacks usable wire threading identifiers
- **THEN** the reminder is disabled as review-required before generation or SMTP
- **AND** later ticks do not regenerate or submit that reminder
