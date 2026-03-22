# Web Dashboard Restart

## Purpose

Defines the graceful process restart capability triggered from the web dashboard.

## Requirements

### Requirement: Process Restart

`POST /api/restart` SHALL send `SIGTERM` to the current process, triggering the existing graceful shutdown flow. The container orchestrator handles restart.

#### Scenario: Sends SIGTERM on Confirmed Request

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/restart` request is received with body `{"confirm": true}` and a valid session cookie
- **THEN** the server SHALL send `SIGTERM` to the current process
- **AND** the existing graceful shutdown flow SHALL be triggered

#### Scenario: Returns Active Session Count Warning Before Restart

- **GIVEN** two sessions are currently active
- **WHEN** a `POST /api/restart` request is received with body `{"confirm": false}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON body containing `{"activeSessionCount": 2, "warning": "..."}`
- **AND** the process SHALL NOT be terminated

#### Scenario: Requires Authentication

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/restart` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

### Requirement: Restart Confirmation

The restart API SHALL require a `confirm: true` field in the request body. Without confirmation, it SHALL return the current active session count as a warning.

#### Scenario: Returns Warning with Session Count When Confirm Is False

- **GIVEN** three sessions are currently active
- **WHEN** a `POST /api/restart` request is received with body `{"confirm": false}` and a valid session cookie
- **THEN** the server SHALL return HTTP 200 with a JSON body containing `activeSessionCount` of `3`

#### Scenario: Proceeds with Restart When Confirm Is True

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/restart` request is received with body `{"confirm": true}` and a valid session cookie
- **THEN** the server SHALL send `SIGTERM` to the current process

#### Scenario: Rejects Without Confirm Field

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/restart` request is received with body `{}` and a valid session cookie
- **THEN** the server SHALL return HTTP 400 indicating the `confirm` field is required
