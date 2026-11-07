# bun-migration-baseline Specification

## Purpose
Captures and validates the Deno-era reference records (test names and results, coverage, freeze point, deployed image) that the Bun migration is measured against.

## Requirements

### Requirement: Deno Test Result Record

The baseline tool SHALL convert Deno JUnit output into a record with one entry per test case, holding its file, full name and status of `passed`, `failed` or `ignored`, sorted by file then name.

#### Scenario: Statuses are derived from the JUnit test case
- **GIVEN** JUnit output with one plain, one `<skipped/>` and one `<failure>` test case
- **WHEN** the tool parses it
- **THEN** the entries SHALL have the statuses `passed`, `ignored` and `failed`

#### Scenario: Step test cases keep their full name
- **GIVEN** a test case named `with step > inner a`
- **WHEN** the tool parses it
- **THEN** the entry name SHALL be exactly `with step > inner a`, with XML entities decoded

#### Scenario: Repeated names stay separate
- **GIVEN** the same test name in two files and twice in one file
- **WHEN** the tool parses the output
- **THEN** every occurrence SHALL produce its own entry

### Requirement: Coverage Summary Record

The baseline tool SHALL read the `All files` row of Deno's coverage table and record branch, function and line percentages as numbers.

#### Scenario: Row is parsed by column
- **GIVEN** a coverage table with the row `| All files |     50.0 |      100.0 |  90.5 |`
- **WHEN** the tool parses it
- **THEN** the record SHALL hold branch `50`, function `100` and line `90.5`

#### Scenario: Missing row fails
- **GIVEN** coverage output with no `All files` row
- **WHEN** the tool parses it
- **THEN** parsing SHALL fail with an error naming the missing row

### Requirement: Capture Refuses A Drifted Tree

The baseline tool SHALL refuse to capture unless `master` equals the merge base with the current branch and the Deno-era sources are unchanged from that freeze point.

#### Scenario: Source drift stops capture
- **GIVEN** a path under `src/` or `tests/`, or `deno.json` or `deno.lock`, that differs from the freeze point in `HEAD` or in the working tree
- **WHEN** capture starts
- **THEN** it SHALL exit with status 2 before running any test and SHALL list the drifted paths

#### Scenario: Moved master stops capture
- **GIVEN** `master` has commits that are not in the current branch
- **WHEN** capture starts
- **THEN** it SHALL exit with status 2 before running any test

### Requirement: Failed Tests Are Recorded

The baseline tool SHALL record failing tests as results rather than treat them as a capture failure, and SHALL fail only when no JUnit output exists.

#### Scenario: Test run exits non-zero with output
- **GIVEN** the Deno test run exits non-zero and JUnit output exists
- **WHEN** capture continues
- **THEN** the records SHALL be written with the failures counted in the totals

#### Scenario: No JUnit output
- **GIVEN** the Deno test run produced no JUnit file
- **WHEN** capture continues
- **THEN** it SHALL exit with status 3 and write no record

### Requirement: Baseline Record Validation

The baseline tool SHALL report a state of `valid` or `invalid` for the record set, and SHALL exit with status 0 only for `valid`.

#### Scenario: Totals disagree with entries
- **GIVEN** a summary whose totals differ from the counted entries of the test record
- **WHEN** validation runs
- **THEN** the state SHALL be `invalid` and the problem SHALL name the totals

#### Scenario: Rollback reference absent
- **GIVEN** valid captured records and no rollback reference
- **WHEN** validation runs
- **THEN** the state SHALL be `invalid` and the validator SHALL exit with status 1

#### Scenario: Complete record set
- **GIVEN** valid captured records and a valid rollback reference
- **WHEN** validation runs
- **THEN** the state SHALL be `valid` and the validator SHALL exit with status 0

### Requirement: Rollback Reference Validation

The baseline validator SHALL reject a rollback reference unless the image is identified by an immutable `sha256` digest and its source revision equals the recorded freeze SHA.

#### Scenario: Tag-only image reference
- **GIVEN** a rollback reference whose image reference has a tag and no digest
- **WHEN** validation runs
- **THEN** the state SHALL be `invalid` and the problem SHALL name the image reference

#### Scenario: Reference and digest disagree
- **GIVEN** an image reference whose digest differs from the recorded digest
- **WHEN** validation runs
- **THEN** the state SHALL be `invalid`

#### Scenario: Revision differs from the freeze point
- **GIVEN** a source revision that differs from the recorded freeze SHA
- **WHEN** validation runs
- **THEN** the state SHALL be `invalid` and the problem SHALL name the revision
