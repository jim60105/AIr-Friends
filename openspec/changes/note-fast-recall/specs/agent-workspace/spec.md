## MODIFIED Requirements

### Requirement: Not Pre-Loaded in Context

Agent workspace file content SHALL NOT be included in the initial system prompt or context assembly. The agent reads workspace files on demand. The system prompt SHALL include workspace usage guidance. Assembled context SHALL be allowed to include Fast Recall note pointers: path, title, heading path, line range, approximate file tokens, update date and a short excerpt of at most about 160 characters. It SHALL NOT include full note content.

#### Scenario: Context does not include workspace files
- **GIVEN** the agent workspace contains multiple notes
- **WHEN** the system assembles conversation context
- **THEN** no note's full content SHALL be included
- **AND** the system prompt SHALL contain workspace usage instructions

#### Scenario: Note pointer allowed
- **GIVEN** a note matches the trigger message above `noteMinRecallScore`
- **WHEN** the system assembles conversation context
- **THEN** the context SHALL include a pointer to the note with its absolute path and an excerpt
- **AND** the excerpt SHALL be at most about 160 characters
