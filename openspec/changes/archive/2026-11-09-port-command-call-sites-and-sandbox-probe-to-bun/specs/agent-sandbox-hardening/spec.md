# Spec Delta

## ADDED Requirements

### Requirement: Sandbox Capability Probes Execute The Real Tools

Each sandbox capability probe SHALL run its tool with the fixed probe arguments and SHALL report the capability only when that run exits 0; a missing tool, a spawn failure, a non-zero exit or a non-Linux platform SHALL report the capability as absent.

#### Scenario: Tool succeeds
- **GIVEN** a `PATH` whose `bwrap` exits 0 for the probe arguments
- **WHEN** the filesystem-confinement probe runs
- **THEN** it SHALL report true

#### Scenario: Tool fails
- **GIVEN** a `PATH` whose `unshare` exits 1
- **WHEN** the network-namespace probe runs
- **THEN** it SHALL report false

#### Scenario: Tool missing
- **GIVEN** a `PATH` with no `bwrap`
- **WHEN** the filesystem-confinement probe runs
- **THEN** it SHALL report false without throwing

#### Scenario: Real host agrees with the probe
- **WHEN** the network-namespace probe runs on the test host
- **THEN** its result SHALL equal whether `unshare --user --map-root --net true` exits 0 when run directly on that host
