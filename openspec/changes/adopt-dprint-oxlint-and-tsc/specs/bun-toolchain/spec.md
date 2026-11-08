# Spec Delta

## ADDED Requirements

### Requirement: Formatting Check

`bun run fmt:check` SHALL report any file under `src/` or `tests/` that differs from the configured format and SHALL exit non-zero when one does.

#### Scenario: Clean tree passes
- **GIVEN** a checkout with no formatting drift
- **WHEN** `bun run fmt:check` runs
- **THEN** it SHALL exit 0

#### Scenario: Drift fails
- **GIVEN** a TypeScript file under `src/` with a line indented by four spaces where two are expected
- **WHEN** `bun run fmt:check` runs
- **THEN** it SHALL exit non-zero and name that file

### Requirement: Lint Check

`bun run lint` SHALL lint `src/` and `tests/`, skipping `src/dashboard/public/`, and SHALL exit non-zero on any error-level finding.

#### Scenario: Explicit any without a directive
- **GIVEN** a TypeScript file under `src/` declaring a parameter of type `any` with no disable directive
- **WHEN** `bun run lint` runs
- **THEN** it SHALL exit non-zero

#### Scenario: Directive suppresses one line
- **GIVEN** the same declaration preceded by an `oxlint-disable-next-line typescript/no-explicit-any` comment
- **WHEN** `bun run lint` runs
- **THEN** that line SHALL produce no finding

### Requirement: Type Check

`bun run check` SHALL type-check the project with the TypeScript compiler, Bun types and the `tsconfig.json` path aliases, emitting no files.

#### Scenario: Type error fails
- **GIVEN** a file under `src/` assigning a string to a `number` variable
- **WHEN** `bun run check` runs
- **THEN** it SHALL exit non-zero

#### Scenario: Alias and Bun types resolve
- **GIVEN** a file importing a type through `@types/` and using `Bun.version`
- **WHEN** `bun run check` runs on it
- **THEN** neither the import nor `Bun.version` SHALL produce an error
