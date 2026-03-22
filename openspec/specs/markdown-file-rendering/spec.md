# Markdown File Rendering

## Purpose

Defines the client-side markdown rendering capabilities for the workspace file viewer, including HTML rendering of `.md` files, rendered/raw toggle, plain text display for `.txt` files, and content container switching.

## Requirements

### Requirement: Markdown Rendering for .md Files

When a `.md` file is loaded in the Workspace file viewer, the system SHALL render the file content as formatted HTML by default using a client-side markdown parser. The rendered output SHALL display in a styled container with appropriate typography for headings, paragraphs, lists, code blocks, blockquotes, links, tables, and horizontal rules.

#### Scenario: Markdown file renders as HTML by default

- **WHEN** the user clicks a `.md` file in the workspace tree
- **THEN** the file content SHALL be rendered as formatted HTML (not raw markdown text)
- **AND** markdown elements (headings, lists, code blocks, links) SHALL be visually styled

#### Scenario: Markdown rendering library unavailable

- **WHEN** the user clicks a `.md` file and the markdown library failed to load
- **THEN** the file content SHALL fall back to plain text display in the `<pre>` block

### Requirement: Rendered/Raw Toggle for Markdown Files

When a `.md` file is displayed, a toggle button SHALL appear in the file header area allowing the user to switch between rendered markdown view and raw text view.

#### Scenario: Toggle from rendered to raw view

- **GIVEN** a `.md` file is displayed in rendered markdown view
- **WHEN** the user clicks the toggle button
- **THEN** the rendered markdown container SHALL be hidden
- **AND** the raw markdown text SHALL be displayed in the `<pre>` block

#### Scenario: Toggle from raw to rendered view

- **GIVEN** a `.md` file is displayed in raw text view
- **WHEN** the user clicks the toggle button
- **THEN** the `<pre>` block SHALL be hidden
- **AND** the rendered markdown SHALL be displayed

#### Scenario: Toggle button hidden for non-markdown files

- **WHEN** a `.txt` file is loaded in the file viewer
- **THEN** the toggle button SHALL NOT be visible

#### Scenario: Toggle state resets when loading a new file

- **GIVEN** a `.md` file is displayed in raw text view (toggled)
- **WHEN** the user clicks a different `.md` file in the workspace tree
- **THEN** the new file SHALL be displayed in rendered markdown view (default)

### Requirement: Plain Text Rendering for .txt Files

When a `.txt` file is loaded in the Workspace file viewer, the system SHALL display the file content as plain text in a monospace `<pre>` block, preserving the current behavior.

#### Scenario: Text file renders as plain text

- **WHEN** the user clicks a `.txt` file in the workspace tree
- **THEN** the file content SHALL be displayed as plain text in a monospace `<pre>` block
- **AND** whitespace and line breaks SHALL be preserved exactly as in the file

### Requirement: Content Container Switching

The file viewer SHALL use two mutually exclusive content containers: a `<pre>` element for plain text and a `<div>` element for rendered markdown. Only one container SHALL be visible at a time based on the file type.

#### Scenario: Switching from markdown to text file

- **GIVEN** a `.md` file is currently displayed as rendered markdown
- **WHEN** the user clicks a `.txt` file in the workspace tree
- **THEN** the rendered markdown container SHALL be hidden
- **AND** the plain text `<pre>` container SHALL be shown with the new file content

#### Scenario: Switching from text to markdown file

- **GIVEN** a `.txt` file is currently displayed as plain text
- **WHEN** the user clicks a `.md` file in the workspace tree
- **THEN** the plain text `<pre>` container SHALL be hidden
- **AND** the rendered markdown container SHALL be shown with the formatted content
