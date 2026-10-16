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

`GitBackupService.initialize()` SHALL detect the directory state and apply the appropriate initialization strategy. The directory SHALL be resolved to an absolute path. Before any git operations, the service SHALL mark the directory as `safe.directory` via `git config --global` and clean stale `.git/index.lock` files. Initialization SHALL NOT create, overwrite, or modify `.gitignore` in the data directory. Reserved runtime-cache exclusions SHALL apply to every initialization commit path.

#### Scenario: Empty directory (Case A — clone)
- **GIVEN** the data directory is empty
- **WHEN** `initialize()` is called
- **THEN** the service SHALL clone the remote repository into the directory
- **AND** configure `user.name` and `user.email`
- **AND** detect the remote default branch (preferring `master` over `main`)
- **AND** if clone fails, fall back to Case B (init from existing)

#### Scenario: Non-empty non-Git directory (Case B — init)
- **GIVEN** the data directory contains files but no `.git` directory
- **WHEN** `initialize()` is called
- **THEN** the service SHALL run `git init -b master`
- **AND** configure `user.name`, `user.email`, and remote origin
- **AND** commit all existing files except reserved runtime-cache entries with message `initial: {timestamp}`
- **AND** push with fallback conflict resolution

#### Scenario: Existing Git repository (Case C — sync)
- **GIVEN** the data directory contains a `.git` directory
- **WHEN** `initialize()` is called
- **THEN** the service SHALL configure author and remote
- **AND** ensure the current branch matches the default branch (renaming if needed)
- **AND** commit any uncommitted changes except reserved runtime-cache entries with message `backup: {timestamp}`
- **AND** push with fallback conflict resolution

#### Scenario: Each initialization variant excludes reserved cache
- **GIVEN** any of the clone, init-from-existing or existing-repository initialization variants runs against a data tree containing reserved cache entries, with or without an existing `HEAD`
- **WHEN** that variant stages and commits
- **THEN** the resulting index and commit tree SHALL contain no reserved cache path
- **AND** ordinary files in the same tree SHALL still be committed

### Requirement: Backup Execution

`performBackup()` SHALL execute the sequence: deregister submodules → remove reserved runtime-cache entries from the index → stage normal changes excluding reserved runtime-cache entries → check for staged changes → `git commit -m "backup: {timestamp}"` → `git push`. If no changes are staged, the backup SHALL succeed without creating a commit. The method SHALL use a reentrance guard to prevent concurrent backups.

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

#### Scenario: Reserved cache never staged by periodic or final backup
- **GIVEN** a periodic or graceful-shutdown final backup runs over pooled and per-spawn roots holding real native payloads and cache symlinks
- **WHEN** `performBackup()` stages and commits
- **THEN** no reserved cache path SHALL appear in the index or the commit, and the native bytes SHALL remain on disk unchanged
- **AND** that result SHALL hold when the same commit also carries ordinary changed data

### Requirement: Authentication

The service SHALL build an authenticated URL by injecting credentials into the remote URL. The password SHALL be resolved from `gitBackup.authPassword`, falling back to the `GITHUB_TOKEN` environment variable; the username SHALL be resolved from `gitBackup.authUser`, then `gitBackup.authorEmail`, then `"x-access-token"`.

#### Scenario: Auth with configured credentials
- **GIVEN** `authUser` is `"bot"` and `authPassword` is `"secret"`
- **WHEN** a push is executed
- **THEN** the URL SHALL include `bot:secret` as credentials

#### Scenario: Auth fallback to GITHUB_TOKEN
- **GIVEN** `authPassword` is not configured and `GITHUB_TOKEN` is set
- **WHEN** a push is executed
- **THEN** the `GITHUB_TOKEN` value SHALL be used as the password

#### Scenario: No password available
- **GIVEN** no password is available from `authPassword` or `GITHUB_TOKEN`
- **WHEN** the authenticated URL is built
- **THEN** the plain remote URL SHALL be used

#### Scenario: Credentials redacted in logs
- **GIVEN** a git command outputs text containing `//user:pass@` or is invoked with a credential-bearing argument
- **WHEN** the command output or arguments are logged
- **THEN** `//user:pass@` SHALL be replaced with `//***:***@` in stdout/stderr content
- **AND** any command argument containing `@` SHALL be logged as `[REDACTED_URL]`

### Requirement: Push Conflict Resolution

When a direct push fails, the service SHALL attempt conflict resolution in order: (1) direct `git push`; (2) `git fetch`, `git rebase origin/{branch}`, `git push`; (3) create a `backup-{datetime}` fallback branch, push it, and switch back to the default branch.

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

