## MODIFIED Requirements

### Requirement: Deno Runtime with Explicit Permissions

The system SHALL use Deno 2.x as the runtime environment with explicit permission flags. The system SHALL NOT use `--allow-all`.

#### Scenario: Required Permission Flags

- **GIVEN** the application is started via `deno run` or `deno task start`
- **WHEN** the process launches
- **THEN** the following permission flags SHALL be declared: `--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`, `--allow-run`, `--allow-ffi`

#### Scenario: Development Mode with Hot Reload

- **GIVEN** a developer runs `deno task dev`
- **WHEN** the task executes
- **THEN** the process SHALL start with `--watch` flag and all required permissions

#### Scenario: Tests run with native module permission

- **GIVEN** a developer or CI runs any `deno task` that executes tests
- **WHEN** the task executes
- **THEN** the process SHALL include `--allow-ffi` so native modules used by the application can load

#### Scenario: Container image can load the segmenter

- **GIVEN** the container image is built from `Containerfile`
- **WHEN** the container starts with its default command
- **THEN** the command SHALL include `--allow-ffi`
- **AND** the vendored `assets/` directory SHALL be present in the image
