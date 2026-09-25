## ADDED Requirements

### Requirement: Note Indexing

When a session has an agent workspace, recall SHALL index every `.md` file under it, recursively, except `README.md` at the workspace root and `notes/_index.md`.

- **Chunking**: each file SHALL be split into chunks at level-2 and level-3 headings. A chunk longer than about 600 characters SHALL be split again at blank lines.
- **Chunk metadata**: each chunk SHALL record the file's absolute path, the document title (the first level-1 heading, otherwise the file name without extension), its heading path, its 1-based start and end lines, and the file's modification time.
- **Freshness**: the file list SHALL be re-read on every search. Each file SHALL be re-chunked only when its size or modification time changed.
- **Ranking**: notes SHALL be ranked by lexical score, entity bonus and phrase bonus only, with `N`, `df` and average length computed over note chunks alone. Results SHALL be aggregated per file, with the file's best-scoring chunk as its representative and score.
- **Containment**: symbolic links SHALL NOT be followed. Every file and directory SHALL resolve, by real path, inside the agent workspace; any entry that resolves outside it SHALL be skipped and SHALL NOT be read. A file with more than one hard link SHALL be skipped as well, because a hard link passes both checks while still naming another file's content from inside the workspace.
- When the session has no agent workspace, note results SHALL be empty.

#### Scenario: Index page is not a result
- **GIVEN** `notes/_index.md` lists a note title that matches the query
- **WHEN** recall runs
- **THEN** `notes/_index.md` SHALL NOT be returned

#### Scenario: One entry per file
- **GIVEN** three chunks of the same note match the query
- **WHEN** recall runs
- **THEN** the note SHALL appear once, with the highest chunk score

#### Scenario: Edited note is re-indexed
- **GIVEN** a note file has been indexed
- **WHEN** its content changes and a search runs afterward
- **THEN** results SHALL reflect the new content

#### Scenario: Symlink escaping the workspace is not indexed
- **GIVEN** `notes/leak.md` is a symbolic link to a user's `memory.private.jsonl`
- **AND** `notes/linked-dir` is a symbolic link to a directory outside the workspace
- **WHEN** recall runs with a query matching that private content
- **THEN** neither link SHALL be read or returned

#### Scenario: Hard-linked file is not indexed
- **GIVEN** `notes/leak.md` is a hard link to a user's `memory.private.jsonl`
- **WHEN** recall runs with a query matching that private content
- **THEN** the link SHALL NOT be read or returned

#### Scenario: Journal entries are searchable
- **GIVEN** `journal/2026-09-20.md` matches the query
- **WHEN** recall runs
- **THEN** the journal file SHALL be eligible

### Requirement: Note Result Format

Each note result SHALL be a pointer and SHALL NOT contain the full file content. It SHALL contain:

- `path`: the absolute file path (the same workspace path given to the agent);
- `title` and `headingPath`;
- `lineStart` and `lineEnd` of the representative chunk;
- `excerpt`: the sentence or sentences of the representative chunk with the most distinct matched terms (ties broken by the earliest sentence in the chunk), at most about 160 characters in Fast Recall and about 320 in Deep Recall, prefixed and suffixed with `…` when cut;
- `fileTokens`: the estimated token count of the whole file;
- `modifiedAt`: ISO date;
- `score` and `matchedTerms`.

In Deep Recall a note result SHALL also include up to 3 `chunks`, each with `headingPath`, `lineStart`, `lineEnd` and `excerpt`, in score order.

#### Scenario: Note result is a pointer
- **GIVEN** a 4.8 KB note matches the query
- **WHEN** recall returns it
- **THEN** the result SHALL include the absolute path, heading path, line range, excerpt, `fileTokens` and `modifiedAt`
- **AND** it SHALL NOT include the full file content

#### Scenario: Excerpt contains a matched term
- **WHEN** a note is returned for a query matching `Portaly`
- **THEN** its excerpt SHALL contain `Portaly`

### Requirement: Deep Recall Notes

The `memory-search` skill SHALL return notes in `agentNotes` using the Note Result Format. It SHALL return up to `limit` notes (capped at 10) whose score is at least `deepMinRecallScore`, in descending score order. Notes are Deep Recall items: together with memories they are subject to the Deep Recall budget rule, so the combined output fits `deepRecallMaxTokens`, with items admitted in descending score order across both lists and any item that does not fit skipped. A note's size SHALL be measured by its serialized output entry.

#### Scenario: Deep Recall note pointers
- **GIVEN** two notes match a query
- **WHEN** `memory-search` runs
- **THEN** `agentNotes` SHALL contain two pointer entries with `path`, `headingPath`, line range, `excerpt`, `fileTokens`, `modifiedAt`, `score`, `matchedTerms` and up to 3 `chunks`

#### Scenario: Shared deep budget
- **GIVEN** memories and notes whose rendered sizes together exceed `deepRecallMaxTokens`
- **WHEN** `memory-search` runs
- **THEN** the combined output SHALL NOT exceed `deepRecallMaxTokens`, and higher-scoring items SHALL be kept first
