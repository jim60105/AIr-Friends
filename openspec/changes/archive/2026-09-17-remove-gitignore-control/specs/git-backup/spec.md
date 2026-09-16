## MODIFIED Requirements

### Requirement: Smart Initialization

`GitBackupService.initialize()` SHALL detect the directory state and apply the appropriate initialization strategy. The directory SHALL be resolved to an absolute path. Before any git operations, the service SHALL mark the directory as `safe.directory` via `git config --global` and clean stale `.git/index.lock` files. Initialization SHALL NOT create, overwrite, or modify `.gitignore` in the data directory.

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
- **AND** commit all existing files with message `initial: {timestamp}`
- **AND** push with fallback conflict resolution

#### Scenario: Existing Git repository (Case C — sync)
- **GIVEN** the data directory contains a `.git` directory
- **WHEN** `initialize()` is called
- **THEN** the service SHALL configure author and remote
- **AND** ensure the current branch matches the default branch (renaming if needed)
- **AND** commit any uncommitted changes with message `backup: {timestamp}`
- **AND** push with fallback conflict resolution

## REMOVED Requirements

### Requirement: Gitignore Management

**Reason**: The service force-overwrote `{dataDir}/.gitignore` with a hardcoded template on every initialization, silently erasing operator-maintained ignore rules in the data repository. In production this caused runtime artifacts to be tracked and required a git history rewrite. The data repo's `.gitignore` is operator-owned property.

**Migration**: Operators maintain `{dataDir}/.gitignore` themselves. Apply the recommended baseline documented in `docs/DESIGN.md` (Git Backup section) — at minimum `scheduler-state.json`, `**/.git`, `**/tmp/**`, `.DS_Store`, `Thumbs.db`, plus the runtime directories (`channel-tmp/`, `opencode-data/`, `channel-cwd/`, `skill-jwt/`, `skill-secret`) and media/binary globs. The `git rm --cached scheduler-state.json` index cleanup performed by the removed method is likewise operator responsibility now; run it once manually if the file is still tracked.

## ADDED Requirements

### Requirement: Data directory .gitignore is operator-owned

The service SHALL NOT create, overwrite, or modify the `.gitignore` file in the data directory during initialization or backup, and SHALL NOT manipulate the git index to untrack files on the assumption of generated ignore rules. Whatever `.gitignore` the operator provides (via clone or manual creation) SHALL remain byte-identical across any number of backup cycles.

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
