# Spec Delta

## Purpose

Checks that the Bun test suite keeps every test the Deno baseline recorded, and keeps a written record of each test that was removed, skipped or renamed during the Bun migration.

## ADDED Requirements

### Requirement: Baseline Name Coverage

The parity check SHALL report every baseline test inside the requested scope that has no Bun test with the same file and full name, counting repeated names, and SHALL exit non-zero when any is missing.

#### Scenario: All names present
- **GIVEN** a Bun report containing every baseline test of `tests/utils/hash.test.ts`
- **WHEN** the check runs with `--scope tests/utils/hash.test.ts`
- **THEN** it SHALL exit 0

#### Scenario: Name missing
- **GIVEN** a Bun report lacking one baseline test name of the scoped file
- **WHEN** the check runs
- **THEN** it SHALL exit 1 and list that file and name

#### Scenario: Repeated name counted
- **GIVEN** a baseline that records the same file and name twice and a Bun report holding it once
- **WHEN** the check runs
- **THEN** it SHALL report one missing occurrence

#### Scenario: Nested describe names
- **GIVEN** a Bun test `step a` inside `describe("Parent")`
- **WHEN** the report is read
- **THEN** its full name SHALL be `Parent > step a`, matching Deno's step naming

### Requirement: Recorded Exceptions

A baseline test listed in the exceptions record as removed or skipped with a non-empty reason SHALL not count as missing, and a renamed entry SHALL count only when its replacement test exists in the report.

#### Scenario: Removed with reason
- **GIVEN** an exception `{ disposition: "removed", reason: "covered by X" }` for a missing name
- **WHEN** the check runs
- **THEN** that name SHALL not be reported

#### Scenario: Exception without reason
- **GIVEN** an exception with an empty reason
- **WHEN** the check runs
- **THEN** it SHALL exit 1 and name the invalid exception

#### Scenario: Renamed without replacement
- **GIVEN** a renamed exception whose replacement file and name are absent from the report
- **WHEN** the check runs
- **THEN** the original name SHALL be reported missing

### Requirement: Outcome Parity

A Bun counterpart of a baseline test that passed SHALL pass. With `--allow-deferred`, a failure whose type is `ReferenceError` and whose message is `Deno is not defined` SHALL be listed as deferred and SHALL not fail the check.

#### Scenario: Counterpart fails
- **GIVEN** a baseline test that passed and a Bun counterpart that failed with an assertion error
- **WHEN** the check runs with or without `--allow-deferred`
- **THEN** it SHALL exit 1 and list the failure

#### Scenario: Deferred failure
- **GIVEN** a Bun counterpart that failed with `ReferenceError: Deno is not defined`
- **WHEN** the check runs with `--allow-deferred`
- **THEN** it SHALL exit 0 and list the test as deferred

#### Scenario: Deferred failure without the flag
- **GIVEN** the same failure
- **WHEN** the check runs without `--allow-deferred`
- **THEN** it SHALL exit 1
