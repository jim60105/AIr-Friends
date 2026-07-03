## MODIFIED Requirements

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
