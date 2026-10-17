# Spec Delta

## Purpose

Defines receiving authentication and allowlist admission so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Authoritative receiver prerequisite

Automatic processing SHALL require a deployment-attested receiving-server header exclusion boundary and authoritative aligned DMARC pass for an enabled allowed From address.

#### Scenario: Forged Authentication-Results

- **WHEN** an attacker supplies a matching authserv-id without the attested stripping boundary
- **THEN** no session or rejection email is created

### Requirement: Fail-closed authentication

Missing, failing, duplicate or ambiguous authoritative authentication evidence SHALL NOT initiate sessions.

#### Scenario: Domain versus mailbox identity

- **WHEN** aligned DMARC passes for another actor at the permitted sender domain
- **THEN** operator documentation identifies the remaining mailbox-local spoofing risk without claiming full sender authentication

### Requirement: Loop and destination protection

Unauthorized, self-originated, delivery-failure and automatically generated mail SHALL be ignored silently. Ordinary replies SHALL target only the verified original sender.

#### Scenario: Malicious Reply-To

- **WHEN** an otherwise permitted message specifies an unrelated Reply-To/Cc
- **THEN** the permitted sender remains the sole ordinary reply recipient
