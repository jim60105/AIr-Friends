## MODIFIED Requirements

### Requirement: Workspace file retrieval
The system SHALL serve workspace file contents via the `/api/workspace/file` endpoint. The endpoint SHALL accept a `path` query parameter and return the file content as JSON. The path parameter SHALL be normalized by stripping any leading `/` before validation. After normalization, the path MUST NOT contain `..` segments or `%2F` sequences. The resolved path MUST be within the agent workspace directory.

#### Scenario: File path with leading slash
- **WHEN** a request is made to `/api/workspace/file?path=%2Fjournal%2F2026-02-23.md`
- **THEN** the system strips the leading `/` and serves the file at `journal/2026-02-23.md` relative to the agent workspace

#### Scenario: File path without leading slash
- **WHEN** a request is made to `/api/workspace/file?path=journal%2F2026-02-23.md`
- **THEN** the system serves the file at `journal/2026-02-23.md` relative to the agent workspace

#### Scenario: Path traversal attempt with leading slash
- **WHEN** a request is made to `/api/workspace/file?path=%2F..%2Fetc%2Fpasswd`
- **THEN** the system returns 400 "Invalid path"
