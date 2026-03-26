## MODIFIED Requirements

### Requirement: Git Backup .gitignore Management

The service SHALL ensure a `.gitignore` file exists in the data directory containing exclusions for: `scheduler-state.json`, `**/.git`, `**/tmp/**`, `.DS_Store`, and `Thumbs.db`. After writing `.gitignore`, the service SHALL remove `scheduler-state.json` from the git index if previously tracked.

#### Scenario: .gitignore excludes standard files
- **GIVEN** the git backup service initializes
- **WHEN** it ensures `.gitignore` exists
- **THEN** the `.gitignore` SHALL contain `scheduler-state.json`, `**/.git`, `**/tmp/**`, `.DS_Store`, and `Thumbs.db`
- **AND** it SHALL NOT contain `SESSION_ID` (no longer written as a file)
