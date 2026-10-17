# Spec Delta

## MODIFIED Requirements

### Requirement: Platform Type Validation

The system SHALL restrict the `Platform` type to the literal union `"discord" | "misskey" | "email"` and provide a validator function for runtime checks.

#### Scenario: Valid platform string

- **GIVEN** a string value `"discord"`, `"misskey"`, or `"email"`
- **WHEN** validated as a Platform
- **THEN** it SHALL pass validation

#### Scenario: Invalid platform string

- **GIVEN** a string value not in the valid set
- **WHEN** validated as a Platform
- **THEN** it SHALL fail validation

#### Scenario: Email platform validation

- **WHEN** the runtime validates `email`
- **THEN** it SHALL accept email as a supported private mail platform
