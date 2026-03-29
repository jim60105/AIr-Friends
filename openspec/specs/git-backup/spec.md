# Git Backup

## Purpose

Periodically backs up the `data/` directory to a remote Git repository, with smart initialization, conflict resolution, and graceful shutdown support.

## Requirements

### Requirement: GitBackupScheduler extends BaseScheduler

The `GitBackupScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while providing its fixed-interval scheduling and immediate-first-execution behavior.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `GitBackupScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and use `getNextDelayMs()` to return the configured `intervalMs`

#### Scenario: Immediate execution on first start preserved
- **WHEN** `start()` is called without restored state
- **THEN** the scheduler SHALL execute immediately (delay of 0) on first start, matching current behavior

### Requirement: Fixed-Interval Scheduling

The `GitBackupScheduler` SHALL execute backups at a fixed interval defined by `gitBackup.intervalMs`. The scheduler SHALL execute immediately on first start (when no restored state exists), then schedule subsequent executions at the configured interval. When a backup is already running, the scheduler SHALL skip the current execution and schedule the next one.

#### Scenario: Scheduler start
- **GIVEN** `gitBackup.enabled` is `true` and `intervalMs` is `3600000`
- **WHEN** the scheduler starts
- **THEN** a backup SHALL execute immediately
- **AND** the next backup SHALL be scheduled 1 hour later

#### Scenario: Scheduler disabled
- **GIVEN** `gitBackup.enabled` is `false`
- **WHEN** the scheduler starts
- **THEN** no backup timer SHALL be created

#### Scenario: Concurrent execution guard
- **GIVEN** a backup is already in progress
- **WHEN** the timer fires
- **THEN** the execution SHALL be skipped with a warning log
- **AND** the next timer SHALL be scheduled

### Requirement: Smart Initialization

`GitBackupService.initialize()` SHALL detect the directory state and apply the appropriate initialization strategy. The directory SHALL be resolved to an absolute path. Before any git operations, the service SHALL mark the directory as `safe.directory` via `git config --global` and clean stale `.git/index.lock` files.

#### Scenario: Empty directory (Case A — clone)
- **GIVEN** the data directory is empty
- **WHEN** `initialize()` is called
- **THEN** the service SHALL clone the remote repository into the directory
- **AND** configure `user.name` and `user.email`
- **AND** ensure `.gitignore` exists
- **AND** detect the remote default branch (preferring `master` over `main`)
- **AND** if clone fails, fall back to Case B (init from existing)

#### Scenario: Non-empty non-Git directory (Case B — init)
- **GIVEN** the data directory contains files but no `.git` directory
- **WHEN** `initialize()` is called
- **THEN** the service SHALL run `git init -b master`
- **AND** configure `user.name`, `user.email`, `.gitignore`, and remote origin
- **AND** commit all existing files with message `initial: {timestamp}`
- **AND** push with fallback conflict resolution

#### Scenario: Existing Git repository (Case C — sync)
- **GIVEN** the data directory contains a `.git` directory
- **WHEN** `initialize()` is called
- **THEN** the service SHALL configure author, `.gitignore`, and remote
- **AND** ensure the current branch matches the default branch (renaming if needed)
- **AND** commit any uncommitted changes with message `backup: {timestamp}`
- **AND** push with fallback conflict resolution

### Requirement: Backup Execution

`performBackup()` SHALL execute the sequence: deregister submodules → `git add -A` → check for staged changes → `git commit -m "backup: {timestamp}"` → `git push`. If no changes are staged, the backup SHALL succeed without creating a commit. The method SHALL use a reentrance guard to prevent concurrent backups.

#### Scenario: Changes exist
- **GIVEN** files have changed since the last backup
- **WHEN** `performBackup()` runs
- **THEN** a commit SHALL be created with message `backup: {ISO_8601_timestamp}`
- **AND** the commit SHALL be pushed to the remote

#### Scenario: No changes
- **GIVEN** no files have changed since the last backup
- **WHEN** `performBackup()` runs
- **THEN** no commit SHALL be created and the method SHALL return `true`

#### Scenario: Concurrent backup prevention
- **GIVEN** a backup is already in progress (`isPerformingBackup` is `true`)
- **WHEN** `performBackup()` is called again
- **THEN** it SHALL return `true` immediately with a warning log

### Requirement: Authentication

The service SHALL build an authenticated URL by injecting credentials into the remote URL. The password SHALL be resolved from `gitBackup.authPassword`, falling back to the `GITHUB_TOKEN` environment variable. The username SHALL be resolved from `gitBackup.authUser`, then `gitBackup.authorEmail`, then `"x-access-token"`. If no password is available, the plain remote URL SHALL be used. Credentials in git command output SHALL be redacted in logs: stdout/stderr content replaces `//user:pass@` with `//***:***@`, and any command argument containing `@` SHALL be logged as `[REDACTED_URL]`.

