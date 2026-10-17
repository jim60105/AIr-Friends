# Spec Delta

## ADDED Requirements

### Requirement: Reminder origin survives restart

Email reminders SHALL persist their initiating user thread and reply anchor at creation and reuse both after restart.

#### Scenario: Restart due reminder

- **WHEN** a stored email reminder becomes due during downtime
- **THEN** one signed email targets the initiating user in its original thread

### Requirement: Revoked account cannot receive scheduled mail

Removing or disabling an email account allowlist entry SHALL prevent later reminder delivery.

#### Scenario: User removed

- **WHEN** a reminder is due after its owner was removed from channels
- **THEN** no SMTP submission occurs

### Requirement: Reminder uncertainty is not replayed

Submitted or unknown reminder operations SHALL NOT be automatically resubmitted even when reminder completion persistence fails.

#### Scenario: Reminder patch fails

- **WHEN** SMTP acceptance occurs but disabling the reminder fails
- **THEN** next scheduler tick consults its stable operation and does not send again
