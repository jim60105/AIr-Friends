# email-durable-files Specification

## Purpose
Defines crash-safe email file primitives so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Durable before side effects

Safety-critical email records SHALL be flushed before callers may advance progress or invoke SMTP. Snapshots SHALL use atomic replacement.

#### Scenario: Write failure

- **WHEN** flush or rename fails
- **THEN** the caller receives failure and no external action is authorized

### Requirement: Corruption is evidence

Incomplete trailing records SHALL NOT be interpreted as valid transitions. Interior corruption SHALL stop affected automatic work without disclosing record contents.

#### Scenario: Torn intent

- **WHEN** a journal ends halfway through a send intent
- **THEN** recovery exposes torn-tail and forbids appending or concluding that a send is safe

### Requirement: Private file boundary

Email state files SHALL remain within their configured state root with private access permissions.

#### Scenario: Symlink escape

- **WHEN** a state path resolves outside its root
- **THEN** mutation is rejected before private data is written
