# bun-cutover-drill Specification

## Purpose
Defines the scripted container drill that compares the Bun image with the Deno rollback image on a copy of production data before cutover: startup, resources, stop and restart, and rollback.

## Requirements

### Requirement: Thresholds Fixed Before Comparison

The comparison SHALL refuse to run unless the thresholds file exists and was committed before the Bun measurement file was created.

#### Scenario: Thresholds committed first
- **GIVEN** a thresholds file whose last commit precedes the Bun measurement file's `measuredAt`
- **WHEN** the comparison runs
- **THEN** it SHALL compare and report each metric

#### Scenario: Thresholds missing or later
- **GIVEN** no committed thresholds file, or one committed after `measuredAt`
- **WHEN** the comparison runs
- **THEN** it SHALL exit 2 without comparing

### Requirement: No Material Regression

The comparison SHALL fail when any Bun metric exceeds its threshold: median startup time, median idle memory, maximum idle descriptor count, or any process left after stop.

#### Scenario: Within thresholds
- **GIVEN** Bun measurements below every threshold
- **WHEN** the comparison runs
- **THEN** it SHALL exit 0

#### Scenario: One metric over
- **GIVEN** a Bun median idle memory above its threshold
- **WHEN** the comparison runs
- **THEN** it SHALL exit 1 and name the metric, the threshold and the measured value

### Requirement: Rollback Drill

The drill SHALL run the Deno rollback image on the same data copy after the Bun image used it, and SHALL fail unless the rollback image becomes ready.

#### Scenario: Rollback after Bun
- **GIVEN** a data copy that the Bun image started on, wrote to and stopped
- **WHEN** the rollback image starts on that copy
- **THEN** its readiness endpoint SHALL answer 200 within the drill's startup timeout
