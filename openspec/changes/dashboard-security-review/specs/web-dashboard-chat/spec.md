# Web Dashboard Chat (Delta)

## Purpose

Security additions to the web dashboard chat for XSS prevention in model name rendering and SSE error message sanitization.

## ADDED Requirements

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
