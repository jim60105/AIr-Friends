# Spec Delta

## Purpose

Defines how the repository declares, installs and resolves its dependencies, path aliases and test-runner settings under Bun, so every developer, CI job and image build sees the same dependency graph.

## ADDED Requirements

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

The `@core/`, `@platforms/`, `@skills/`, `@types/`, `@utils/` and `@acp/` import prefixes SHALL resolve to the matching directory under `src/` for both the Bun runtime and the type checker.

#### Scenario: Runtime resolution
- **WHEN** Bun imports `@utils/hash.ts`
- **THEN** it SHALL load `src/utils/hash.ts`

#### Scenario: The types alias does not shadow npm type packages
- **WHEN** Bun imports `@types/errors.ts`
- **THEN** it SHALL load `src/types/errors.ts`, and the Bun type package SHALL still be found by the type checker

### Requirement: Native Tokenizer Dependency Is Locked For Both Architectures

`bun.lock` SHALL contain the Linux GNU native packages of `@node-rs/jieba` for both x86_64 and arm64, and the package SHALL load and segment text under Bun.

#### Scenario: Both native packages locked
- **WHEN** `bun.lock` is searched
- **THEN** it SHALL contain `@node-rs/jieba-linux-x64-gnu` and `@node-rs/jieba-linux-arm64-gnu`

#### Scenario: Segmentation under Bun
- **GIVEN** the vendored dictionary `assets/jieba/dict.txt.big`
- **WHEN** Bun builds a segmenter with it and cuts a Traditional Chinese sentence
- **THEN** it SHALL return more than one token
