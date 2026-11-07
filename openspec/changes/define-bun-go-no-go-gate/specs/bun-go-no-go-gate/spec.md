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

A criterion SHALL pass on an architecture only when no test in that suite's evidence failed, at least its minimum number of `<id>:` tests exist, and each of them passed with at least one assertion.

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

#### Scenario: Failure outside the criterion's tests
- **GIVEN** a suite whose evidence holds a failed test named `(unnamed)` and passing tests for a criterion
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `fail`

#### Scenario: Fewer tests than the minimum
- **GIVEN** a criterion with a minimum of 3 tests and 2 passing tests
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `missing`

#### Scenario: Test without assertions
- **GIVEN** a passing test for the criterion with an assertion count of 0
- **WHEN** the criterion is evaluated
- **THEN** its status SHALL be `fail`

### Requirement: Evidence Binding

The gate SHALL treat evidence as `stale` unless its Bun version and revision, base image digest, agent versions, tree hash and product source hash equal the pinned and recomputed values.

#### Scenario: Tree changed after the run
- **GIVEN** evidence whose tree hash differs from the hash of the current tree
- **WHEN** the outcome is evaluated
- **THEN** every criterion of that suite and architecture SHALL be `stale`

#### Scenario: Wrong Bun version
- **GIVEN** evidence recorded with a Bun version other than the pin
- **WHEN** the outcome is evaluated
- **THEN** every criterion of that suite and architecture SHALL be `stale`

#### Scenario: Production source changed after the run
- **GIVEN** evidence whose product source hash differs from the current sources
- **WHEN** the outcome is evaluated
- **THEN** every criterion of that suite and architecture SHALL be `stale`

#### Scenario: Emulated arm64
- **GIVEN** `aarch64` evidence whose kernel string contains `x86_64`
- **WHEN** the outcome is evaluated
- **THEN** every criterion of that suite and architecture SHALL be `stale`

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

#### Scenario: Spawn backends disagree
- **GIVEN** all criteria `pass`, with `process` evidence from one spawn backend and `acp` evidence from another
- **WHEN** the outcome is evaluated
- **THEN** the outcome SHALL be `No-Go` and the blockers SHALL name the spawn backend

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

The gate SHALL verify a record by recomputing the evaluation from committed evidence and the record's own inputs, failing on any difference, and SHALL additionally compare hashes and isolation to the checkout when asked to verify live.

#### Scenario: Edited record
- **GIVEN** a record whose outcome was edited from `No-Go` to `Go`
- **WHEN** verification runs
- **THEN** it SHALL exit 1 and name the outcome mismatch

#### Scenario: Matching record
- **GIVEN** a record produced from the committed evidence
- **WHEN** verification runs
- **THEN** it SHALL exit 0

#### Scenario: Live verification on a changed tree
- **GIVEN** a matching record and a checkout whose tree hash differs from the record
- **WHEN** live verification runs
- **THEN** it SHALL exit 1 and name the hash mismatch

#### Scenario: Later tree without live verification
- **GIVEN** a matching record and a checkout with later product changes
- **WHEN** verification runs without the live option
- **THEN** it SHALL exit 0
