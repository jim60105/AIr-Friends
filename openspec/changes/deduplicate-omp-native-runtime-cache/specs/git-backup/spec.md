# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Data directory .gitignore is operator-owned

The service SHALL NOT create, overwrite, or modify the `.gitignore` file in the data directory during initialization or backup, and SHALL NOT manipulate the git index to untrack files on the assumption of generated ignore rules. The reserved runtime-cache policy is the sole named exception and SHALL NOT be used to untrack files because of generated ignore rules. Whatever `.gitignore` the operator provides (via clone or manual creation) SHALL remain byte-identical across any number of backup cycles.

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
