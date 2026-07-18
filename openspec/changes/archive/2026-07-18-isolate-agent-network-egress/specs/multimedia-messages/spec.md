## ADDED Requirements

### Requirement: Fetch SSRF DNS-Rebinding Mitigation

The daemon-side SSRF-validated fetch (`safeFetch`) SHALL connect to the specific IP address that was validated, rather than re-resolving the hostname independently at connection time, so that a second, attacker-controlled DNS resolution cannot substitute an internal address between validation and connection. When connect-time IP pinning is not directly expressible, the implementation SHALL resolve the host to a validated address and perform the connection against that address while preserving the original `Host`/SNI, and SHALL re-apply the address-range checks to the pinned address.

#### Scenario: Validated address is the one connected to
- **GIVEN** a URL whose hostname first resolves to a public address that passes validation
- **WHEN** `safeFetch` proceeds to connect
- **THEN** it SHALL connect to the validated address rather than re-resolving, so a changed DNS answer cannot redirect the connection to an internal address

#### Scenario: Rebinding to internal address does not reach the connection
- **GIVEN** a hostname that passes validation on first resolution but would resolve to `127.0.0.1` on a second resolution
- **WHEN** `safeFetch` connects using the pinned validated address
- **THEN** the internal address SHALL NOT be contacted
