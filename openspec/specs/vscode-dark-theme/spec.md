# VSCode Dark Theme

## Purpose

Applies the VSCode Dark+ color scheme to the web dashboard, replacing default colors with VSCode-standard surface, accent, and text colors for a consistent developer-friendly appearance.

## Requirements

### Requirement: VSCode Dark+ surface colors
The dashboard Tailwind config SHALL define surface colors matching the VSCode Dark+ theme: `surface.DEFAULT` as `#1e1e1e`, `surface.50` as `#252526`, `surface.100` as `#2d2d30`, `surface.200` as `#3c3c3c`.

#### Scenario: Base background renders VSCode dark
- **WHEN** the dashboard loads
- **THEN** the page background color SHALL be `#1e1e1e`

#### Scenario: Panel backgrounds use sidebar color
- **WHEN** a card or panel element uses `bg-surface-50` or `bg-surface-100`
- **THEN** the rendered background SHALL be `#252526` or `#2d2d30` respectively

### Requirement: VSCode Dark+ accent colors
The dashboard SHALL use a custom `accent` Tailwind color palette with `DEFAULT: #007acc`, `light: #3794ff`, `dark: #0e639c`, and `muted: rgba(0, 122, 204, 0.15)`. All former `indigo-*` class references SHALL be replaced with corresponding `accent` classes.

#### Scenario: Primary buttons use VSCode blue
- **WHEN** a primary action button is displayed
- **THEN** its background color SHALL be `#0e639c` and hover state SHALL use `#007acc`

#### Scenario: No indigo class references remain
- **WHEN** searching `index.html` for the string `indigo`
- **THEN** zero matches SHALL be found

### Requirement: CSS hardcoded colors match VSCode Dark+
All hardcoded hex color values in `style.css` SHALL be updated to their VSCode Dark+ equivalents. Specifically: scrollbar track SHALL be `#2d2d30`, scrollbar thumb SHALL be `#007acc` with hover `#3794ff`, blockquote border SHALL be `#007acc`, link color SHALL be `#3794ff` with hover `#4dabf5`, typing indicator dots SHALL be `#3794ff`, markdown heading colors SHALL use `#d4d4d4`/`#cccccc` shades, inline code background SHALL be `#3c3c3c`, and pre/code block background SHALL be `#252526`.

#### Scenario: Scrollbar uses VSCode accent blue
- **WHEN** a scrollbar thumb is visible
- **THEN** its color SHALL be `#007acc` and hover color SHALL be `#3794ff`

#### Scenario: Markdown links use VSCode blue
- **WHEN** rendered markdown contains a link
- **THEN** the link color SHALL be `#3794ff` and hover color SHALL be `#4dabf5`

#### Scenario: Code blocks use VSCode panel background
- **WHEN** rendered markdown contains a code block
- **THEN** the `pre` background SHALL be `#252526` and inline `code` background SHALL be `#3c3c3c`

### Requirement: Text colors match VSCode foreground
The dashboard primary text color SHALL be `#cccccc` and editor-context text SHALL be `#d4d4d4`, matching VSCode Dark+ foreground colors.

#### Scenario: Body text uses VSCode foreground
- **WHEN** the dashboard body text renders
- **THEN** the text color SHALL be `#cccccc`
