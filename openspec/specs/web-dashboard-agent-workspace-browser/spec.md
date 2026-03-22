# Web Dashboard Agent Workspace Browser

## Purpose

Defines the read-only file browser for the agent workspace directory, including directory listing, file content viewing, and path traversal protection.

## Requirements

### Requirement: Directory Listing

`GET /api/workspace/tree` SHALL return a JSON tree of files and directories under `data/agent-workspace/`. Each entry SHALL include `name`, `path` (relative to agent-workspace), `type` (`"file"` or `"directory"`), and `size`.

#### Scenario: Returns Tree Structure

- **GIVEN** `data/agent-workspace/` contains `notes/_index.md` and `journal/2025-01-01.md`
- **WHEN** a `GET /api/workspace/tree` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON tree reflecting the directory structure
- **AND** each entry SHALL include `name`, `path`, `type`, and `size`

#### Scenario: Returns Empty for Empty Workspace

- **GIVEN** `data/agent-workspace/` exists but contains no files
- **WHEN** a `GET /api/workspace/tree` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with an empty JSON tree

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/tree` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

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

### Requirement: Path Traversal Protection

The workspace browser SHALL reject any path that resolves outside the `agent-workspace` directory.

#### Scenario: Rejects Parent Directory Traversal

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/file?path=../../../etc/passwd` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400

#### Scenario: Leading Slash Stripped Before Validation

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/file?path=/etc/passwd` request is received with a valid session cookie
- **THEN** the server SHALL strip the leading `/` and validate the remaining path `etc/passwd`

#### Scenario: Path traversal attempt with leading slash

- **WHEN** a request is made to `/api/workspace/file?path=%2F..%2Fetc%2Fpasswd`
- **THEN** the system returns 400 "Invalid path"

#### Scenario: Rejects Encoded Traversal Sequences

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/file?path=..%2F..%2F..%2Fetc%2Fpasswd` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400

### Requirement: Directory Tree Folding

The workspace directory tree SHALL support folding and expanding directories by clicking on directory entries. When a directory is collapsed, its children SHALL be hidden with a smooth transition animation. The collapse state SHALL be toggled by clicking the directory row.

#### Scenario: Clicking a directory collapses it

- **GIVEN** a directory entry is expanded showing its children
- **WHEN** the user clicks the directory row
- **THEN** the directory's children SHALL be hidden
- **AND** the arrow indicator SHALL rotate to indicate collapsed state

#### Scenario: Clicking a collapsed directory expands it

- **GIVEN** a directory entry is collapsed with its children hidden
- **WHEN** the user clicks the directory row
- **THEN** the directory's children SHALL become visible
- **AND** the arrow indicator SHALL rotate to indicate expanded state

### Requirement: Full-Height Workspace Layout

The workspace page section SHALL occupy the full available viewport height, matching the layout behavior of the Chat tab. The workspace tree and file content panels SHALL expand to fill the available space.

#### Scenario: Workspace fills viewport height

- **WHEN** the user navigates to the Workspace tab
- **THEN** the workspace section SHALL extend to fill the viewport height minus the header area
- **AND** there SHALL be no empty space at the bottom of the page

#### Scenario: Workspace panels scroll independently

- **GIVEN** the workspace section fills the viewport height
- **WHEN** the directory tree or file content exceeds the available space
- **THEN** each panel SHALL scroll independently within its allocated space
