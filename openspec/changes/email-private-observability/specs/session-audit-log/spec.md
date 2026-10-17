# Spec Delta

## ADDED Requirements

### Requirement: Private operational records

Credentials, private bodies, parsed mail and source filenames SHALL remain absent from email operational logs and audit output, including when general content hashing is disabled.

#### Scenario: Adversarial errors
- **WHEN** protocol or agent error contains a private body or password
- **THEN** only safe reason code and opaque operation/work identifiers are recorded

### Requirement: Operator outcome visibility

Operators SHALL be able to distinguish email submission failure, unknown outcome and sent-copy failure by stable operation identifier without message contents.

#### Scenario: APPEND failure
- **WHEN** an accepted email has a sent-folder failure
- **THEN** existing audit/log records show submitted plus sentCopy failed and never unsent

