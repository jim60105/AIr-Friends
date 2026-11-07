# Spec Delta

## Purpose

Decides whether the Bun migration proceeds, using explicit criteria tied to the P0 release blockers, evidence bound to the exact proof-of-concept tree and runtime, and a verifiable recorded outcome.

## ADDED Requirements

### Requirement: Criterion Catalog Coverage

The gate SHALL reject a catalog unless every P0 blocker has at least one criterion or an explicit deferral, criterion identifiers are unique and well formed, and each criterion names a suite and at least one architecture.

#### Scenario: Unmapped blocker
- **GIVEN** a catalog and deferral list in which one P0 blocker appears in neither
- **WHEN** the catalog is validated
- **THEN** validation SHALL fail and name that blocker

#### Scenario: Duplicate identifier
- **GIVEN** two criteria with the same identifier
- **WHEN** the catalog is validated
- **THEN** validation SHALL fail and name the identifier

#### Scenario: Evaluation refuses an invalid catalog
- **GIVEN** a catalog that fails validation
- **WHEN** the outcome is evaluated
- **THEN** the outcome SHALL be `No-Go` and the blockers SHALL include the validation failure

### Requirement: Criterion Result From Test Report

A criterion SHALL pass on an architecture only when at least one test whose title starts with `<id>:` exists in that architecture's evidence and every such test passed.

#### Scenario: All tests for a criterion passed
- **GIVEN** two passing tests titled `FFI-01: a` and `FFI-01: b`
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `pass`

#### Scenario: One failing test
- **GIVEN** one passing and one failing test for the same criterion
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `fail`

#### Scenario: Skipped test
- **GIVEN** a test for the criterion reported as skipped
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `fail`

#### Scenario: No matching test
- **GIVEN** evidence with no test for the criterion
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `missing`

#### Scenario: Nested test report entries
- **GIVEN** a JUnit report with test cases inside nested `testsuite` elements
- **WHEN** evidence is collected
- **THEN** every nested test case SHALL appear in the evidence

### Requirement: Evidence Binding

The gate SHALL treat evidence as `stale` unless its Bun version and revision, base image digest, agent versions and proof-of-concept tree hash equal the pinned and recomputed values.

#### Scenario: Tree changed after the run
- **GIVEN** evidence whose tree hash differs from the hash of the current tree
- **WHEN** the outcome is evaluated
- **THEN** every criterion of that suite and architecture SHALL be `stale`

#### Scenario: Wrong Bun version
- **GIVEN** evidence recorded with a Bun version other than the pin
- **WHEN** the outcome is evaluated
- **THEN** every criterion of that suite and architecture SHALL be `stale`

#### Scenario: Records do not affect the hash
- **GIVEN** a tree in which only evidence, Markdown or outcome record files changed
- **WHEN** the tree hash is computed
- **THEN** the hash SHALL be unchanged

### Requirement: Outcome Evaluation

The gate SHALL return `Go` only when every criterion passes on every architecture it requires, the product-isolation condition holds and the baseline state is `valid`; in every other case it SHALL return `No-Go` and list each blocker.

#### Scenario: Everything passes
- **GIVEN** all criteria `pass`, no isolation violation and a `valid` baseline
- **WHEN** the outcome is evaluated
- **THEN** the outcome SHALL be `Go` with an empty blocker list

#### Scenario: Required architecture missing
- **GIVEN** a criterion requiring two architectures with evidence for only one
- **WHEN** the outcome is evaluated
- **THEN** the outcome SHALL be `No-Go` and the blockers SHALL name the criterion and architecture

#### Scenario: Pending baseline
- **GIVEN** all criteria `pass` and a baseline state of `pending`
- **WHEN** the outcome is evaluated
- **THEN** the outcome SHALL be `No-Go` and the blockers SHALL name the baseline

### Requirement: Product Isolation Condition

The gate SHALL report an isolation violation for any path changed since the merge base with `master`, committed or uncommitted, that lies outside `migration/bun/`, `openspec/` and `docs/superpowers/`.

#### Scenario: Product file changed
- **GIVEN** a changed path `src/main.ts`
- **WHEN** the isolation condition is evaluated
- **THEN** it SHALL report `src/main.ts` as a violation and the outcome SHALL be `No-Go`

#### Scenario: Only allowed paths changed
- **GIVEN** changed paths under `migration/bun/` and `openspec/`
- **WHEN** the isolation condition is evaluated
- **THEN** it SHALL report no violation

### Requirement: Suite Failures Are Evidence

A proof-of-concept suite run SHALL write its evidence file and exit 0 when tests fail, and SHALL exit non-zero without writing evidence only when no test report was produced.

#### Scenario: Failing test
- **GIVEN** a suite in which a test fails
- **WHEN** the run finishes
- **THEN** the evidence file SHALL exist with that test marked `failed` and the run SHALL exit 0

#### Scenario: Suite cannot start
- **GIVEN** a run that produces no JUnit report
- **WHEN** the run finishes
- **THEN** no evidence file SHALL be written and the run SHALL exit 2

### Requirement: Outcome Record

The gate SHALL write a machine-readable record and a Markdown record stating `Go` or `No-Go`, with per-criterion results, blockers, deferred P0 scope, pins and observations.

#### Scenario: Go record states open blockers
- **GIVEN** an evaluation with outcome `Go`
- **WHEN** the record is written
- **THEN** the Markdown SHALL contain the line `Outcome: Go` and SHALL list the deferred P0 scope as still open

#### Scenario: No-Go record names blockers
- **GIVEN** an evaluation with outcome `No-Go`
- **WHEN** the record is written
- **THEN** the Markdown SHALL contain the line `Outcome: No-Go` and SHALL list every blocker

### Requirement: Outcome Record Verification

The gate SHALL verify a committed record by recomputing the evaluation from the committed evidence and failing on any difference in outcome or criterion status.

#### Scenario: Edited record
- **GIVEN** a record whose outcome was edited from `No-Go` to `Go`
- **WHEN** verification runs
- **THEN** it SHALL exit 1 and name the outcome mismatch

#### Scenario: Matching record
- **GIVEN** a record produced from the committed evidence
- **WHEN** verification runs
- **THEN** it SHALL exit 0
