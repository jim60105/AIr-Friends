# Delta: acp-integration

## MODIFIED Requirements

### Requirement: Agent Thought Chunk Logging with Dual-Format Text Extraction

The `ChatbotClient` SHALL extract thought text from `agent_thought_chunk` session updates by
checking both the `update.content` envelope format and the `update.text` direct string format, and
SHALL include the extracted text in the log message template so it appears in the top-level
`log_processed_message` field. Per-chunk DEBUG logging SHALL be emitted only when
`logging.agentStreamChunks` is enabled (default `false`, env override
`LOGGING_AGENT_STREAM_CHUNKS`); when disabled, the extraction and buffering behavior SHALL remain
identical — the `thoughtBuffer` SHALL still accumulate every chunk and the complete-thought INFO
summary SHALL still be flushed. When enabled, the same gating flag SHALL also gate the per-chunk
`"Agent message chunk: {text}"` DEBUG log (message buffering and its INFO summary unchanged).

#### Scenario: Per-chunk logs suppressed by default
- **WHEN** an `agent_thought_chunk` session update is received and `logging.agentStreamChunks` is unset or false
- **THEN** the system SHALL NOT emit a per-chunk `Agent thought: {text}` DEBUG log
- **AND** the chunk SHALL still be appended to the thought buffer for the complete-thought summary

#### Scenario: Per-chunk logs enabled for debugging
- **WHEN** `logging.agentStreamChunks` is true and an `agent_thought_chunk` or `agent_message_chunk` update is received
- **THEN** the system SHALL emit the corresponding DEBUG log with the 100-character truncated text, as before

#### Scenario: Thought chunk with content envelope format (old)
- **WHEN** an `agent_thought_chunk` session update is received with `update.content.type === "text"`
  and `update.content.text` containing the thought text
- **THEN** the system SHALL extract the text from `update.content.text` and truncate it to 100
  characters for both the gated DEBUG log and the thought buffer

#### Scenario: Thought chunk with direct text format (new)
- **WHEN** an `agent_thought_chunk` session update is received with `update.text` as a string (and
  `update.content` is absent or not of type `"text"`)
- **THEN** the system SHALL extract the text from `update.text` and truncate it to 100 characters
  for the gated DEBUG log

#### Scenario: Content envelope format takes precedence over direct text
- **WHEN** an `agent_thought_chunk` session update contains both `update.content.text` and
  `update.text`
- **THEN** the system SHALL prefer `update.content.text` as the source of truth for both the gated
  DEBUG log and the thought buffer

#### Scenario: Thought chunk with no extractable text
- **WHEN** an `agent_thought_chunk` session update is received with neither `update.content.text`
  nor `update.text` containing valid text
- **THEN** with chunk logging enabled the system SHALL log `"Agent thought: {text}"` with an empty
  `text`, and the buffer SHALL receive nothing
