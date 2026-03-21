# Web Dashboard Agent Workspace Browser

## Purpose

Defines the read-only file browser for the agent workspace directory, including directory listing, file content viewing, and path traversal protection.

## ADDED Requirements

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

`GET /api/workspace/file?path=<relative-path>` SHALL return the content of a file within `agent-workspace`. Only `.md` and `.txt` files SHALL be readable.

#### Scenario: Returns File Content for Valid Markdown File

- **GIVEN** `data/agent-workspace/notes/_index.md` exists with content `"# Index\n- Topic A"`
- **WHEN** a `GET /api/workspace/file?path=notes/_index.md` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with the file content

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

#### Scenario: Rejects Absolute Paths

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/file?path=/etc/passwd` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400

#### Scenario: Rejects Encoded Traversal Sequences

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/file?path=..%2F..%2F..%2Fetc%2Fpasswd` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400
