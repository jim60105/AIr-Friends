# Spec Delta

## MODIFIED Requirements

### Requirement: Attachment Model

The system SHALL represent network message attachments with the `Attachment` interface containing: `id`, `url`, `mimeType`, `filename`, optional `size`, `width`, `height`, and a computed `isImage` flag (true when mimeType starts with `"image/"`).

#### Scenario: Image attachment detection
- **GIVEN** an attachment with mimeType `"image/png"`
- **WHEN** the attachment is processed
- **THEN** `isImage` SHALL be `true`

#### Scenario: Non-image attachment
- **GIVEN** an attachment with mimeType `"application/pdf"`
- **WHEN** the attachment is processed
- **THEN** `isImage` SHALL be `false`

#### Scenario: Stored email file
- **WHEN** an email attachment is normalized
- **THEN** it SHALL use an opaque owner-bound local-email reference variant instead of a URL, with MIME/display/size metadata and computed image status
