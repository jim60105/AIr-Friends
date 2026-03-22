# Web Dashboard Agent Workspace Browser (Delta)

## Purpose

Security additions to the agent workspace browser for XSS prevention in markdown rendering and resource exhaustion protection on directory traversal.

## ADDED Requirements

### Requirement: DOMPurify Sanitization on Markdown Rendering

When rendering `.md` file content in the workspace viewer, the client SHALL pass the HTML output of the markdown parser through DOMPurify before inserting it into the DOM. The DOMPurify configuration SHALL strip `<script>`, `<iframe>`, event handler attributes, and `javascript:` URLs.

#### Scenario: Script tags in markdown are stripped

- **GIVEN** a markdown file contains `<script>alert('xss')</script>`
- **WHEN** the file content is rendered in the workspace viewer
- **THEN** the `<script>` tag SHALL be removed by DOMPurify
- **AND** no script execution SHALL occur

#### Scenario: Event handler attributes are stripped

- **GIVEN** a markdown file contains `<img src="x" onerror="alert('xss')">`
- **WHEN** the file content is rendered in the workspace viewer
- **THEN** the `onerror` attribute SHALL be removed
- **AND** the `<img>` tag MAY remain without the event handler

#### Scenario: Safe markdown elements are preserved

- **GIVEN** a markdown file contains headings, links, code blocks, and lists
- **WHEN** the file content is rendered in the workspace viewer
- **THEN** all safe HTML elements (`<h1>`, `<a>`, `<code>`, `<ul>`, etc.) SHALL be preserved

#### Scenario: Javascript URLs in links are stripped

- **GIVEN** a markdown file contains `[click me](javascript:alert('xss'))`
- **WHEN** the file content is rendered in the workspace viewer
- **THEN** the `javascript:` URL SHALL be removed or neutralized by DOMPurify

### Requirement: Depth and Count Limits on Workspace Tree Traversal

The `GET /api/workspace/tree` endpoint SHALL enforce a maximum directory depth and a maximum total entry count during traversal. When either limit is reached, the traversal SHALL stop and return the entries collected so far. This prevents resource exhaustion from deeply nested or very large directory structures.

#### Scenario: Traversal stops at maximum depth

- **GIVEN** the maximum depth is configured as 10 levels
- **AND** the workspace contains a directory nested 15 levels deep
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** the response SHALL include entries only up to depth 10
- **AND** directories beyond depth 10 SHALL not be traversed

#### Scenario: Traversal stops at maximum entry count

- **GIVEN** the maximum entry count is configured as 1000
- **AND** the workspace contains 1500 files
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** the response SHALL include at most 1000 entries
- **AND** the traversal SHALL stop once the count is reached

#### Scenario: Normal workspace within limits returns complete tree

- **GIVEN** the workspace contains 50 files across 3 directory levels
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** the response SHALL include all 50 entries with complete directory structure
