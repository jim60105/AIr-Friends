## ADDED Requirements

### Requirement: Agent Thought Chunk Logging with Dual-Format Text Extraction

The `ChatbotClient` SHALL extract thought text from `agent_thought_chunk` session updates by checking both the `update.content` envelope format and the `update.text` direct string format, and SHALL include the extracted text in the log message template so it appears in the top-level `log_processed_message` field.

#### Scenario: Thought chunk with content envelope format (old)
- **WHEN** an `agent_thought_chunk` session update is received with `update.content.type === "text"` and `update.content.text` containing the thought text
- **THEN** the system SHALL extract the text from `update.content.text`, truncate it to 100 characters, and log it at DEBUG level with the message template `"Agent thought: {text}"` so that `log_processed_message` contains the thought text directly

#### Scenario: Thought chunk with direct text format (new)
- **WHEN** an `agent_thought_chunk` session update is received with `update.text` as a string (and `update.content` is absent or not of type `"text"`)
- **THEN** the system SHALL extract the text from `update.text`, truncate it to 100 characters, and log it at DEBUG level with the message template `"Agent thought: {text}"`

#### Scenario: Content envelope format takes precedence over direct text
- **WHEN** an `agent_thought_chunk` session update contains both `update.content.text` and `update.text`
- **THEN** the system SHALL prefer `update.content.text` as the source of truth

#### Scenario: Thought chunk with no extractable text
- **WHEN** an `agent_thought_chunk` session update is received with neither `update.content.text` nor `update.text` containing valid text
- **THEN** the system SHALL log at DEBUG level with `"Agent thought: {text}"` where `text` is an empty string
