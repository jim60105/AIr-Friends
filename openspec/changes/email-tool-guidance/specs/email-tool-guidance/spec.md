# Spec Delta

## Purpose

Defines email-aware prompt and tool availability so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Email capability guidance

Email prompts and skill availability SHALL reflect supported replies/files and unsupported editing/reactions/typing, without exposing credentials or configured signature content.

#### Scenario: Both backends
- **WHEN** OMP or OpenCode renders message/reminder/spontaneous prompts
- **THEN** guidance uses correct literal session payload paths and tells the model not to generate the centrally added signature

### Requirement: Grant-aware skill exposure

Third-party email tools SHALL be available only in authenticated requesting sessions with matching immutable grants, and hidden calls SHALL still be rejected by the handler.

#### Scenario: Autonomous tool call
- **WHEN** a reminder or spontaneous agent invokes send-email directly
- **THEN** no grant exists and the backend refuses the send

### Requirement: Uncertainty guidance

Email recovery and result instructions SHALL preserve submission uncertainty and SHALL NOT instruct additional mail solely to satisfy response accounting.

#### Scenario: Third-party-only turn
- **WHEN** one granted third-party mail has been submitted
- **THEN** guidance allows session completion without manufacturing a normal-user reply

