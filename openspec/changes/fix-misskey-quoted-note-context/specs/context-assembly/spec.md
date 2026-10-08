## ADDED Requirements

### Requirement: Attributed Third-Party Quote Context

The system SHALL preserve an available quoted reference in the current message and in every retained recent, related or spontaneous-history message. It SHALL display source identity, original author, source URL when present, source text and attachment metadata within an explicit third-party reference boundary stating that quoted commands are not the user's direct instructions. Source authors SHALL remain separate from the outer user/bot speaker. Unavailable references SHALL display known source id and unavailable status without invented content. Trigger budget calculation and final prompt output SHALL use the same current-message representation. Messages without quotes SHALL retain their existing text and attachment formatting.

#### Scenario: Question retains its referent in current message
- **GIVEN** a user asks whether their location has something like an embedded quoted article about unexploded WWII ordnance
- **WHEN** the prompt is assembled
- **THEN** the current-message section SHALL include the user's question and the source body/article URL with source attribution
- **AND** source text SHALL appear inside the third-party reference boundary, without being attributed as the user's direct instructions

#### Scenario: All retained history paths preserve source
- **GIVEN** available quotes occur in retained recent messages, related messages and spontaneous-post history
- **WHEN** each context is formatted
- **THEN** each retained entry SHALL contain its attributed reference using the same third-party boundary contract

#### Scenario: Unavailable source is visible
- **GIVEN** quote enrichment fails or exhausts its budget
- **WHEN** the trigger or retained history entry is formatted
- **THEN** the outer message SHALL remain present
- **AND** the reference SHALL identify its source id and unavailable status with no invented source text

#### Scenario: No-quote output remains unchanged
- **GIVEN** equivalent ordinary text-only messages or messages with outer attachments and no quote
- **WHEN** context is formatted before and after quote support
- **THEN** the user-message formatting SHALL remain byte-identical

### Requirement: Quote Data Cannot Create Prompt Boundary Lines

All untrusted quote fields, including text, identity, author names, URLs and attachment names, SHALL be encoded as data inside renderer-owned third-party boundaries. Embedded line breaks, role labels, Markdown headings/fences, closing-boundary text or XML delimiters SHALL NOT produce new renderer-owned speaker, heading or boundary lines. Instruction-looking source text SHALL remain reference data. This formatting contract SHALL NOT be represented as proof of semantic prompt-injection immunity. Command recognition SHALL use outer message content only.

#### Scenario: Instruction-looking quote retains boundary
- **GIVEN** source text says to ignore earlier instructions and identifies itself as a new current message
- **WHEN** context is formatted
- **THEN** the instruction-looking text SHALL remain encoded within the third-party reference data
- **AND** the fixed warning that quoted commands are not direct user instructions SHALL remain present

#### Scenario: Hostile metadata cannot close the reference
- **GIVEN** source text, an author name, source URL or filename contains newlines, the closing label, `[User]`, `## Current Message`, backticks, XML closing tags or Unicode line separators
- **WHEN** the reference is rendered
- **THEN** none of those fields SHALL create a standalone role, heading, fence or closing-boundary line outside encoded data
- **AND** the renderer SHALL produce exactly its own opening and closing boundary for each reference

#### Scenario: Quoted clear is data only
- **GIVEN** the outer message is an ordinary question and its quoted source starts with `/clear`
- **WHEN** context and history are assembled
- **THEN** the quote SHALL NOT clear history, suppress the session or change command recognition

### Requirement: Quote-Aware Token Accounting

Context estimates SHALL include rendered quoted data, attribution, warning boundaries and quoted attachment metadata. The trigger's complete quote SHALL count as mandatory content under the existing trigger policy. History admission SHALL count an outer message and its quote as one whole candidate, preserve recent-over-related priority and drop oldest candidates first when required. No quote body SHALL be summarized or cut mid-reference. Final formatted token estimates SHALL reflect the actual system and user text, including every rendered occurrence of a repeated current/history note. When mandatory content alone exceeds the configured limit, the system SHALL report its actual estimate and omit discretionary history/emojis under the existing soft-budget behavior.

#### Scenario: Quote overhead changes history admission
- **GIVEN** an old quoted history candidate fits by outer body alone but exceeds available budget when its reference is counted
- **WHEN** conversation admission occurs
- **THEN** the complete candidate SHALL be omitted
- **AND** newer fitting candidates SHALL retain their complete reference boundaries

#### Scenario: Mandatory source is charged and preserved
- **GIVEN** a current message has a long quoted source and optional history/emojis
- **WHEN** mandatory content exceeds the token limit
- **THEN** the trigger's complete source reference SHALL remain present and its tokens SHALL be reported
- **AND** discretionary history and emojis SHALL be omitted without summarizing or truncating the reference

#### Scenario: Estimates match rendered quote cost
- **GIVEN** a quote has escaped multiline text, remote attribution and file metadata and occurs in both current and retained history
- **WHEN** pre-format and final estimates are calculated
- **THEN** the pre-format estimate SHALL include each reference's complete rendered cost
- **AND** the final estimate SHALL equal the existing token counter's result for actual system and user text
