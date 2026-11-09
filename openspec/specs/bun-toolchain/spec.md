# bun-toolchain Specification

## Purpose
Defines how the repository declares, installs and resolves its dependencies, path aliases and test-runner settings under Bun, so every developer, CI job and image build sees the same dependency graph.

## Requirements

### Requirement: Frozen Dependency Installation

The repository SHALL declare every dependency in `package.json` with an exact version and SHALL record the resolved graph in `bun.lock`, so a frozen install succeeds only when the two agree.

#### Scenario: Lockfile matches the manifest
- **GIVEN** a clean checkout
- **WHEN** `bun install --frozen-lockfile` runs
- **THEN** it SHALL exit 0 and leave `bun.lock` unchanged

#### Scenario: Manifest drift is rejected
- **GIVEN** a `package.json` dependency version edited without regenerating `bun.lock`
- **WHEN** `bun install --frozen-lockfile` runs
- **THEN** it SHALL exit non-zero

#### Scenario: No version ranges
- **WHEN** `package.json` is read
- **THEN** no `dependencies` or `devDependencies` value SHALL start with `^` or `~` or contain `*`

### Requirement: Path Aliases Resolve Under Bun

The `@core/`, `@platforms/`, `@skills/`, `@types/`, `@utils/` and `@acp/` import prefixes SHALL resolve to the matching directory under `src/` for the Bun runtime, and the type checker SHALL resolve the `@core/`, `@platforms/`, `@skills/`, `@utils/` and `@acp/` prefixes. TypeScript rejects every module specifier beginning with `@types/` (TS6137), so source files SHALL NOT import through `@types/`; the prefix stays configured so Bun keeps resolving it and it cannot shadow the npm type packages.

#### Scenario: Runtime resolution
- **WHEN** Bun imports `@utils/hash.ts`
- **THEN** it SHALL load `src/utils/hash.ts`

#### Scenario: The types alias does not shadow npm type packages
- **WHEN** Bun imports `@types/errors.ts`
- **THEN** it SHALL load `src/types/errors.ts`, and the Bun type package SHALL still be found by the type checker

#### Scenario: The type checker resolves the runtime aliases
- **WHEN** `bun run check` type-checks a file importing through `@utils/`, `@core/`, `@platforms/`, `@skills/` or `@acp/`
- **THEN** the import SHALL produce no error

### Requirement: Native Tokenizer Dependency Is Locked For Both Architectures

`bun.lock` SHALL contain the Linux GNU native packages of `@node-rs/jieba` for both x86_64 and arm64, and the package SHALL load and segment text under Bun.

#### Scenario: Both native packages locked
- **WHEN** `bun.lock` is searched
- **THEN** it SHALL contain `@node-rs/jieba-linux-x64-gnu` and `@node-rs/jieba-linux-arm64-gnu`

#### Scenario: Segmentation under Bun
- **GIVEN** the vendored dictionary `assets/jieba/dict.txt.big`
- **WHEN** Bun builds a segmenter with it and cuts a Traditional Chinese sentence
- **THEN** it SHALL return more than one token

### Requirement: Formatting Check

`bun run fmt:check` SHALL report any TypeScript, JavaScript, JSON or Markdown file under `src/` or `tests/`, excluding `src/dashboard/public/`, that differs from the configured format, and SHALL exit non-zero when one does. YAML, HTML and CSS files are not covered until `migrate-ci-and-docs-to-bun` adds them to the formatter.

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

`bun run check` SHALL type-check the project with the TypeScript compiler, Bun types and the `tsconfig.json` path aliases the TypeScript compiler can resolve, emitting no files.

#### Scenario: Type error fails
- **GIVEN** a file under `src/` assigning a string to a `number` variable
- **WHEN** `bun run check` runs
- **THEN** it SHALL exit non-zero

#### Scenario: Alias and Bun types resolve
- **GIVEN** a file importing a type through `@utils/` and using `Bun.version`
- **WHEN** `bun run check` runs on it
- **THEN** neither the import nor `Bun.version` SHALL produce an error

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
