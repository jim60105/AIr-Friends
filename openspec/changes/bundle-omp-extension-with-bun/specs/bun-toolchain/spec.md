# Spec Delta

## ADDED Requirements

### Requirement: OMP Extension Bundle Build

The OMP extension bundler SHALL build the extension entry with Bun into one ESM file, SHALL run the existing emitted-bundle audit on it, and SHALL fail before building when the source root has no installed dependencies.

#### Scenario: Successful build
- **GIVEN** a source root whose dependencies were installed with `bun install --frozen-lockfile`
- **WHEN** the bundler runs with that root and an empty target directory
- **THEN** the target SHALL contain exactly one file, `index.js`, and the audit SHALL report no external edge other than `node:` or `bun:` specifiers

#### Scenario: Missing dependencies
- **GIVEN** a source root with no `node_modules` directory or no `bun.lock`
- **WHEN** the bundler runs
- **THEN** it SHALL exit with code 2 and write nothing to the target

#### Scenario: Audit rejection
- **GIVEN** an emitted bundle that keeps a bare package specifier as an import
- **WHEN** the audit runs on it
- **THEN** the bundler SHALL exit with code 1 and name the specifier
