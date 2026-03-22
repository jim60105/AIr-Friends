## ADDED Requirements

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
