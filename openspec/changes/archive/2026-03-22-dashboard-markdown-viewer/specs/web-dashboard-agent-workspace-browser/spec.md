## MODIFIED Requirements

### Requirement: File Content Viewing

`GET /api/workspace/file?path=<relative-path>` SHALL return the content of a file within `agent-workspace`. Only `.md` and `.txt` files SHALL be readable. The path parameter SHALL be normalized by stripping any leading `/` before validation. After normalization, the path MUST NOT contain `..` segments or `%2F` sequences. The resolved path MUST be within the agent workspace directory.

The client-side file viewer SHALL differentiate between `.md` and `.txt` files: `.md` files SHALL be rendered as formatted HTML using a client-side markdown parser, while `.txt` files SHALL continue to be displayed as plain text in a `<pre>` block.

#### Scenario: Returns File Content for Valid Markdown File

- **GIVEN** `data/agent-workspace/notes/_index.md` exists with content `"# Index\n- Topic A"`
- **WHEN** a `GET /api/workspace/file?path=notes/_index.md` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with the file content

#### Scenario: File path with leading slash

- **WHEN** a request is made to `/api/workspace/file?path=%2Fjournal%2F2026-02-23.md`
- **THEN** the system strips the leading `/` and serves the file at `journal/2026-02-23.md` relative to the agent workspace

#### Scenario: File path without leading slash

- **WHEN** a request is made to `/api/workspace/file?path=journal%2F2026-02-23.md`
- **THEN** the system serves the file at `journal/2026-02-23.md` relative to the agent workspace

#### Scenario: Returns 400 for Disallowed Extension

- **GIVEN** `data/agent-workspace/notes/data.json` exists
- **WHEN** a `GET /api/workspace/file?path=notes/data.json` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400 indicating the file extension is not allowed

#### Scenario: Returns 404 for Nonexistent File

- **GIVEN** `data/agent-workspace/notes/missing.md` does not exist
- **WHEN** a `GET /api/workspace/file?path=notes/missing.md` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 404

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/file?path=notes/_index.md` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401
