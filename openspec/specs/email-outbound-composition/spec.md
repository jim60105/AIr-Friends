# email-outbound-composition Specification

## Purpose
Defines user-directed third-party composition skill so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Explicit composition without confirmation

An authenticated user explicit granted request SHALL compose to its permitted third-party destination without a second confirmation, while the recipient gains no incoming permission.

#### Scenario: New destination

- **WHEN** a valid compose grant names an address absent from channels
- **THEN** one immediate submission is allowed and incoming mail from that address remains denied

### Requirement: Contained payloads and enforced grants

Subject and body SHALL arrive only through session-contained payload files. The handler SHALL reject added destinations or altered actions independent of sender-model parameters.

#### Scenario: Grant bypass attempt

- **WHEN** request adds Cc/Bcc, changes recipient or uses a sibling payload file
- **THEN** no message or attachment bytes are sent

### Requirement: Minimum requested content

Composed mail SHALL contain only requested task material and explicitly selected bounded attachments, without automatically including memories or unrelated history.

#### Scenario: Private workspace data

- **WHEN** a compose request omits attachments while the workspace has private memories
- **THEN** no memory file or unrelated history is attached
