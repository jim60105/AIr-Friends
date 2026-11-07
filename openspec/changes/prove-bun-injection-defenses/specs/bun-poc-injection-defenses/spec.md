# Spec Delta

## Purpose

Defines what the hardened skill invocation and exact approval grammar must prove under the pinned Bun, against an attacker-writable environment, before the Bun migration may proceed.

## ADDED Requirements

### Requirement: Working Directory Cannot Alter A Trusted Skill

A trusted skill started by direct execution or by the literal `bun run` form SHALL produce the same exit code and output from an attacker-controlled working directory as from an empty one, and SHALL execute no attacker file.

#### Scenario: Environment files
- **GIVEN** a working directory with `.env` and `.env.local` defining attacker variables
- **WHEN** the skill runs in each invocation form
- **THEN** output and exit code SHALL equal the control run and no attacker variable SHALL be visible to the skill

#### Scenario: Config file preload
- **GIVEN** a working directory with a `bunfig.toml` preloading an attacker script
- **WHEN** the skill runs in each invocation form
- **THEN** the attacker script SHALL not run and output SHALL equal the control run

#### Scenario: Project files
- **GIVEN** a working directory with `tsconfig.json` path overrides, a `package.json` script named after the skill and a `node_modules` tree
- **WHEN** the skill runs in each invocation form
- **THEN** no attacker file SHALL run and output SHALL equal the control run

### Requirement: Home Directory Cannot Alter A Trusted Skill

A trusted skill SHALL ignore `.bunfig.toml` in `$HOME` and in `$XDG_CONFIG_HOME`.

#### Scenario: Global config preload
- **GIVEN** `$HOME` and `$XDG_CONFIG_HOME` each holding a `.bunfig.toml` that preloads an attacker script
- **WHEN** the skill runs in each invocation form
- **THEN** the attacker script SHALL not run and output SHALL equal the control run

### Requirement: Trusted Config File Shape

The trusted config file SHALL be empty, owned by root and not writable by the skill user.

#### Scenario: File in the image
- **GIVEN** the proof-of-concept image
- **WHEN** `/opt/air/skill-bunfig.toml` is inspected as UID 1000
- **THEN** its size SHALL be 0, its owner UID SHALL be 0 and opening it for writing SHALL fail

### Requirement: Missing Trusted Config Stops The Skill

With the trusted config file absent, neither the skill nor a working-directory preload SHALL run in either invocation form, and the observed Bun behavior SHALL be recorded.

#### Scenario: Bun stops by itself
- **GIVEN** the config path is absent and the working directory holds a preloading `bunfig.toml`
- **WHEN** the skill starts and Bun exits non-zero without running anything
- **THEN** the suite SHALL record `missingConfigBehavior` as `fail-stop`

#### Scenario: Bun falls back
- **GIVEN** the config path is absent and the working directory holds a preloading `bunfig.toml`
- **WHEN** Bun runs the skill or the preload
- **THEN** the suite SHALL record `missingConfigBehavior` as `fallback` and SHALL require the launcher to stop the skill before Bun starts

### Requirement: Exact Approval Grammar

The approval grammar SHALL accept a trusted script only by direct execution of its path or through the exact literal `bun run` prefix, and SHALL deny every other form.

#### Scenario: Accepted forms
- **GIVEN** a granted script
- **WHEN** its absolute path, a relative path with a slash, or the literal `bun run` form with that path is evaluated, with or without skill arguments
- **THEN** the grammar SHALL return the script

#### Scenario: Denied flags
- **GIVEN** the literal form with any flag added, removed, reordered or replaced, including `--preload`, `--require`, `--import`, `--inspect`, `--env-file`, `--cwd`, `--tsconfig-override` and a different `--config`
- **WHEN** it is evaluated
- **THEN** the grammar SHALL deny it

#### Scenario: Environment prefix
- **GIVEN** a command that sets `BUN_OPTIONS` before a granted script, as an assignment prefix or through `env`
- **WHEN** it is evaluated
- **THEN** the grammar SHALL deny it

#### Scenario: Other launchers and shell syntax
- **GIVEN** `bunx`, `bun x`, `deno run`, a script not granted, or a command containing a shell operator or expansion
- **WHEN** it is evaluated
- **THEN** the grammar SHALL deny it
