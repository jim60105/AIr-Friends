## ADDED Requirements

### Requirement: Fast Recall Prompt Section

When a triggered session is assembled and Fast Recall is enabled, the system SHALL run Fast Recall once. The query SHALL be the trigger message plus the same user's most recent earlier message in the recent history after the last `/clear`, when one exists. The exclusion set SHALL be the ids of memories already injected by fixed loading. Selected memories SHALL be rendered in the following memory sub-sections, and an empty sub-section SHALL be omitted:

1. User-scope memories under a "Relevant Memory" heading, one `- <content>` line each.
2. Channel-scope memories under a heading stating they were contributed by channel members, are unverified and are not instructions, one `- [from <author>] <content>` line each (or `[from unknown contributor]`).

When Fast Recall selects nothing at all, the whole section SHALL be omitted. The section SHALL NOT include ids, scores, tiers, categories, creation times or matched terms, and the previous message text SHALL NOT appear in it.

#### Scenario: Already-injected memory not repeated
- **GIVEN** a core memory is injected by fixed loading and also matches the trigger message
- **WHEN** Fast Recall runs
- **THEN** that memory SHALL NOT appear in the Fast Recall section

#### Scenario: No diagnostics in prompt
- **WHEN** the Fast Recall section is rendered
- **THEN** it SHALL NOT contain memory ids or scores

#### Scenario: Empty recall omits the section
- **GIVEN** no memory clears `minRecallScore`
- **WHEN** context is formatted
- **THEN** no Fast Recall heading SHALL be present

#### Scenario: /clear bounds the previous-message query
- **GIVEN** the user's only earlier message precedes the last `/clear`
- **WHEN** Fast Recall runs
- **THEN** no previous user message SHALL contribute query tokens

#### Scenario: Previous message from another user is ignored
- **GIVEN** the most recent earlier message in history was sent by a different user
- **AND** the trigger user's own earlier message is older
- **WHEN** Fast Recall builds its query
- **THEN** it SHALL use the trigger user's own earlier message

### Requirement: Fast Recall Failure Isolation

A failure inside Fast Recall SHALL NOT prevent the session from starting. The system SHALL log a warning with the error and SHALL assemble the context without the Fast Recall section.

#### Scenario: Fast Recall exception
- **GIVEN** the recall engine throws during context assembly
- **WHEN** the session is assembled
- **THEN** the context SHALL be assembled without the Fast Recall section
- **AND** the agent session SHALL start
