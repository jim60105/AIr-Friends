# Spec Delta

## Purpose

Defines guarded production email activation so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: No premature ingress

Production email ingress SHALL remain unavailable until all batch safety and behavior dependencies are implemented. Enabled startup SHALL require complete real components and safe recovered state.

#### Scenario: Partial predecessor deployment

- **WHEN** email enabled is configured before activation change
- **THEN** startup refuses activation rather than silently registering a partially capable adapter

### Requirement: Lifecycle and status integration

Enabled email SHALL register with existing lifecycle and connection-status surfaces, admit work only after startup recovery/cleanup, and stop new work before shutdown drain.

#### Scenario: Shutdown during poll/send

- **WHEN** termination arrives while work is active
- **THEN** new work stops, durable uncertainty is preserved and protocol clients close without resending

### Requirement: Integrated controlled-service acceptance

Production composition SHALL pass controlled local IMAP and SMTP scenarios with no production credentials and preserve Discord/Misskey regression behavior.

#### Scenario: Whole path smoke

- **WHEN** preexisting mail, new authenticated mail, third-party forward and reminder are exercised against local services
- **THEN** old mail is ignored, authorized threaded outputs are signed once and duplicate/unknown outcomes do not resend
