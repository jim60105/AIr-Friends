# bun-poc-harness Specification

## Purpose
Runs a proof-of-concept suite on the pinned Bun runtime under production-like restrictions and captures evidence bound to the exact tree and production sources in use.

## Requirements

### Requirement: Evidence Collection From Test Report

The harness SHALL record every test case of a JUnit report, named or not and at any nesting depth, with its name, status and assertion count.

#### Scenario: Statuses
- **GIVEN** a report with a plain, a `<failure>` and a `<skipped />` test case
- **WHEN** evidence is collected
- **THEN** the statuses SHALL be `passed`, `failed` and `skipped`

#### Scenario: Nested test report entries
- **GIVEN** a report with test cases inside nested `testsuite` elements
- **WHEN** evidence is collected
- **THEN** every nested test case SHALL appear in the evidence

#### Scenario: Hook failure entry
- **GIVEN** a report with a failed test case named `(unnamed)`
- **WHEN** evidence is collected
- **THEN** that entry SHALL appear with status `failed`

#### Scenario: Assertion count
- **GIVEN** a test case with `assertions="0"`
- **WHEN** evidence is collected
- **THEN** its assertion count SHALL be 0

### Requirement: Evidence Hashes

The harness SHALL hash the proof-of-concept tree, excluding evidence, dependencies, Markdown and outcome records, and SHALL hash the production sources the suites load.

#### Scenario: Records do not affect the tree hash
- **GIVEN** a tree in which only evidence, Markdown, `node_modules` or outcome record files changed
- **WHEN** the tree hash is computed
- **THEN** the hash SHALL be unchanged

#### Scenario: Code affects the tree hash
- **GIVEN** a changed suite file
- **WHEN** the tree hash is computed
- **THEN** the hash SHALL differ

#### Scenario: Production source affects its hash
- **GIVEN** a changed byte in one listed production source
- **WHEN** the product source hash is computed
- **THEN** the hash SHALL differ

### Requirement: Suite Failures Are Evidence

A suite run SHALL write its evidence file and exit 0 when tests fail, and SHALL exit non-zero without writing evidence only when no test report was produced.

#### Scenario: Failing test
- **GIVEN** a suite in which a test fails
- **WHEN** the run finishes
- **THEN** the evidence file SHALL be written and the run SHALL exit 0

#### Scenario: Suite cannot start
- **GIVEN** a run that produces no JUnit report
- **WHEN** the run finishes
- **THEN** no evidence file SHALL be written and the run SHALL exit 2

### Requirement: Arm64 Evidence Workflow

The repository SHALL produce `aarch64` evidence from a workflow that runs the `ffi` and `ffi-enosys` suites with `--final` on a native arm64 GitHub Actions runner, triggered only by a pushed `bun-poc-final-*` tag, with read-only repository permission and no secret.

#### Scenario: Failed suite still uploads evidence
- **GIVEN** a suite step that exits non-zero after writing evidence
- **WHEN** the workflow continues
- **THEN** the evidence SHALL be uploaded as the `bun-poc-aarch64-evidence` artifact

#### Scenario: Branch push
- **GIVEN** a push of a branch with no matching tag
- **WHEN** GitHub Actions evaluates triggers
- **THEN** the workflow SHALL NOT run
