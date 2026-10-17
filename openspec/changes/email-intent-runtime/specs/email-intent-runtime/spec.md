# Spec Delta

## Purpose

Defines isolated email intent interpretation runtime so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Isolated interpretation

Intent interpretation SHALL receive only the current authored request in an isolated context with no history, mailbox or Skill API credentials, sending tools or private workspace access. Required model-provider authentication SHALL remain available only to the interpreter runtime.

#### Scenario: Attempted tool call

- **WHEN** intent model attempts a shell, filesystem, MCP or skill operation
- **THEN** no tool effect occurs and interpretation returns unavailable

### Requirement: Bounded private interpretation

Intent interpretation SHALL bound execution time and output size, avoid content logs and discard incomplete output.

#### Scenario: Timeout or overflow

- **WHEN** output exceeds 8 KiB or execution exceeds 30 seconds
- **THEN** no partial authorization output is returned and resources are safely reclaimed