#### Scenario: Rebase failure aborts and falls back
- **GIVEN** `git rebase origin/{branch}` fails during conflict resolution
- **WHEN** the rebase fails
- **THEN** the rebase SHALL be aborted
- **AND** if the abort itself fails, the service SHALL fall back to `git reset --hard HEAD`

#### Scenario: Periodic backups use a limited resolution sequence
- **GIVEN** a direct push fails during a periodic backup (`performBackup`)
- **WHEN** conflict resolution is attempted
- **THEN** the resolution SHALL be limited to direct push, then fetch + rebase + retry push

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

### Requirement: Submodule Deregistration

Before staging files, the service SHALL deregister all submodules via `git submodule deinit --all --force` and remove `.gitmodules` if it exists. This prevents nested `.git` directories (from agent-created repos in workspaces) from being tracked as submodules.

#### Scenario: Nested git repos in workspaces
- **GIVEN** a workspace directory contains a `.git` subdirectory
- **WHEN** a backup runs
- **THEN** submodules SHALL be deregistered before `git add -A`

### Requirement: Expected git exit codes are not errors

The git execution helper SHALL accept an explicit set of expected exit codes per invocation. An exit code within the expected set SHALL be logged at DEBUG level (with the command args and code), not ERROR; only unexpected non-zero exit codes SHALL log "Git command failed" at ERROR.

#### Scenario: Staged-changes probe is not an error
- **GIVEN** the data directory has staged changes awaiting backup
- **WHEN** the periodic backup runs `git diff --cached --quiet`
- **THEN** the exit code 1 SHALL be logged at DEBUG and the backup SHALL proceed to commit and push
- **AND** no ERROR-level "Git command failed" entry SHALL be produced

#### Scenario: Unexpected git failure still errors loudly
- **GIVEN** a misconfigured remote
- **WHEN** `git push` exits non-zero
- **THEN** the failure SHALL be logged at ERROR with redacted credentials, as before

#### Scenario: Fresh-repository probe exit 128 is expected
- **GIVEN** `rev-parse --verify HEAD` exits with code 128
- **WHEN** the state-probe command runs during initialization of a fresh repository
- **THEN** the exit code SHALL be logged at DEBUG as meaning "no commits yet"

#### Scenario: Operation commands keep ERROR logging
- **GIVEN** an operation command (add, commit, push, pull, fetch, clone) exits with a non-zero code
- **WHEN** the operation command runs
- **THEN** the exit code SHALL be logged at ERROR with "Git command failed"

### Requirement: Environment Variable Overrides

The following environment variables SHALL override their corresponding configuration values: `GIT_BACKUP_ENABLED` → `gitBackup.enabled`, `GIT_BACKUP_REMOTE_URL` → `gitBackup.remoteUrl`, `GIT_BACKUP_INTERVAL_MS` → `gitBackup.intervalMs`, `GIT_BACKUP_AUTHOR_NAME` → `gitBackup.authorName`, `GIT_BACKUP_AUTHOR_EMAIL` → `gitBackup.authorEmail`, `GIT_BACKUP_AUTH_USER` → `gitBackup.authUser`, `GIT_BACKUP_AUTH_PASSWORD` → `gitBackup.authPassword`.

#### Scenario: Override via environment variables
- **GIVEN** `GIT_BACKUP_ENABLED=true` and `GIT_BACKUP_INTERVAL_MS=1800000`
- **WHEN** the configuration is loaded
- **THEN** git backup SHALL be enabled with interval 1,800,000 ms

#### Scenario: Override values parsed by declared type
- **GIVEN** an override environment variable from the list above is set
- **WHEN** the configuration is loaded
- **THEN** `GIT_BACKUP_ENABLED` SHALL be parsed as a Boolean and `GIT_BACKUP_INTERVAL_MS` as a Number
- **AND** `GIT_BACKUP_REMOTE_URL`, `GIT_BACKUP_AUTHOR_NAME`, `GIT_BACKUP_AUTHOR_EMAIL`, `GIT_BACKUP_AUTH_USER`, and `GIT_BACKUP_AUTH_PASSWORD` SHALL be parsed as Strings

### Requirement: Data directory .gitignore is operator-owned

The service SHALL NOT create, overwrite, or modify the `.gitignore` file in the data directory during initialization or backup, and SHALL NOT manipulate the git index to untrack files on the assumption of generated ignore rules. The reserved runtime-cache policy is the sole exception and SHALL NOT untrack files for generated ignore rules. Whatever `.gitignore` the operator provides (via clone or manual creation) SHALL remain byte-identical across any number of backup cycles.

