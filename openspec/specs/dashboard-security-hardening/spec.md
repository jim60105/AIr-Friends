# Dashboard Security Hardening

## Purpose

Defines cross-cutting security controls for the web dashboard including security headers, login rate limiting, session token expiration, timing-safe authentication, secure cookies, and error response sanitization.
## Requirements
### Requirement: Security Headers Middleware

The dashboard server SHALL attach security headers to every HTTP response. The headers SHALL include `Content-Security-Policy` (default-src 'self', with script-src and style-src allowing necessary inline/CDN sources), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.

#### Scenario: All responses include CSP header

- **GIVEN** the dashboard server is running
- **WHEN** any HTTP response is sent (e.g., `GET /`, `GET /api/sessions/active`)
- **THEN** the response SHALL include a `Content-Security-Policy` header with `default-src 'self'`

#### Scenario: All responses include X-Frame-Options

- **GIVEN** the dashboard server is running
- **WHEN** any HTTP response is sent
- **THEN** the response SHALL include `X-Frame-Options: DENY`

#### Scenario: All responses include X-Content-Type-Options

- **GIVEN** the dashboard server is running
- **WHEN** any HTTP response is sent
- **THEN** the response SHALL include `X-Content-Type-Options: nosniff`

#### Scenario: All responses include Referrer-Policy

- **GIVEN** the dashboard server is running
- **WHEN** any HTTP response is sent
- **THEN** the response SHALL include `Referrer-Policy: strict-origin-when-cross-origin`

### Requirement: Login Rate Limiting

The dashboard SHALL enforce rate limiting on `POST /api/auth/login` using a sliding window. The maximum number of attempts and the window duration SHALL be configurable. When the limit is exceeded, the server SHALL return HTTP 429 with a `Retry-After` header. The per-IP rate-limit key SHALL be derived from the real connection address (`info.remoteAddr`); the `X-Forwarded-For` header SHALL be honored ONLY when the real connection address is in a configured `dashboard.trustedProxies` allow-list. In addition to per-IP limiting, the dashboard SHALL maintain a global failed-attempt counter with backoff so that rotating the client IP (or a spoofed `X-Forwarded-For`) cannot yield unlimited attempts.

#### Scenario: Rate-limit key uses real connection address
- **GIVEN** the request's real connection address is `203.0.113.5` and `dashboard.trustedProxies` does NOT include it
- **WHEN** the client sends login requests with varying `X-Forwarded-For` header values
- **THEN** all requests SHALL be counted against the key derived from `203.0.113.5`, ignoring the header

#### Scenario: Trusted proxy XFF honored
- **GIVEN** the real connection address is in `dashboard.trustedProxies`
- **WHEN** a login request arrives with `X-Forwarded-For: 198.51.100.7`
- **THEN** the rate-limit key SHALL be derived from `198.51.100.7`

#### Scenario: Global backoff caps total attempts
- **GIVEN** an attacker rotates the client IP or spoofs `X-Forwarded-For` to bypass per-IP limits
- **WHEN** the global failed-attempt threshold is exceeded within the window
- **THEN** the server SHALL reject further login attempts with HTTP 429 until the global backoff elapses

#### Scenario: Allows requests within rate limit
- **GIVEN** the rate limit is configured as 5 attempts per 60-second window
- **WHEN** 5 login attempts are made within 60 seconds from the same real connection address
- **THEN** all 5 requests SHALL be processed normally (returning 200 or 401 based on passphrase)

#### Scenario: Rejects requests exceeding rate limit
- **GIVEN** the rate limit is configured as 5 attempts per 60-second window
- **WHEN** a 6th login attempt is made within 60 seconds from the same real connection address
- **THEN** the server SHALL return HTTP 429
- **AND** the response SHALL include a `Retry-After` header indicating seconds until the window resets

### Requirement: Session Token Expiration

Dashboard session tokens SHALL have a maximum lifetime and an idle timeout. After the maximum lifetime elapses, the token SHALL be invalid regardless of activity. After the idle timeout elapses with no authenticated requests, the token SHALL be invalid. Both durations SHALL be configurable.

#### Scenario: Token expires after maximum lifetime

- **GIVEN** the maximum session lifetime is configured as 24 hours
- **AND** a user logged in 24 hours ago and has been continuously active
- **WHEN** the user makes an API request
- **THEN** the server SHALL return HTTP 401
- **AND** the session cookie SHALL be cleared

#### Scenario: Token expires after idle timeout

- **GIVEN** the idle timeout is configured as 2 hours
- **AND** a user has not made any authenticated request for 2 hours
- **WHEN** the user makes an API request
- **THEN** the server SHALL return HTTP 401
- **AND** the session cookie SHALL be cleared

#### Scenario: Active usage extends idle timeout

- **GIVEN** the idle timeout is configured as 2 hours
- **AND** a user made a request 1 hour ago
- **WHEN** the user makes a new API request
- **THEN** the request SHALL succeed
- **AND** the idle timeout SHALL reset to 2 hours from now

