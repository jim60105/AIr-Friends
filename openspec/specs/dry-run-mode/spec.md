# Dry Run Mode

## Purpose

Debug and prompt-engineering mode that assembles context normally but skips ACP Agent execution, writing the assembled prompt to an output file at zero API cost. Useful for CI/CD smoke tests and prompt iteration.

## Requirements

### Requirement: Activation

Dry run mode SHALL be activated when `agent.dryRun.enabled` is `true`. The `--dry-run` CLI flag or the `DRY_RUN_ENABLED` environment variable MAY be used to enable it. When enabled, the system SHALL log a warning indicating dry run mode is active.

#### Scenario: Dry run enabled via config
- **GIVEN** `agent.dryRun.enabled` is `true`
- **WHEN** a session is processed
- **THEN** the system SHALL skip Agent execution and write the prompt to file

#### Scenario: Dry run disabled
- **GIVEN** `agent.dryRun.enabled` is `false` (or not configured)
- **WHEN** a session is processed
- **THEN** the `handleDryRun` method SHALL return `null` and normal Agent execution SHALL proceed

### Requirement: Normal Steps Execute

When dry run mode is active, the system SHALL execute steps 1 through 6 of the session flow normally: workspace setup, session registration, context assembly, prompt rendering, and all related operations. The ACP Agent connector SHALL NOT be created and no Agent subprocess SHALL be spawned.

#### Scenario: Context assembly in dry run
- **GIVEN** dry run mode is enabled
- **WHEN** a message triggers a session
- **THEN** workspace setup, context assembly, and prompt rendering SHALL execute normally
- **AND** no ACP Agent connection SHALL be established

### Requirement: Prompt Output File

The assembled prompt SHALL be written to a file in the configured output directory (`agent.dryRun.outputPath`). The output directory SHALL be created recursively if it does not exist. The filename SHALL follow the pattern `{sessionType}_{timestamp}.md` where `timestamp` is an ISO 8601 string with colons and dots replaced by hyphens. When a `shellSessionId` is available, the first 8 characters SHALL be appended as a suffix: `{sessionType}_{timestamp}_{shellSessionId8}.md`.

#### Scenario: Output file naming
- **GIVEN** dry run mode is enabled with `outputPath` set to `"./data/dry-run/"`
- **WHEN** a normal message session runs at `2025-01-15T10:30:00.000Z`
- **THEN** the prompt SHALL be written to `./data/dry-run/reply_2025-01-15T10-30-00-000Z.md`

#### Scenario: All session types supported
- **GIVEN** dry run mode is enabled
- **WHEN** sessions of type `reply`, `spontaneous`, `self_research`, `memory_maintenance`, or `reminder` are processed
- **THEN** each SHALL write its assembled prompt to the output directory with the corresponding session type prefix

### Requirement: Mock Reply

When `agent.dryRun.mockReply` is a non-empty string, the system SHALL send the mock reply text to the platform via the platform adapter, provided a `workspaceKey`, `channelId`, and platform adapter are available. The mock reply SHALL be threaded to the original trigger message using `replyToMessageId`. If sending the mock reply fails, the error SHALL be logged as a warning (non-fatal).

#### Scenario: Mock reply sent
- **GIVEN** dry run mode is enabled with `mockReply` set to `"（Dry run 模式 — 此為測試回覆）"`
- **AND** the session has a platform adapter and trigger event
- **WHEN** dry run completes
- **THEN** the mock reply text SHALL be sent to the platform as a reply to the trigger message

#### Scenario: Mock reply empty
- **GIVEN** dry run mode is enabled with `mockReply` set to `""`
- **WHEN** dry run completes
- **THEN** no reply SHALL be sent to the platform

#### Scenario: No platform adapter available
- **GIVEN** dry run mode is enabled with a non-empty `mockReply`
- **AND** no platform adapter is available (e.g., self-research or maintenance session)
- **WHEN** dry run completes
- **THEN** no reply SHALL be sent and no error SHALL occur

### Requirement: Session Response

The `handleDryRun` method SHALL return a `SessionResponse` with `success: true` and `replySent` set to whether a mock reply was actually sent. After dry run completes, the session SHALL be cleaned up normally (session registry removal, SESSION_ID file deletion, workspace tmp cleanup).

#### Scenario: Successful dry run response
- **GIVEN** dry run mode is enabled
- **WHEN** the session completes
- **THEN** the returned response SHALL have `success: true`
- **AND** session resources SHALL be cleaned up identically to a normal session

### Requirement: Configuration

Dry run mode SHALL be configured under `agent.dryRun` with the following fields:

| Field        | Type    | Default                              | Description                          |
| ------------ | ------- | ------------------------------------ | ------------------------------------ |
| `enabled`    | boolean | `false`                              | Enable dry run mode                  |
| `outputPath` | string  | `"./data/dry-run/"`                  | Output directory for assembled prompts |
| `mockReply`  | string  | `"（Dry run 模式 — 此為測試回覆）"` | Mock reply text (empty = no reply)   |

#### Scenario: Default configuration values
- **GIVEN** no `agent.dryRun` configuration is provided
- **WHEN** the configuration is loaded
- **THEN** `enabled` SHALL default to `false`
- **AND** `outputPath` SHALL default to `"./data/dry-run/"`
- **AND** `mockReply` SHALL default to `"（Dry run 模式 — 此為測試回覆）"`

### Requirement: Environment Variable Overrides

The following environment variables SHALL override their corresponding configuration values:

| Environment Variable   | Config Path             | Type   |
| ---------------------- | ----------------------- | ------ |
| `DRY_RUN_ENABLED`      | `agent.dryRun.enabled`  | Boolean |
| `DRY_RUN_OUTPUT_PATH`  | `agent.dryRun.outputPath` | String |
| `DRY_RUN_MOCK_REPLY`   | `agent.dryRun.mockReply` | String |

#### Scenario: Enable via environment variable
- **GIVEN** `DRY_RUN_ENABLED` is set to `"true"`
- **WHEN** configuration is loaded
- **THEN** `agent.dryRun.enabled` SHALL be `true`
