## MODIFIED Requirements

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

## ADDED Requirements

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
