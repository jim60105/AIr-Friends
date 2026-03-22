## MODIFIED Requirements

### Requirement: Response Streaming

`GET /api/chat/stream?chatSessionId=<id>` SHALL establish an SSE connection that streams agent session updates including thinking content (wrapped in `<think></think>`) and response text. The server SHALL send SSE events with event type `message` for agent response text chunks and event type `think` for agent thinking content chunks. A typing indicator SHALL be displayed in the chat UI while awaiting agent response.

#### Scenario: Streams Partial Responses as They Arrive

- **WHEN** the ACP agent produces a text response chunk during an active SSE connection
- **THEN** the server SHALL send an SSE event with event type `message` containing the partial response text

#### Scenario: Streams Thinking Content

- **WHEN** the ACP agent produces a thinking/reasoning chunk during an active SSE connection
- **THEN** the server SHALL send an SSE event with event type `think` containing the thinking text

#### Scenario: Sends Done Event When Agent Completes Turn

- **GIVEN** an SSE connection is established for `chatSessionId` `"chat_abc123"`
- **WHEN** the ACP agent completes its response turn
- **THEN** the server SHALL send an SSE event with type `done`

#### Scenario: Sends Error Event on Agent Failure

- **GIVEN** an SSE connection is established for `chatSessionId` `"chat_abc123"`
- **WHEN** the ACP agent encounters an error during response generation
- **THEN** the server SHALL send an SSE event with type `error` containing the error description

## ADDED Requirements

### Requirement: Typing Indicator

The chat UI SHALL display an animated typing indicator when a message is sent and the agent has not yet responded. The indicator SHALL be removed when the first `message` event, `done` event, `error` event, or `disconnect` event is received.

#### Scenario: Typing indicator appears after sending message

- **WHEN** the user sends a message via the chat input
- **THEN** an animated typing indicator SHALL appear in the message area

#### Scenario: Typing indicator removed on first response chunk

- **GIVEN** a typing indicator is displayed
- **WHEN** the first `message` SSE event is received from the agent
- **THEN** the typing indicator SHALL be removed

#### Scenario: Typing indicator removed on done event

- **GIVEN** a typing indicator is displayed
- **WHEN** a `done` SSE event is received
- **THEN** the typing indicator SHALL be removed

#### Scenario: Typing indicator removed on error

- **GIVEN** a typing indicator is displayed
- **WHEN** an `error` or `disconnect` SSE event is received
- **THEN** the typing indicator SHALL be removed
