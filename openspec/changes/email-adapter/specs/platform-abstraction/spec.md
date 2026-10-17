# Spec Delta

## ADDED Requirements

### Requirement: Threaded private email adapter

Permitted email requests SHALL normalize as private events and receive ordinary replies and file mail in their owner-bound thread addressed only to the verified original sender.

#### Scenario: Threaded reply smoke
- **WHEN** valid source is loaded and adapter replies through local services
- **THEN** In-Reply-To and References preserve thread and SMTP recipient is the verified sender

### Requirement: Unsupported actions are explicit

Email SHALL advertise unsupported editing/reactions/typing and SHALL NOT emulate editing by sending another message.

#### Scenario: Edit delivered email
- **WHEN** edit-reply targets email
- **THEN** explicit unsupported result is returned and zero SMTP transactions occur

### Requirement: Complete file delivery result

Email file sending SHALL use existing count/aggregate-size limits and report submission state without claiming partial or recipient delivery success.

#### Scenario: Batch too large
- **WHEN** file count or total bytes exceed configured send-file limits
- **THEN** the entire request fails before construction or SMTP

