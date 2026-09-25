## MODIFIED Requirements

### Requirement: Deno Project Structure

The project SHALL use `deno.json` as the central configuration file with import aliases and task definitions.

#### Scenario: Import Aliases

- **GIVEN** `deno.json` defines import aliases
- **WHEN** source code imports modules
- **THEN** the following aliases SHALL be available: `@core/` → `./src/core/`, `@platforms/` → `./src/platforms/`, `@skills/` → `./src/skills/`, `@types/` → `./src/types/`, `@utils/` → `./src/utils/`, `@acp/` → `./src/acp/`

#### Scenario: Task Definitions

- **GIVEN** `deno.json` defines tasks
- **WHEN** a developer runs `deno task <name>`
- **THEN** the following tasks SHALL be available: `dev` (watch mode), `start` (production), `test` (parallel tests), `fmt` (format), `lint` (lint), `check` (type check), `ci` (fmt check + lint + type check + test)
- **AND** the `ci` task's fmt-check step SHALL be scoped to `src/` and `tests/` — the same scope as `fmt:check`, matching the GitHub Actions workflow — so the task passes on a repository whose non-code assets (vendored data, docs, archives) are not format-managed

#### Scenario: Formatting Rules

- **GIVEN** `deno.json` defines `fmt` settings
- **WHEN** `deno fmt` runs
- **THEN** it SHALL enforce: `lineWidth: 100`, `indentWidth: 2`, `useTabs: false`, `singleQuote: false`, `proseWrap: "preserve"`

#### Scenario: Compiler Options

- **GIVEN** `deno.json` defines `compilerOptions`
- **WHEN** `deno check` runs
- **THEN** it SHALL enforce: `strict: true`, `noImplicitAny: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`

#### Scenario: Lock File

- **GIVEN** `deno.lock` exists in the repository
- **WHEN** dependencies are resolved
- **THEN** the lock file SHALL be committed to version control
- **AND** CI/container builds SHALL use `--lock=deno.lock` for reproducibility
