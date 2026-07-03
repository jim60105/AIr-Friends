## ADDED Requirements

### Requirement: Attachment URL SSRF Validation

The system SHALL validate every attachment URL immediately before each server-side fetch to prevent Server-Side Request Forgery. This validation SHALL be enforced at the download sink itself (the image downloader in the session orchestrator), applied to every network request regardless of which platform or code path populated the attachment URL; platform ingestion-time validation is optional defense-in-depth and SHALL NOT be the sole guard. Validation SHALL: (1) require the URL scheme to be `http` or `https`; (2) resolve the host and reject the fetch when any resolved address is loopback, private (RFC1918), link-local (`169.254.0.0/16`, `fe80::/10`), unique-local (`fc00::/7`), unspecified, or multicast; and (3) fetch with manual redirect handling, re-validating each redirect target against the same rules before following, up to a maximum of 5 redirect hops (aborting beyond that). A URL that fails validation SHALL NOT be fetched; the attachment SHALL fall back to URL-only text description.

#### Scenario: Loopback URL rejected

- **GIVEN** a trigger message image attachment whose URL resolves to `127.0.0.1`
- **WHEN** the system evaluates whether to download the image
- **THEN** the fetch SHALL NOT be performed
- **AND** the attachment SHALL be described by URL only

#### Scenario: Link-local metadata endpoint rejected

- **GIVEN** an image attachment whose URL host resolves to `169.254.169.254`
- **WHEN** the system evaluates the URL
- **THEN** the fetch SHALL NOT be performed

#### Scenario: Non-http scheme rejected

- **GIVEN** an image attachment whose URL scheme is `file` or `gopher`
- **WHEN** the system evaluates the URL
- **THEN** the fetch SHALL NOT be performed

#### Scenario: Redirect to internal address rejected

- **GIVEN** an image attachment whose URL is public but redirects (302) to `http://127.0.0.1:3001/`
- **WHEN** the system fetches with manual redirect handling
- **THEN** it SHALL re-validate the redirect target, reject the internal address, and SHALL NOT follow the redirect

#### Scenario: Valid public image URL fetched

- **GIVEN** an image attachment whose URL is `https://media.example.com/pic.png` resolving to a public address
- **WHEN** the system evaluates the URL
- **THEN** the fetch SHALL proceed (subject to existing size and timeout constraints)
