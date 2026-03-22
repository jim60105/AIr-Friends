## MODIFIED Requirements

### Requirement: Chat message sending
The frontend chat interface SHALL send messages to the `/api/chat/message` endpoint using `{ chatSessionId, content }` as the request body field names, matching the server's expected schema.

#### Scenario: Send chat message
- **WHEN** a user types a message and clicks send (or presses Enter)
- **THEN** the frontend sends a POST to `/api/chat/message` with `{ chatSessionId: "<id>", content: "<message>" }`
- **AND** the server processes the message and returns 200

### Requirement: Model dropdown populated from config
The chat interface model dropdown SHALL be populated dynamically from the server's `modelRouting` configuration. The system SHALL expose a `/api/config/models` endpoint that returns unique model names from `modelRouting.rules[].model` combined with the default `agent.model`. The frontend SHALL fetch this list on page load and populate the `<datalist>` options.

#### Scenario: Model dropdown reflects config
- **WHEN** the dashboard chat tab loads
- **THEN** the model dropdown `<datalist>` contains options matching the unique models from `modelRouting.rules` and default `agent.model`

#### Scenario: No model routing rules configured
- **WHEN** `modelRouting.rules` is empty or not configured
- **THEN** the model dropdown contains only the default `agent.model` value
