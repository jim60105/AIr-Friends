# Web Dashboard Server

## Purpose

Defines the HTTP server lifecycle, static file serving, passphrase-based authentication, and CSRF protection for the web dashboard.

## Requirements

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

### Requirement: Security Headers on All Responses

The dashboard server SHALL apply a security headers middleware that runs before all route handlers. Every response SHALL include `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.

#### Scenario: Static file responses include security headers

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /` request is received
- **THEN** the response SHALL include all four security headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`)

#### Scenario: API responses include security headers

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/active` request is received with a valid session cookie
- **THEN** the response SHALL include all four security headers

#### Scenario: Error responses include security headers

- **GIVEN** the dashboard server is running
- **WHEN** a request results in an HTTP 404 response
- **THEN** the response SHALL include all four security headers

### Requirement: Rate Limiting on Login Endpoint

`POST /api/auth/login` SHALL be protected by a rate limiter. When the configured maximum attempts within the sliding window are exceeded, the server SHALL return HTTP 429 with a `Retry-After` header. Other API endpoints SHALL NOT be rate limited by this mechanism.

#### Scenario: Login within rate limit succeeds or fails normally

- **GIVEN** the rate limit has not been exceeded
- **WHEN** a `POST /api/auth/login` request is received
- **THEN** the request SHALL be processed normally (200 or 401)

#### Scenario: Login exceeding rate limit returns 429

- **GIVEN** the rate limit of 5 attempts per 60 seconds has been reached
- **WHEN** a 6th `POST /api/auth/login` request is received within the window
- **THEN** the server SHALL return HTTP 429 with a `Retry-After` header

#### Scenario: Non-login endpoints are not rate limited

- **GIVEN** the login rate limit has been exceeded for an IP
- **WHEN** the same IP sends a `GET /api/sessions/active` request with a valid session cookie
- **THEN** the request SHALL be processed normally

### Requirement: Input Validation on SessionId Path Parameters

All API endpoints accepting a `sessionId` path parameter (e.g., `GET /api/sessions/:id/audit`) SHALL validate that the parameter matches the expected format (e.g., `sess_` prefix followed by alphanumeric characters). Requests with invalid format SHALL be rejected with HTTP 400 before any file system or database lookup occurs.

#### Scenario: Valid sessionId format accepted

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/sess_abc123/audit` request is received with a valid session cookie
- **THEN** the server SHALL proceed with the audit file lookup

#### Scenario: Invalid sessionId format rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/../../../etc/passwd/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400 with message `"Invalid session ID format"`
- **AND** no file system lookup SHALL occur

#### Scenario: SessionId with special characters rejected

- **GIVEN** the dashboard server is running
- **WHEN** a `GET /api/sessions/sess_abc;rm -rf/audit` request is received with a valid session cookie
- **THEN** the server SHALL return HTTP 400

### Requirement: Sanitized Error Responses

All error responses from the dashboard server SHALL be sanitized to prevent information leakage. The server SHALL use a centralized error handler that strips stack traces, internal paths, and implementation details before sending the response.

#### Scenario: Unhandled exception returns generic 500

- **GIVEN** an internal error occurs during request processing
- **WHEN** the error propagates to the error handler
- **THEN** the server SHALL return HTTP 500 with body `{"error": "Internal server error"}`
- **AND** the response SHALL NOT contain stack traces

#### Scenario: Known errors return safe messages

- **GIVEN** a request triggers a known validation error
- **WHEN** the error is handled
- **THEN** the response SHALL contain the validation message without internal details