#### Scenario: Operator .gitignore survives initialization and backup
- **GIVEN** the data directory contains an operator-authored `.gitignore` with custom rules
- **WHEN** `initialize()` and any number of `performBackup()` runs complete
- **THEN** the `.gitignore` file content SHALL be unchanged
- **AND** no commit SHALL be created solely to rewrite `.gitignore`

#### Scenario: No .gitignore present
- **GIVEN** the data directory has no `.gitignore`
- **WHEN** initialization runs
- **THEN** the service SHALL NOT create one
- **AND** backup SHALL proceed normally

#### Scenario: Only the named reserved cache is untracked
- **GIVEN** a tracked file that generated ignore rules would match but that is not a reserved runtime-cache path
- **WHEN** a backup stages the data directory
- **THEN** that file SHALL remain tracked
- **AND** only reserved runtime-cache paths SHALL be removed from the index

### Requirement: Reserved OMP Native Cache Is Excluded From Backup Staging

Backup staging SHALL exclude the reserved OMP native cache entry and every descendant from the index for exactly two repository-relative shapes, where `<mode>` is `restricted` or `native-yolo`: `omp-pools/<pool-key path>/omp-agent/<mode>/xdg-data/omp/natives`, and `<any working-directory path within the backup root>/tmp/omp-agent/<mode>/xdg-data/omp/natives`. Each `<pool-key path>` holds one or more path components.

#### Scenario: Entry and descendants excluded regardless of kind
- **GIVEN** a pooled root holding real native addon files and a per-spawn root holding the managed `omp/natives` link
- **WHEN** a backup stages the data directory
- **THEN** neither reserved entry nor any descendant SHALL enter the index
- **AND** this SHALL hold whether an entry is a real directory, a valid or dangling symlink, currently missing, ignored, staged or already tracked

#### Scenario: Adversarial and missing names
- **GIVEN** a pool-key or working-directory path containing spaces or newlines, or a tracked reserved cache path that is currently missing
- **WHEN** staging runs
- **THEN** reserved-shape matching SHALL remain lexical and reliable
- **AND** a missing tracked entry SHALL not fail the backup by itself

#### Scenario: Multi-component pool keys are covered
- **GIVEN** a pooled OMP root whose pool key contains a separator, such as `memory-maintenance:<platform>/<user-id>`
- **WHEN** a backup stages the data directory
- **THEN** that root's `omp-agent/<mode>/xdg-data/omp/natives` entry and every descendant SHALL be excluded exactly as for a single-component pool key
- **AND** no intermediate path-component depth SHALL bypass the excluded shape
- **AND** each reserved shape SHALL be matched with a top-anchored `:(glob)` exclusion pathspec whose pool-key and working-directory segments span one or more components (`**/`), never a single-component pattern that would under-match a `/`-containing key

### Requirement: Reserved Cache Staging Preserves Ordinary Data And Operator Ignore Rules

The reserved-runtime-cache policy SHALL be the only narrowing of normal staging. Operator `.gitignore` bytes, notes, memories, databases, sessions and unrelated `.node` files SHALL remain staged normally. Exclusions SHALL be applied as part of the staging command, never by staging bytes first and removing them afterwards, and any staging failure SHALL abort that commit and push.

#### Scenario: Ordinary data still staged
- **GIVEN** a data directory containing databases, notes and a user-created `.node` artifact outside the reserved shapes, plus an unrelated `natives` directory
- **WHEN** a backup stages and commits
- **THEN** all of that ordinary data SHALL be staged and committed as before
- **AND** no blanket `*.node` or file-size filter SHALL be applied

#### Scenario: Operator ignore file untouched
- **GIVEN** an operator-authored data `.gitignore`
- **WHEN** any number of backups run under the reserved-cache policy
- **THEN** its bytes SHALL remain identical
- **AND** no generated ignore rule or `.git/info/exclude` entry SHALL be relied on or written

#### Scenario: Tracked or staged cache entries are removed from the index only
- **GIVEN** the index tracks a reserved cache path, or holds a staged cache addition
- **WHEN** backup staging runs
- **THEN** only those matching index entries SHALL be removed, without touching working files and without deleting payload bytes from disk
- **AND** a previously committed cache path SHALL stage its deletion in that ordinary backup commit

#### Scenario: Staging failure aborts the backup
- **GIVEN** reserved-entry index removal or staging fails
- **WHEN** the backup runs
- **THEN** no commit SHALL be created and no push SHALL be attempted
