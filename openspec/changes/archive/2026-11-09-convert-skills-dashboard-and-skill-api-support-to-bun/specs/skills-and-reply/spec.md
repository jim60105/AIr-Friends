# Spec Delta

## MODIFIED Requirements

### Requirement: Send-File Workspace Boundary

The `send-file` skill SHALL validate every requested `filePaths` path before sending any file: each path SHALL be within the user's or agent's workspace, path traversal (`..`) SHALL be blocked, and any invalid, unsafe, or unreadable path SHALL reject the whole invocation.

#### Scenario: Path traversal blocked
- **GIVEN** a `send-file` request with path `../../etc/passwd`
- **WHEN** `validateFilePath()` is called
- **THEN** the system SHALL throw a `SkillError` with code `SKILL_INVALID_PARAMS`

#### Scenario: File within workspace allowed
- **GIVEN** a `send-file` request for a file within the workspace boundary
- **WHEN** `validateFilePath()` is called
- **THEN** the validation SHALL pass and the file SHALL be sent

#### Scenario: Symlink escaping the workspace rejected
- **GIVEN** a workspace containing a symlink `leak.pdf` that resolves to a file outside the workspace/agent-workspace boundary
- **WHEN** a `send-file` request for `leak.pdf` is processed
- **THEN** the invocation SHALL be rejected (real-path containment failure)
- **AND** no file SHALL be read or sent

#### Scenario: One invalid path rejects the whole multi-file call
- **GIVEN** a `send-file` request with `filePaths: ["ok.png", "../../etc/passwd"]` where `ok.png` is within the workspace
- **WHEN** the handler validates the paths
- **THEN** the invocation SHALL be rejected with a validation error
- **AND** no file SHALL be sent to the platform

#### Scenario: Batch exceeding the file-count limit rejected before read
- **GIVEN** `maxFilesPerInvocation` is `2`
- **WHEN** a `send-file` request with 3 file paths is processed
- **THEN** the invocation SHALL be rejected
- **AND** no file SHALL be read or sent

#### Scenario: Batch exceeding the aggregate size limit rejected before read
- **GIVEN** `maxTotalSizeMb` is `5`
- **WHEN** a `send-file` request with two files totaling 6 MB is processed
- **THEN** the invocation SHALL be rejected
- **AND** no file SHALL be read or sent

#### Scenario: Per-file size and extension limits enforced
- **GIVEN** a `send-file` request
- **WHEN** `validateFilePath()` is called
- **THEN** files exceeding `config.maxFileSizeMb` (default: 25 MB) SHALL be rejected, and only files with extensions in `config.allowedExtensions` SHALL be permitted
- **AND** file read failures SHALL return an error without crashing

#### Scenario: Real-path containment blocks symlink escapes
- **GIVEN** a symlink inside the workspace that resolves outside the workspace or agent-workspace boundary
- **WHEN** a `send-file` request for that path is validated
- **THEN** containment SHALL be checked against the file's REAL path (resolved with `realpath`, symlink-aware) and the path SHALL be rejected
- **AND** `stat` and `readFile` follow symlinks, so without this check they would exfiltrate arbitrary host files

#### Scenario: Batch limits checked before any byte is read
- **GIVEN** a multi-file `send-file` invocation
- **WHEN** the batch is processed
- **THEN** the number of files SHALL NOT exceed `config.maxFilesPerInvocation` (default: 10) and the total byte size SHALL NOT exceed `config.maxTotalSizeMb` (default: 50), checked before any file bytes are read
- **AND** validation, batch-limit checks, and file reading SHALL be all-or-nothing (preflight): if any path fails validation, any limit is exceeded, or any read fails, the system SHALL reject the entire invocation and SHALL NOT send any file
