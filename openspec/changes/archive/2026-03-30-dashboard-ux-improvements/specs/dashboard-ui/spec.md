## ADDED Requirements

### Requirement: Collapsible Sidebar

The dashboard sidebar (`<aside>`) SHALL support collapsing to an icon-only mode. A toggle button SHALL be provided to switch between expanded and collapsed states. In collapsed mode, only SVG icons SHALL be visible; text labels SHALL be hidden. The transition SHALL be smooth using CSS transitions. The sidebar state SHALL NOT affect tab navigation functionality.

#### Scenario: User collapses the sidebar
- **WHEN** the user clicks the sidebar toggle button
- **THEN** the sidebar SHALL transition to icon-only mode
- **AND** text labels on navigation buttons SHALL be hidden
- **AND** the main content area SHALL expand to fill the freed space

#### Scenario: User expands the collapsed sidebar
- **WHEN** the user clicks the sidebar toggle button while the sidebar is collapsed
- **THEN** the sidebar SHALL transition back to full width
- **AND** text labels on navigation buttons SHALL become visible

#### Scenario: Tab navigation works in collapsed mode
- **WHEN** the sidebar is in collapsed icon-only mode
- **AND** the user clicks a tab icon
- **THEN** the corresponding tab panel SHALL be displayed

### Requirement: Element ID Attributes

All interactive and significant elements in the dashboard SHALL have unique `id` attributes following kebab-case naming convention (`{section}-{component}-{descriptor}`). This enables reliable test selectors and maintenance tooling.

#### Scenario: Sidebar elements have unique IDs
- **WHEN** the dashboard is rendered
- **THEN** the sidebar toggle button, each tab button, and each action button SHALL have unique `id` attributes

#### Scenario: Workspace elements have unique IDs
- **WHEN** the Workspace tab is rendered
- **THEN** the file tree container, sort toggle button, file viewer, expand button, and modal SHALL have unique `id` attributes

#### Scenario: No duplicate IDs exist
- **WHEN** the dashboard is fully rendered
- **THEN** no two elements SHALL share the same `id` attribute value

## MODIFIED Requirements

### Requirement: Modernized Dashboard UI
The system SHALL provide a modernized, clean, and consistent web dashboard interface following frontend design guidelines. The Session History table SHALL be constrained to its parent container width without producing a horizontal scrollbar. Table content SHALL wrap within cells when it exceeds the available column width. The sidebar SHALL support collapsible icon-only mode with smooth CSS transitions.

#### Scenario: User accesses dashboard
- **WHEN** the user navigates to the dashboard URL
- **THEN** the modernized UI layout and styles SHALL be applied without breaking existing functionalities

#### Scenario: Session History table fits within parent container
- **WHEN** the Session History table is rendered on any viewport width
- **THEN** the table SHALL NOT exceed its parent container width
- **AND** no horizontal scrollbar SHALL appear on the table container

#### Scenario: Long content wraps within table cells
- **WHEN** a Session ID or User ID exceeds the column width
- **THEN** the text SHALL wrap within the cell using word-break
- **AND** the column width SHALL remain fixed