#### Scenario: Auth with configured credentials
- **GIVEN** `authUser` is `"bot"` and `authPassword` is `"secret"`
- **WHEN** a push is executed
- **THEN** the URL SHALL include `bot:secret` as credentials

#### Scenario: Auth fallback to GITHUB_TOKEN
- **GIVEN** `authPassword` is not configured and `GITHUB_TOKEN` is set
- **WHEN** a push is executed
- **THEN** the `GITHUB_TOKEN` value SHALL be used as the password

### Requirement: Push Conflict Resolution

When a direct push fails, the service SHALL attempt conflict resolution in order:

1. **Attempt 1**: Direct `git push`
2. **Attempt 2**: `git fetch` → `git rebase origin/{branch}` → `git push` (if rebase fails, abort rebase; if abort itself fails, fall back to `git reset --hard HEAD`)
3. **Attempt 3**: Create a `backup-{datetime}` fallback branch → push to that branch → switch back to the default branch

During periodic backups (`performBackup`), the conflict resolution SHALL be limited to: direct push → fetch + rebase + retry push. If the retry also fails, the backup SHALL return `false`.

#### Scenario: Push conflict during initialization
- **GIVEN** a direct push is rejected during initialization
- **WHEN** rebase also fails
- **THEN** a `backup-{ISO_datetime}` branch SHALL be created and pushed
- **AND** the service SHALL switch back to the default branch

#### Scenario: Push conflict during periodic backup
- **GIVEN** a direct push fails during `performBackup()`
- **WHEN** fetch and rebase succeed
- **THEN** the push SHALL be retried once
- **AND** if the retry fails, `performBackup()` SHALL return `false`

### Requirement: Author Configuration

All git commands SHALL set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` environment variables from `gitBackup.authorName` and `gitBackup.authorEmail`. `GIT_TERMINAL_PROMPT` SHALL be set to `"0"` to prevent interactive prompts.

#### Scenario: Author identity
- **GIVEN** `authorName` is `"AIr-Friends Backup"` and `authorEmail` is `"bot@example.com"`
- **WHEN** a commit is created
- **THEN** the commit author and committer SHALL be `"AIr-Friends Backup" <bot@example.com>`

### Requirement: Graceful Shutdown Final Backup

A final backup SHALL be performed during the application's graceful shutdown sequence.

#### Scenario: Shutdown backup
- **GIVEN** the git backup service is initialized and the application is shutting down
- **WHEN** the shutdown handler runs
- **THEN** `performBackup()` SHALL be called to commit and push any remaining changes

### Requirement: Gitignore Management

The service SHALL ensure a `.gitignore` file exists in the data directory containing exclusions for: `scheduler-state.json`, `**/.git`, `**/tmp/**`, `.DS_Store`, and `Thumbs.db`. After writing `.gitignore`, the service SHALL remove `scheduler-state.json` from the git index if previously tracked.

#### Scenario: Gitignore creation
- **GIVEN** the data directory has no `.gitignore`
- **WHEN** initialization runs
- **THEN** a `.gitignore` SHALL be created with the standard exclusion rules

### Requirement: Submodule Deregistration

Before staging files, the service SHALL deregister all submodules via `git submodule deinit --all --force` and remove `.gitmodules` if it exists. This prevents nested `.git` directories (from agent-created repos in workspaces) from being tracked as submodules.

#### Scenario: Nested git repos in workspaces
- **GIVEN** a workspace directory contains a `.git` subdirectory
- **WHEN** a backup runs
- **THEN** submodules SHALL be deregistered before `git add -A`

### Requirement: Environment Variable Overrides

The following environment variables SHALL override their corresponding configuration values:

| Environment Variable      | Config Path              | Type    |
| ------------------------- | ------------------------ | ------- |
| `GIT_BACKUP_ENABLED`      | `gitBackup.enabled`      | Boolean |
| `GIT_BACKUP_REMOTE_URL`   | `gitBackup.remoteUrl`    | String  |
| `GIT_BACKUP_INTERVAL_MS`  | `gitBackup.intervalMs`   | Number  |
| `GIT_BACKUP_AUTHOR_NAME`  | `gitBackup.authorName`   | String  |
| `GIT_BACKUP_AUTHOR_EMAIL` | `gitBackup.authorEmail`  | String  |
| `GIT_BACKUP_AUTH_USER`    | `gitBackup.authUser`     | String  |
| `GIT_BACKUP_AUTH_PASSWORD` | `gitBackup.authPassword` | String  |

#### Scenario: Override via environment variables
- **GIVEN** `GIT_BACKUP_ENABLED=true` and `GIT_BACKUP_INTERVAL_MS=1800000`
- **WHEN** the configuration is loaded
- **THEN** git backup SHALL be enabled with interval 1,800,000 ms
