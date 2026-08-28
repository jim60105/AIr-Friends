# Delta: git-backup

## ADDED Requirements

### Requirement: Expected git exit codes are not errors

The git execution helper SHALL accept an explicit set of expected exit codes per invocation. An exit code within the expected set SHALL be logged at DEBUG level (with the command args and code), not ERROR. Only unexpected non-zero exit codes SHALL log "Git command failed" at ERROR. State-probe commands SHALL declare their legitimate non-zero codes: `diff --cached --quiet` expects exit 1 to mean "staged changes exist" (the normal backup-needed path) and `rev-parse --verify HEAD` expects exit 128 to mean "no commits yet" (fresh-repository initialization). Operation commands (add, commit, push, pull, fetch, clone) keep ERROR logging for all non-zero codes.

#### Scenario: Staged-changes probe is not an error
- **GIVEN** the data directory has staged changes awaiting backup
- **WHEN** the periodic backup runs `git diff --cached --quiet`
- **THEN** the exit code 1 SHALL be logged at DEBUG and the backup SHALL proceed to commit and push
- **AND** no ERROR-level "Git command failed" entry SHALL be produced

#### Scenario: Unexpected git failure still errors loudly
- **GIVEN** a misconfigured remote
- **WHEN** `git push` exits non-zero
- **THEN** the failure SHALL be logged at ERROR with redacted credentials, as before
