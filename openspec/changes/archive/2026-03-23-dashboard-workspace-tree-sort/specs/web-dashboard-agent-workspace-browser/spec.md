## ADDED Requirements

### Requirement: Directory Tree Sorted by Name

The `GET /api/workspace/tree` endpoint SHALL return entries sorted alphabetically by name within each directory level. Directories SHALL appear before files at each level. Sorting SHALL be case-insensitive.

#### Scenario: Entries sorted alphabetically within a directory

- **GIVEN** a directory contains files `zebra.md`, `alpha.md`, `middle.md`
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** the children SHALL be ordered as `alpha.md`, `middle.md`, `zebra.md`

#### Scenario: Directories appear before files

- **GIVEN** a directory contains subdirectory `notes/` and file `README.md`
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** `notes/` SHALL appear before `README.md` in the children array

#### Scenario: Case-insensitive sorting

- **GIVEN** a directory contains files `Beta.md`, `alpha.md`, `GAMMA.md`
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** the children SHALL be ordered as `alpha.md`, `Beta.md`, `GAMMA.md`

#### Scenario: Sorting applies recursively to nested directories

- **GIVEN** a nested directory also contains unsorted entries
- **WHEN** a `GET /api/workspace/tree` request is received
- **THEN** entries within the nested directory SHALL also be sorted alphabetically with directories first
