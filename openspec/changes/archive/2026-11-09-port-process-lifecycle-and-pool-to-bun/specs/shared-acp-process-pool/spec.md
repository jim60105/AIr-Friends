# Spec Delta

## ADDED Requirements

### Requirement: Pool Stop Terminates Every Pooled Agent

Stopping the agent process pool SHALL disconnect every pooled agent and SHALL complete only after each disconnect finished, leaving no pooled agent process or descendant running.

#### Scenario: Two live pool entries
- **GIVEN** a pool with two live agent processes in different pool keys
- **WHEN** the pool is stopped and the stop completes
- **THEN** neither wrapper PID nor any of their descendants SHALL be alive

#### Scenario: Stop with no entries
- **GIVEN** a pool that never spawned
- **WHEN** it is stopped
- **THEN** the stop SHALL complete without spawning or signalling anything
