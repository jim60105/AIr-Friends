# Spec Delta

## Purpose

Defines shared mime construction and literal signatures so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Central fixed signature

Every outgoing email SHALL apply the startup-loaded literal multiline signature once after body cleanup and before MIME construction, using the standard signature separator. Empty or whitespace-only configuration SHALL add nothing.

#### Scenario: Multiline and literal content

- **WHEN** signature contains multiple lines and template/environment syntax
- **THEN** literal line structure remains and sent-copy construction does not add a second signature

### Requirement: Forward signature ordering

Forwarded mail SHALL place the bot signature after commentary and before the original reference section while preserving original signatures and attachment bytes.

#### Scenario: Signed source forward

- **WHEN** a source has its own signature and binary attachment
- **THEN** new signature precedes source content and source bytes remain identical

### Requirement: Safe message envelope

Outgoing mail SHALL have one authorized envelope recipient, validated headers and an automatic-response loop marker.

#### Scenario: Injected subject

- **WHEN** subject contains CRLF plus Bcc header text
- **THEN** construction fails before a submission intent is created
