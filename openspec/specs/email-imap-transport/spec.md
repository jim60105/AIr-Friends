# email-imap-transport Specification

## Purpose
Defines certificate-validated imap transport so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Authenticated encrypted IMAP

IMAP SHALL require certificate-validated direct TLS or mandatory STARTTLS and password authentication only after transport encryption succeeds.

#### Scenario: Downgrade or invalid certificate

- **WHEN** server omits STARTTLS or presents an untrusted certificate
- **THEN** connection fails before credentials are sent

### Requirement: UID-based bounded retrieval

Retrieval SHALL use UIDVALIDITY and UID independently of read flags and reject oversized sources before loading their bytes.

#### Scenario: Read elsewhere

- **WHEN** new mail has Seen set by another client
- **THEN** the UID still appears in listAfter and its bounded source remains retrievable

### Requirement: Controlled protocol evidence

IMAP behavior SHALL be demonstrated against isolated local protocol services with test credentials.

#### Scenario: Protocol smoke

- **WHEN** the real IMAP library connects to a controlled test service using a fixture CA
- **THEN** login/select/status/fetch/append and disconnect exchanges complete without production access
