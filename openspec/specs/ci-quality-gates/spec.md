# ci-quality-gates Specification

## Purpose
Defines the automated gates continuous integration applies to every change of the Bun application: frozen dependencies, formatting, lint, type check, tests on both architectures, the coverage floor and the image smoke.

## Requirements

### Requirement: Coverage Floor Check

The coverage check SHALL compute line coverage over `src/` files from a Bun LCOV report as the sum of hit lines divided by the sum of found lines, and SHALL exit non-zero when it is below the configured floor.

#### Scenario: Above the floor
- **GIVEN** an LCOV report whose `src/` records total `LF:200` and `LH:160`
- **WHEN** the check runs with floor 75
- **THEN** it SHALL print `80.00` and exit 0

#### Scenario: Below the floor
- **GIVEN** an LCOV report whose `src/` records total `LF:200` and `LH:140`
- **WHEN** the check runs with floor 75
- **THEN** it SHALL print `70.00` and exit 1

#### Scenario: Test files ignored
- **GIVEN** an LCOV report with a `tests/` record of `LF:100`, `LH:0` and `src/` records of `LF:100`, `LH:80`
- **WHEN** the check runs with floor 75
- **THEN** it SHALL print `80.00` and exit 0

#### Scenario: Empty report
- **GIVEN** an LCOV report with no `src/` record
- **WHEN** the check runs
- **THEN** it SHALL exit 1 with a message naming the empty report
