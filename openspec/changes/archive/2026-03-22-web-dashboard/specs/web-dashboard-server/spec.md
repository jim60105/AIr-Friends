# Web Dashboard Server

## Purpose

Defines the HTTP server lifecycle, static file serving, passphrase-based authentication, and CSRF protection for the web dashboard.

## ADDED Requirements

### Requirement: Dashboard HTTP Server Lifecycle

The system SHALL provide a web dashboard HTTP server on a configurable port (default 8090). The server SHALL only start when `dashboard.enabled` is `true` and `dashboard.passphrase` is non-empty.

#### Scenario: Server Starts on Configured Port

- **GIVEN** `dashboard.enabled` is `true`, `dashboard.passphrase` is `"my-secret"`, and `dashboard.port` is `8090`
- **WHEN** the application starts
- **THEN** the dashboard HTTP server SHALL listen on port `8090`

#### Scenario: Server Does Not Start When Disabled

- **GIVEN** `dashboard.enabled` is `false`
- **WHEN** the application starts
- **THEN** the dashboard HTTP server SHALL NOT be started

#### Scenario: Server Does Not Start When Passphrase Empty

- **GIVEN** `dashboard.enabled` is `true` and `dashboard.passphrase` is `""`
- **WHEN** the application starts
- **THEN** the dashboard HTTP server SHALL NOT be started
- **AND** a warning SHALL be logged indicating the passphrase is required

#### Scenario: Server Stops on Graceful Shutdown

- **GIVEN** the dashboard server is running
- **WHEN** the application receives a shutdown signal
- **THEN** the dashboard server SHALL stop accepting new connections and close gracefully

### Requirement: Static File Serving

The dashboard server SHALL serve HTML, CSS, and JavaScript assets for the web UI.

#### Scenario: Serves Index HTML at Root

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /` request is received
- **THEN** the server SHALL return the `index.html` file with `Content-Type: text/html`

#### Scenario: Serves JavaScript Modules

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /js/app.js` request is received
- **THEN** the server SHALL return the JavaScript file with `Content-Type: application/javascript`

#### Scenario: Returns 404 for Unknown Paths

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /nonexistent` request is received
- **THEN** the server SHALL return HTTP 404

### Requirement: Passphrase Authentication

The dashboard SHALL require passphrase authentication before accessing any dashboard API or page. `POST /api/auth/login` SHALL accept a passphrase and set an httpOnly cookie. All other `/api/*` endpoints SHALL return 401 without a valid session cookie. `POST /api/auth/logout` SHALL clear the session.

#### Scenario: Successful Login with Correct Passphrase

- **GIVEN** `dashboard.passphrase` is `"my-secret"`
- **WHEN** a `POST /api/auth/login` request is received with body `{"passphrase": "my-secret"}`
- **THEN** the server SHALL return HTTP 200
- **AND** the response SHALL include a `Set-Cookie` header with an httpOnly session cookie

#### Scenario: Rejected Login with Wrong Passphrase

- **GIVEN** `dashboard.passphrase` is `"my-secret"`
- **WHEN** a `POST /api/auth/login` request is received with body `{"passphrase": "wrong"}`
- **THEN** the server SHALL return HTTP 401

#### Scenario: API Returns 401 Without Cookie

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/active` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401

#### Scenario: Logout Clears Session

- **GIVEN** a user has a valid session cookie
- **WHEN** a `POST /api/auth/logout` request is received
- **THEN** the server SHALL clear the session cookie
- **AND** subsequent API requests with the old cookie SHALL return HTTP 401

#### Scenario: Cookie Is HttpOnly and SameSite Strict

- **GIVEN** a successful login
- **WHEN** the session cookie is set
- **THEN** the cookie SHALL have `HttpOnly` flag set to `true`
- **AND** the cookie SHALL have `SameSite` set to `Strict`

### Requirement: CSRF Protection

All state-changing POST endpoints SHALL validate a CSRF token or use `SameSite=Strict` cookies.

#### Scenario: POST Without Valid Session Is Rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `POST /api/restart` request is received without a valid session cookie
- **THEN** the server SHALL return HTTP 401
