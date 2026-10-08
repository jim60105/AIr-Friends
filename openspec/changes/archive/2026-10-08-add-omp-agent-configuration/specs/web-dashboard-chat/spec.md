## MODIFIED Requirements

### Requirement: Chat Session Connection

`POST /api/chat/connect` SHALL accept `agentType` and `model` parameters, create a new ACP agent connection, create a session, set the model, and return a `chatSessionId`. `agentType` SHALL default to the deployment default agent type and SHALL be validated against the shared supported-agent-type set (the same set used by configuration validation), not against a second hard-coded value; an `agentType` outside that set SHALL be rejected with HTTP 400. Acceptance of a supported `agentType` here means only that the value is valid input: whether a request can actually establish a session depends on that type's launch support, and a request naming a supported type whose launch path is not implemented SHALL fail through connection establishment rather than be reported as invalid input. The system SHALL load `system_web_chat.md` as the initial system prompt.

#### Scenario: Successful Connection with Specified Agent and Model

- **GIVEN** the dashboard server is running and no chat session is active
- **WHEN** a `POST /api/chat/connect` request is received with body `{"agentType": "opencode", "model": "claude-opus-4.8"}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON body containing `chatSessionId`
- **AND** an ACP agent connection SHALL be established with the specified agent type and model

#### Scenario: Supported OMP Agent Type Passes Input Validation

- **GIVEN** the dashboard server is running and no chat session is active
- **WHEN** a `POST /api/chat/connect` request is received with body `{"agentType": "omp", "model": "google/gemini-3-pro"}` and a valid session cookie
- **THEN** the server SHALL NOT return HTTP 400 for the agent-type field
- **AND** the request SHALL proceed to agent connection establishment (which succeeds only once OMP launch support exists; the validation result alone is not evidence that an OMP chat session works)

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
