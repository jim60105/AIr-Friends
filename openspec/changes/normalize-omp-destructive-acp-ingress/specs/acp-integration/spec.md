# Spec Delta

## ADDED Requirements

### Requirement: OMP Destructive Permission Input Normalization

OMP destructive permission inputs SHALL be selected by the configured connector agent type and normalized into the existing shared authorization representation. OpenCode requests and clients without OMP selection SHALL retain their existing outcomes.

#### Scenario: Configured type selects ingress
- **WHEN** a request claims an OMP type or parser provenance but its connector is OpenCode
- **THEN** the OpenCode decoder SHALL remain selected and caller metadata SHALL grant no normalization authority.

#### Scenario: Single native delete
- **WHEN** configured OMP requests Delete with complete rawInput.path and matching locations
- **THEN** the actual path SHALL receive the existing shared delete authorization outcome.

#### Scenario: Move aliases
- **WHEN** configured OMP requests Move with native aliases
- **THEN** source SHALL use oldPath then path then from, destination SHALL use newPath then to then destination, and both endpoints SHALL receive shared authorization.

#### Scenario: Missing or conflicting locations
- **WHEN** an OMP destructive request has missing endpoints, absent/partial locations or locations inconsistent with its decoded targets
- **THEN** the existing completeness/binding denial SHALL apply with no inferred endpoint or partial grant.

### Requirement: OMP Destructive Binding And Diagnostic Integrity

OMP normalization SHALL retain the original request for diagnostics and use one canonical input representation for shared decode and execution binding. Request-supplied operation lists SHALL confer no authority.

#### Scenario: Canonical binding
- **WHEN** native move aliases are normalized
- **THEN** the decoded operation and its execution binding SHALL refer to identical canonical source/destination data while diagnostics retain original arguments.

#### Scenario: Embedded destructive edit
- **WHEN** a native edit or patch contains deletion or rename operations, even with a Delete or Move title
- **THEN** the existing unsupported-syntax outcome SHALL remain and the first displayed operation SHALL NOT stand for the complete request.

#### Scenario: YOLO and OpenCode unchanged
- **WHEN** YOLO or OpenCode receives a destructive-shaped request
- **THEN** the existing YOLO early approval or OpenCode decoder outcome SHALL remain unchanged.

