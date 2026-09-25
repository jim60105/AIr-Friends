## MODIFIED Requirements

### Requirement: Memory-Search Integration

The `memory-search` skill SHALL search both user memories and agent workspace notes with the recall engine. It SHALL return memories in a `memories` section and notes in an `agentNotes` section. Each note SHALL be a pointer as defined by the `memory-recall` Note Result Format, so the agent can decide whether to read the file.

#### Scenario: Search returns both sections
- **GIVEN** user memories contain "pasta recipe"
- **AND** agent workspace `notes/cooking.md` contains "pasta recipe"
- **WHEN** `memory-search` is invoked with query "pasta"
- **THEN** the results SHALL include a `memories` section with user memory matches
- **AND** the results SHALL include an `agentNotes` section whose entry has the absolute path of `notes/cooking.md`, a heading path, a line range, an excerpt and `fileTokens`