#### Scenario: Maximum lifetime is not extended by activity

- **GIVEN** the maximum session lifetime is configured as 24 hours
- **AND** the user logged in 23 hours and 59 minutes ago
- **WHEN** the user makes an API request (resetting idle timeout)
- **THEN** the request SHALL succeed
- **BUT** the session SHALL still expire 1 minute later when the 24-hour max lifetime is reached

### Requirement: Timing-Safe Passphrase Validation

The passphrase comparison during login SHALL use `crypto.subtle.timingSafeEqual` (or equivalent constant-time comparison) to prevent timing side-channel attacks. The comparison SHALL encode both the submitted and configured passphrases to equal-length byte arrays before comparison.

#### Scenario: Correct passphrase accepted with constant-time comparison

- **GIVEN** `dashboard.passphrase` is `"my-secret"`
- **WHEN** a login request with passphrase `"my-secret"` is processed
- **THEN** the comparison SHALL use a constant-time algorithm
- **AND** the login SHALL succeed

#### Scenario: Wrong passphrase rejected with constant-time comparison

- **GIVEN** `dashboard.passphrase` is `"my-secret"`
- **WHEN** a login request with passphrase `"wrong-guess"` is processed
- **THEN** the comparison SHALL use a constant-time algorithm
- **AND** the login SHALL be rejected with HTTP 401

#### Scenario: Different-length passphrases do not cause early exit

- **GIVEN** `dashboard.passphrase` is `"my-secret"`
- **WHEN** a login request with passphrase `"x"` is processed
- **THEN** the system SHALL pad or hash both values to equal length before comparison
- **AND** the response time SHALL not vary significantly based on passphrase length

### Requirement: Secure Cookie Flag Behind TLS

The dashboard session cookie SHALL include the `Secure` flag when the connection is genuinely served over TLS OR when the operator has explicitly configured `dashboard.behindHttpsProxy: true`. The `Secure` flag SHALL NOT be derived solely from the client-supplied `X-Forwarded-Proto` header.

#### Scenario: Secure flag set when configured behind HTTPS proxy
- **GIVEN** `dashboard.behindHttpsProxy` is `true`
- **WHEN** a successful login sets the session cookie
- **THEN** the cookie SHALL include the `Secure` flag

#### Scenario: Secure flag not derived from spoofable header alone
- **GIVEN** `dashboard.behindHttpsProxy` is `false` and the connection is plain HTTP
- **WHEN** a login request arrives with `X-Forwarded-Proto: https`
- **THEN** the cookie SHALL NOT include the `Secure` flag based on that header alone

#### Scenario: Secure flag not set for plain HTTP
- **GIVEN** `dashboard.behindHttpsProxy` is `false` and no TLS is in use
- **WHEN** a successful login sets the session cookie
- **THEN** the cookie SHALL NOT include the `Secure` flag

### Requirement: Error Response Sanitization

API error responses SHALL NOT expose internal implementation details such as stack traces, file paths, or internal error class names. Error responses SHALL return a generic error message for 5xx errors and a descriptive but safe message for 4xx errors.

#### Scenario: 500 errors return generic message

- **GIVEN** an unhandled exception occurs during request processing
- **WHEN** the server generates an error response
- **THEN** the response body SHALL contain a generic message such as `"Internal server error"`
- **AND** the response SHALL NOT include stack traces or file paths

#### Scenario: 400 errors return safe descriptive message

- **GIVEN** a client sends an invalid request (e.g., malformed JSON)
- **WHEN** the server generates a 400 error response
- **THEN** the response body SHALL contain a descriptive message (e.g., `"Invalid request body"`)
- **AND** the message SHALL NOT include internal class names or code references

#### Scenario: 401 errors do not reveal whether passphrase exists

- **GIVEN** a login attempt with an incorrect passphrase
- **WHEN** the server returns HTTP 401
- **THEN** the response body SHALL contain a generic message such as `"Authentication failed"`
- **AND** the message SHALL NOT distinguish between "wrong passphrase" and "no passphrase configured"

### Requirement: Minimum Passphrase Strength

When the dashboard is enabled, the configuration loader SHALL enforce a minimum passphrase strength (at least 16 characters). If the dashboard is enabled with a passphrase shorter than the minimum, startup SHALL fail with a configuration error.

#### Scenario: Weak passphrase rejected at startup
- **GIVEN** `dashboard.enabled` is `true` and `dashboard.passphrase` is `"short"`
- **WHEN** configuration is loaded
- **THEN** loading SHALL fail with a `ConfigError` indicating the passphrase is too weak

#### Scenario: Sufficiently strong passphrase accepted
- **GIVEN** `dashboard.enabled` is `true` and `dashboard.passphrase` is at least 16 characters
- **WHEN** configuration is loaded
- **THEN** loading SHALL succeed

#### Scenario: Dashboard disabled skips passphrase strength check
- **GIVEN** `dashboard.enabled` is `false`
- **WHEN** configuration is loaded
- **THEN** the passphrase strength check SHALL be skipped

