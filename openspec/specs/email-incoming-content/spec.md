# email-incoming-content Specification

## Purpose
Defines bounded mime parsing and provenance so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## Requirements

### Requirement: Inert bounded content

Incoming mail SHALL prefer plain text and convert HTML without execution or remote resource access. Raw bytes and attachment count SHALL be bounded before loading their contents.

#### Scenario: Oversized or excessive MIME

- **WHEN** declared size exceeds limit or streaming parsing discovers an eleventh attachment
- **THEN** processing terminates explicitly without a partial accepted message

### Requirement: Provenance survives normalization

Authored text SHALL remain distinguishable from quoted and forwarded reference material, and ambiguous separation SHALL NOT grant third-party destinations.

#### Scenario: Ambiguous quoted command

- **WHEN** HTML or mixed quoting makes new authorship uncertain
- **THEN** the body remains available as reference data with ambiguous authorization provenance

### Requirement: Attachment-only requests

An authenticated attachment-only message SHALL remain a valid incoming request.

#### Scenario: Empty body with attachment

- **WHEN** a valid MIME message has no body text and one bounded attachment
- **THEN** its normalized content includes attachment metadata without inventing authored text
