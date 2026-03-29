## ADDED Requirements

### Requirement: Expanded File Viewer

The workspace file viewer SHALL provide an expand button that opens the current file content in a centered modal overlay. The modal SHALL be 80vw × 80vh, scrollable, and dismissible via a close button or backdrop click.

#### Scenario: User expands the file viewer
- **WHEN** a file is loaded in the workspace viewer
- **AND** the user clicks the expand button
- **THEN** a modal overlay SHALL appear centered on screen at 80vw × 80vh
- **AND** the modal SHALL display the same file content (raw or rendered markdown)
- **AND** the modal content SHALL be scrollable if it exceeds the viewport

#### Scenario: User closes the expanded viewer via close button
- **WHEN** the expanded file viewer modal is open
- **AND** the user clicks the close button (×)
- **THEN** the modal SHALL be dismissed

#### Scenario: User closes the expanded viewer via backdrop click
- **WHEN** the expanded file viewer modal is open
- **AND** the user clicks outside the modal content area (on the backdrop)
- **THEN** the modal SHALL be dismissed

#### Scenario: Expand button is hidden when no file is loaded
- **WHEN** no file is currently loaded in the workspace viewer
- **THEN** the expand button SHALL NOT be visible

### Requirement: File Tree Sort Order Toggle

The workspace file tree SHALL support toggling between alphabetical order and time-descending order. A toggle button SHALL be provided in the file tree header. Time-descending order SHALL sort files by modification time (newest first), with directories still appearing before files.

#### Scenario: User switches to time-descending sort
- **WHEN** the file tree is displayed in alphabetical order
- **AND** the user clicks the sort toggle button
- **THEN** the file tree SHALL re-render with files sorted by modification time (newest first)
- **AND** directories SHALL still appear before files at each level

#### Scenario: User switches back to alphabetical sort
- **WHEN** the file tree is displayed in time-descending order
- **AND** the user clicks the sort toggle button
- **THEN** the file tree SHALL re-render with files sorted alphabetically (case-insensitive)

#### Scenario: Sort order is applied recursively
- **WHEN** the sort order is changed
- **THEN** the new sort order SHALL apply to all directory levels in the tree

## MODIFIED Requirements

### Requirement: Directory Listing

`GET /api/workspace/tree` SHALL return a JSON tree of files and directories under `data/agent-workspace/`. Each entry SHALL include `name`, `path` (relative to agent-workspace), `type` (`"file"` or `"directory"`), `size`, and `mtime` (Unix timestamp in milliseconds representing the last modification time).

#### Scenario: Returns Tree Structure

- **GIVEN** `data/agent-workspace/` contains `notes/_index.md` and `journal/2025-01-01.md`
- **WHEN** a `GET /api/workspace/tree` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON tree reflecting the directory structure
- **AND** each entry SHALL include `name`, `path`, `type`, `size`, and `mtime`

#### Scenario: Returns Empty for Empty Workspace

- **GIVEN** `data/agent-workspace/` exists but contains no files
- **WHEN** a `GET /api/workspace/tree` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 200 with an empty JSON tree

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/workspace/tree` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401
