# email-identity Specification

## Purpose
Defines email configuration and mailbox identity so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Mailbox canonicalization

Email identities SHALL preserve local-part case and provider aliases, lowercase the domain, and use stable filesystem-safe workspace identifiers.

#### Scenario: Canonical and distinct addresses

- **WHEN** User+tag@EXAMPLE.COM and User+tag@example.com are configured
- **THEN** they resolve to one identity while user+tag@example.com and User@example.com remain distinct

### Requirement: Disabled secure configuration

Email SHALL default disabled. Enabled configuration SHALL require valid transport settings and a receiving-authentication trust declaration, and SHALL fail while production activation is unavailable.

#### Scenario: Invalid transport

- **WHEN** plaintext, opportunistic TLS, disabled certificate checks, or missing required fields are configured
- **THEN** startup fails without credentials in its error

### Requirement: Complete deployment field parity

Every email setting and environment override SHALL be documented consistently in the YAML example, environment example and Helm values.

#### Scenario: Email-only configuration

- **WHEN** Discord is disabled and email has complete settings
- **THEN** no Discord token is required, subject to the activation guard
