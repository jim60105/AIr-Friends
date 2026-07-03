# Web Dashboard Chat

## Purpose

Defines the interactive chat view with ACP agent connection management, message exchange, response streaming, idle timeout, disconnect handling, and web chat prompt template.

## Requirements

### Requirement: Chat Session Connection

`POST /api/chat/connect` SHALL accept `agentType` and `model` parameters, create a new ACP agent connection, create a session, set the model, and return a `chatSessionId`. The system SHALL load `system_web_chat.md` as the initial system prompt.

#### Scenario: Successful Connection with Specified Agent and Model

- **GIVEN** the dashboard server is running and no chat session is active
- **WHEN** a `POST /api/chat/connect` request is received with body `{"agentType": "opencode", "model": "claude-opus-4.8"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON body containing `chatSessionId`
- **AND** an ACP agent connection SHALL be established with the specified agent type and model

#### Scenario: Rejects When Another Chat Session Is Already Active

- **GIVEN** a chat session is already active
- **WHEN** a `POST /api/chat/connect` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 409 indicating a session is already active

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/chat/connect` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

#### Scenario: Returns Error for Invalid Agent Type

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/chat/connect` request is received with body `{"agentType": "invalid", "model": "claude-opus-4.8"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 400 indicating the agent type is invalid

### Requirement: Send Message

`POST /api/chat/message` SHALL accept a JSON body with `chatSessionId` and `content` field names (matching the server's expected schema), send the content as a prompt to the ACP agent on the existing session, and stream the response via SSE. The first message SHALL include the rendered `system_web_chat.md` prompt prepended.

#### Scenario: Sends Message and Receives Streamed Response

- **GIVEN** an active chat session with `chatSessionId` `"chat_abc123"`
- **WHEN** a `POST /api/chat/message` request is received with body `{"chatSessionId": "chat_abc123", "content": "Hello"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200
- **AND** the message SHALL be sent as a prompt to the ACP agent

#### Scenario: Rejects for Invalid Chat Session ID

- **GIVEN** no chat session with ID `"chat_invalid"` exists
- **WHEN** a `POST /api/chat/message` request is received with body `{"chatSessionId": "chat_invalid", "content": "Hello"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 404

#### Scenario: Rejects After Disconnect

- **GIVEN** a chat session with `chatSessionId` `"chat_abc123"` has been disconnected
- **WHEN** a `POST /api/chat/message` request is received with body `{"chatSessionId": "chat_abc123", "content": "Hello"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 410

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/chat/message` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

### Requirement: Model dropdown populated from config

The chat interface model dropdown SHALL be populated dynamically from the server's `modelRouting` configuration. The system SHALL expose a `/api/config/models` endpoint that returns unique model names from `modelRouting.rules[].model` combined with the default `agent.model`. The frontend SHALL fetch this list on page load and populate the `<datalist>` options.

#### Scenario: Model dropdown reflects config

- **WHEN** the dashboard chat tab loads
- **THEN** the model dropdown `<datalist>` contains options matching the unique models from `modelRouting.rules` and default `agent.model`

#### Scenario: No model routing rules configured

- **WHEN** `modelRouting.rules` is empty or not configured
- **THEN** the model dropdown contains only the default `agent.model` value

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

### Requirement: Idle Timeout

The system SHALL automatically disconnect the ACP agent after 10 minutes of no messages from the user.

#### Scenario: Disconnects After 10 Minutes Idle

- **GIVEN** an active chat session with the last message sent 10 minutes ago
- **WHEN** the idle timeout fires
- **THEN** the ACP agent connection SHALL be disconnected
- **AND** the `chatSessionId` SHALL become invalid for new messages

#### Scenario: Resets Timer on New Message

- **GIVEN** an active chat session with 9 minutes of idle time
- **WHEN** a new message is sent
- **THEN** the idle timeout timer SHALL be reset to 10 minutes

#### Scenario: Notifies Client via SSE of Timeout Disconnect

- **GIVEN** an SSE connection is established for the chat session
- **WHEN** the idle timeout fires and the agent is disconnected
- **THEN** the server SHALL send an SSE event with type `disconnect` and reason `"idle_timeout"`

### Requirement: Manual Disconnect

`POST /api/chat/disconnect` SHALL disconnect the ACP agent and end the chat session. The `chatSessionId` becomes invalid for new messages but the SSE stream sends a disconnect event.

#### Scenario: Successful Disconnect

- **GIVEN** an active chat session with `chatSessionId` `"chat_abc123"`
- **WHEN** a `POST /api/chat/disconnect` request is received with body `{"chatSessionId": "chat_abc123"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200
- **AND** the ACP agent connection SHALL be disconnected

#### Scenario: Idempotent If Already Disconnected

- **GIVEN** a chat session with `chatSessionId` `"chat_abc123"` that has already been disconnected
- **WHEN** a `POST /api/chat/disconnect` request is received with body `{"chatSessionId": "chat_abc123"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/chat/disconnect` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

### Requirement: Browser Close Handling

The client SHALL send a disconnect request via `navigator.sendBeacon` on the `beforeunload` event.

#### Scenario: Sends Beacon on Page Close

- **GIVEN** an active chat session in the browser
- **WHEN** the user closes the browser tab or navigates away
- **THEN** the client SHALL call `navigator.sendBeacon` with a disconnect request to `/api/chat/disconnect`

#### Scenario: Server Handles Beacon Disconnect

- **GIVEN** the dashboard server receives a beacon disconnect request
- **WHEN** the request is processed
- **THEN** the server SHALL disconnect the ACP agent and end the chat session

### Requirement: Post-Disconnect UI State

After disconnect, the web UI SHALL block message sending but continue displaying chat history and session status. A "New Connection" button SHALL be available to start a fresh session.

#### Scenario: Message Input Disabled After Disconnect

- **GIVEN** the chat session has been disconnected
- **WHEN** the user views the chat UI
- **THEN** the message input field SHALL be disabled
- **AND** the send button SHALL be disabled

#### Scenario: History Remains Visible

- **GIVEN** a chat session has exchanged messages and then disconnected
- **WHEN** the user views the chat UI
- **THEN** all previous messages SHALL remain visible in the chat history

#### Scenario: New Connection Button Starts Fresh Session

- **GIVEN** the chat session has been disconnected
- **WHEN** the user clicks the "New Connection" button
- **THEN** a new `POST /api/chat/connect` request SHALL be initiated
- **AND** the chat history SHALL be cleared

### Requirement: Web Chat Prompt Template

The system SHALL use `prompts/system_web_chat.md` for web chat sessions. This template SHALL NOT include recent message history or emoji guidance. It SHALL instruct the agent to NOT use `send-reply`, `send-file`, or `react-message` skills.

#### Scenario: Web Chat Uses Correct Prompt Template

- **GIVEN** a web chat session is created
- **WHEN** the system prompt is loaded
- **THEN** it SHALL use `prompts/system_web_chat.md` as the template

#### Scenario: Prompt Does Not Contain Emoji Instructions

- **GIVEN** the `system_web_chat.md` template is rendered
- **WHEN** the prompt content is examined
- **THEN** it SHALL NOT contain emoji guidance or available emoji references

#### Scenario: Prompt Instructs Against Send-Reply Usage

- **GIVEN** the `system_web_chat.md` template is rendered
- **WHEN** the prompt content is examined
- **THEN** it SHALL contain instructions telling the agent to NOT use `send-reply`, `send-file`, or `react-message` skills

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

### Requirement: Model Name Escaping in Datalist Rendering

When populating the model `<datalist>` options from the `/api/config/models` response, the client SHALL escape all model name values before inserting them into HTML attributes. The escaping SHALL prevent injection of HTML entities, quotes, and angle brackets.

#### Scenario: Model name with angle brackets is escaped

- **GIVEN** the `/api/config/models` endpoint returns a model named `<script>alert(1)</script>`
- **WHEN** the client renders the datalist options
- **THEN** the option value SHALL be HTML-escaped (e.g., `&lt;script&gt;alert(1)&lt;/script&gt;`)
- **AND** no script execution SHALL occur

#### Scenario: Model name with quotes is escaped

- **GIVEN** the `/api/config/models` endpoint returns a model named `model" onmouseover="alert(1)`
- **WHEN** the client renders the datalist options
- **THEN** the quote characters SHALL be escaped in the HTML attribute
- **AND** no event handler SHALL be injected

#### Scenario: Normal model names render correctly

- **GIVEN** the `/api/config/models` endpoint returns model names like `gpt-4` and `claude-sonnet-4`
- **WHEN** the client renders the datalist options
- **THEN** the model names SHALL appear unchanged in the dropdown

### Requirement: Error Message Sanitization in SSE Streams

When the server sends an SSE event with type `error`, the error message SHALL be sanitized to remove internal details such as stack traces, file paths, and internal error class names. The client SHALL also treat received error messages as plain text, not HTML.

#### Scenario: SSE error event does not contain stack trace

- **GIVEN** an ACP agent error occurs with a stack trace
- **WHEN** the server sends an SSE `error` event
- **THEN** the event data SHALL contain a user-friendly message (e.g., `"Agent encountered an error"`)
- **AND** the data SHALL NOT include file paths or line numbers

#### Scenario: Client renders error message as plain text

- **GIVEN** the SSE stream delivers an error event with data `"<img src=x onerror=alert(1)>"`
- **WHEN** the client displays the error in the chat UI
- **THEN** the error message SHALL be rendered as plain text
- **AND** no HTML elements SHALL be created from the error content

#### Scenario: Connection errors are sanitized

- **GIVEN** the ACP agent connection fails with an internal error message
- **WHEN** the server sends an SSE `error` event
- **THEN** the event data SHALL say `"Connection error"` or similar generic message
- **AND** SHALL NOT reveal the agent subprocess command or connection details
