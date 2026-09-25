## ADDED Requirements

### Requirement: Fast Recall in Initial Context

When `memory.recall.fastRecallEnabled` is `true`, assembling a triggered session SHALL add the Fast Recall section defined by the `memory-recall` capability. The section SHALL be placed directly after the fixed memory sections and before the conversation section, and SHALL be counted as mandatory content. When it is `false`, no recall search SHALL run. Contexts assembled without a trigger message, such as spontaneous posts, SHALL NOT run Fast Recall.

#### Scenario: Fast Recall placement
- **GIVEN** Fast Recall selects one memory
- **WHEN** the context is formatted
- **THEN** the Fast Recall section SHALL appear after the fixed memory sections and before the conversation section

#### Scenario: Fast Recall disabled
- **GIVEN** `memory.recall.fastRecallEnabled` is `false`
- **WHEN** `assembleContext()` is called
- **THEN** no Fast Recall section SHALL be present and no recall search SHALL run

#### Scenario: No Fast Recall without a trigger
- **WHEN** `assembleSpontaneousContext()` is called
- **THEN** no Fast Recall section SHALL be present

#### Scenario: Memory portion bounded with Fast Recall
- **GIVEN** a user has 500 enabled memories and the session has no agent workspace
- **WHEN** context is assembled with default configuration
- **THEN** the memory portion of mandatory content SHALL NOT exceed 512 + 384 + 192 estimated tokens plus section headings
