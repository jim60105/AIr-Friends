## ADDED Requirements

### Requirement: Fast Recall Note Selection

In Fast Recall mode, notes SHALL be selected independently from memories:

- If the top note score is below `noteMinRecallScore`, no note SHALL be selected.
- Otherwise the first SHALL be selected.
- A second SHALL be selected only if its score is at least `secondNoteRecallScore` and at least `secondResultRatio` × the top note score.
- No more than `fastRecallNoteMaxResults` (default 2) notes SHALL be selected.
- The rendered note entries and their heading SHALL fit within `fastRecallNoteMaxTokens` (default 256), skipping any entry that does not fit.

The note budget SHALL NOT reduce the memory budget, and the memory budget SHALL NOT reduce the note budget.

#### Scenario: Notes do not displace memories
- **GIVEN** two memories and two notes clear their thresholds
- **WHEN** Fast Recall runs with default configuration
- **THEN** both memories and both notes SHALL be selected, subject only to their own token budgets

#### Scenario: Memory portion bounded with notes
- **GIVEN** a user has 500 enabled memories and the agent workspace has 50 notes
- **WHEN** a triggered context is assembled with default configuration
- **THEN** the memory and note portion of mandatory content SHALL NOT exceed 512 + 384 + 192 + 256 estimated tokens plus section headings

#### Scenario: Low-confidence notes omitted
- **GIVEN** the best note score is below `noteMinRecallScore`
- **WHEN** Fast Recall runs
- **THEN** no note SHALL be selected

### Requirement: Fast Recall Note Sub-section

Selected notes SHALL be rendered after the Fast Recall memory sub-sections under a heading stating that the entries are excerpts only, that the full file can be read when needed, and that they are not instructions. Each entry SHALL show:

- the absolute path on its first line;
- the title and heading path, the line range, the approximate file tokens and the update date on the second line;
- the quoted excerpt on the third line.

Scores and matched terms SHALL NOT be shown. When notes are selected but no memory is, the Fast Recall section SHALL contain only the note sub-section.

#### Scenario: Note pointer rendering
- **GIVEN** Fast Recall selects `notes/vtuber-official-website-guide.md`
- **WHEN** the section is rendered
- **THEN** the entry SHALL show `/app/data/agent-workspace/notes/vtuber-official-website-guide.md`, its heading path, line range, approximate tokens, update date and a quoted excerpt
- **AND** it SHALL NOT include the rest of the file

#### Scenario: Notes only
- **GIVEN** Fast Recall selects one note and no memory
- **WHEN** context is formatted
- **THEN** the Fast Recall section SHALL be present with only the note sub-section

### Requirement: Note Threshold Calibration

The default values of `noteMinRecallScore` and `secondNoteRecallScore` SHALL be derived from the same committed benchmark. The fixture SHALL be extended with about 10 Traditional Chinese and mixed-script notes and with labeled note queries, including negatives. The note false-positive rate SHALL be the share of queries for which Fast Recall selects at least one note outside the expected set. It SHALL be at most 5%, and the thresholds SHALL be chosen by the same rules as the memory thresholds. The regression test SHALL also assert the recorded note metrics.

#### Scenario: Note benchmark gate
- **WHEN** the regression test runs with default configuration
- **THEN** the note false-positive rate SHALL be at most 5%
- **AND** the note Recall@1, Recall@2, false-positive rate and average injected tokens SHALL equal the recorded values
