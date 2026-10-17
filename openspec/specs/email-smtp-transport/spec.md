# email-smtp-transport Specification

## Purpose
Defines certificate-validated smtp submission so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Mandatory encrypted SMTP

SMTP SHALL validate certificates and require direct TLS or mandatory STARTTLS before password authentication.

#### Scenario: Unsafe server

- **WHEN** STARTTLS is missing or certificate validation fails
- **THEN** no credentials or message bytes are submitted

### Requirement: Submission outcomes remain distinct

A positive final SMTP acceptance SHALL mean submitted, an explicit rejection SHALL mean failed, and a lost acknowledgement after possible submission SHALL mean unknown.

#### Scenario: Lost final reply

- **WHEN** local SMTP server consumes DATA and closes before acceptance reaches the client
- **THEN** result is unknown and client does not retry

### Requirement: Real protocol smoke

SMTP submission SHALL be exercised with isolated controlled protocol services rather than method-forwarding mocks alone.

#### Scenario: Accepted and rejected envelopes

- **WHEN** real client submits fixture MIME through a local TLS SMTP service
- **THEN** wire capture shows one envelope recipient and distinct accepted/rejected results
