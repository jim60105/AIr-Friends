# Spec Delta

## ADDED Requirements

### Requirement: Owner-scoped local attachments

Email attachment content SHALL be made available only as internally resolved copies within the current user session staging boundary.

#### Scenario: Cross-user or symlink reference
- **WHEN** a forged local reference names another owner or a staging symlink escapes
- **THEN** no private bytes are read or staged

### Requirement: Network protections remain intact

Adding local attachments SHALL preserve existing HTTP attachment SSRF checks and SHALL NOT admit file URLs as network fetch targets.

#### Scenario: Mixed attachment types
- **WHEN** a session includes a local email file and an unsafe network URL
- **THEN** only the owner-validated local copy is accessible and unsafe URL remains unfetched

### Requirement: Cleanup preserves sources

Session cleanup SHALL remove temporary attachment copies without removing permanent source history.

#### Scenario: Session ends
- **WHEN** the tmp lifecycle runs after attachment processing
- **THEN** archive bytes remain intact and no sibling session copy is removed

## MODIFIED Requirements

### Requirement: Attachment Interface

Each network attachment SHALL conform to the `Attachment` interface with fields: `id` (string), `url` (string), `mimeType` (string), `filename` (string), `isImage` (boolean), and optional `size` (number), `width` (number), `height` (number). The `isImage` field SHALL be `true` when the MIME type starts with `"image/"`.

#### Scenario: Image attachment has isImage true

- **GIVEN** a file with `mimeType: "image/png"`
- **WHEN** the attachment is created
- **THEN** `isImage` SHALL be `true`

#### Scenario: Non-image attachment has isImage false

- **GIVEN** a file with `mimeType: "application/pdf"`
- **WHEN** the attachment is created
- **THEN** `isImage` SHALL be `false`

#### Scenario: Local email attachment variant
- **WHEN** a stored email attachment is normalized
- **THEN** it SHALL carry a local-email discriminator, opaque owner/message/attachment references and the same MIME/display/size metadata without a URL or arbitrary path
- **AND** local materialization SHALL enforce current-session containment


### Requirement: Text Description Always Present

Attachment URLs and metadata SHALL always be included as text descriptions in the assembled context, regardless of whether the agent supports image capability. This ensures the agent always has awareness of attachments.

#### Scenario: Text description present with image capability

- **GIVEN** the agent supports image capability and an image is successfully downloaded
- **WHEN** context is assembled
- **THEN** the context SHALL include both the text description with URL and the image `ContentBlock`

#### Scenario: Text description present without image capability

- **GIVEN** the agent does not support image capability
- **WHEN** context is assembled for a message with attachments
- **THEN** the context SHALL include text descriptions with URLs for all attachments

#### Scenario: Local email attachment handling
- **WHEN** this requirement is applied to an owner-validated local-email attachment
- **THEN** network URL/download wording SHALL apply only to network attachments; local metadata SHALL use the session-contained file path, and only trigger images with negotiated capability and within the existing size limit SHALL become image content blocks
- **AND** history files SHALL remain reference metadata unless materialized under the same current-session owner checks


### Requirement: Trigger-Only Image Download

Only trigger message images SHALL be downloaded for `ContentBlock` inclusion. Images in history messages SHALL be described by URL only, without downloading.

#### Scenario: Trigger message image downloaded

- **GIVEN** the trigger message contains an image attachment
- **WHEN** the session processes the trigger
- **THEN** the image SHALL be downloaded and included as a `ContentBlock::Image`

#### Scenario: History message image not downloaded

- **GIVEN** a history message contains an image attachment
- **WHEN** context is assembled
- **THEN** the image SHALL be described by URL only; no download SHALL occur

#### Scenario: Local email attachment handling
- **WHEN** this requirement is applied to an owner-validated local-email attachment
- **THEN** network URL/download wording SHALL apply only to network attachments; local metadata SHALL use the session-contained file path, and only trigger images with negotiated capability and within the existing size limit SHALL become image content blocks
- **AND** history files SHALL remain reference metadata unless materialized under the same current-session owner checks


### Requirement: Size Limit and Download Timeout

Images exceeding 20 MB SHALL NOT be downloaded and SHALL be described by URL only. Image downloads SHALL have a 10-second timeout, and download failures (timeout, network error, HTTP error) SHALL be non-fatal, causing the image to fall back to URL-only text description without throwing errors.

#### Scenario: Image exceeds 20 MB

- **GIVEN** an image attachment has `size` greater than 20 MB
- **WHEN** the system evaluates whether to download
- **THEN** the image SHALL NOT be downloaded and SHALL be described by URL only

#### Scenario: GIF image converted to WebP

- **WHEN** a trigger message has an image attachment with `mimeType` equal to `image/gif`
- **THEN** the image SHALL be downloaded
- **AND** the system SHALL convert the GIF to WebP using ImageMagick extracting the first frame
- **AND** the converted WebP file SHALL be saved to the workspace `$TMPDIR`
- **AND** the converted image SHALL be sent as a `ContentBlock::Image` with `mimeType` `image/webp`

#### Scenario: GIF conversion fails gracefully

- **WHEN** a trigger message has an image attachment with `mimeType` equal to `image/gif`
- **AND** the ImageMagick conversion fails (non-zero exit code or missing binary)
- **THEN** the image SHALL NOT be included as a `ContentBlock::Image`
- **AND** the text description with URL SHALL still be present in the context
- **AND** no error SHALL be thrown

#### Scenario: Static image with supported MIME type

- **WHEN** a trigger message has an image attachment with `mimeType` equal to `image/png`
- **THEN** the image SHALL be downloaded and included as a `ContentBlock::Image` (subject to size and timeout constraints)

#### Scenario: Image download times out

- **GIVEN** the image URL takes longer than 10 seconds to respond
- **WHEN** the download is attempted
- **THEN** the download SHALL fail gracefully and the prompt SHALL contain only text description

#### Scenario: Image download returns HTTP error

- **GIVEN** the image URL returns an HTTP error status
- **WHEN** the download is attempted
- **THEN** no error SHALL be thrown and the attachment SHALL be described by URL only

#### Scenario: Local email attachment handling
- **WHEN** this requirement is applied to an owner-validated local-email attachment
- **THEN** network URL/download wording SHALL apply only to network attachments; local metadata SHALL use the session-contained file path, and only trigger images with negotiated capability and within the existing size limit SHALL become image content blocks
- **AND** history files SHALL remain reference metadata unless materialized under the same current-session owner checks


### Requirement: Capability Negotiation

The system SHALL send image `ContentBlock` to the ACP Agent only when the agent reports `promptCapabilities.image === true`. When the agent does not support image capability, no image download SHALL be attempted and only text descriptions SHALL be included.

#### Scenario: Agent supports image capability

- **GIVEN** the agent reports `promptCapabilities.image === true`
- **WHEN** a trigger message has an image attachment
- **THEN** the prompt SHALL include a `ContentBlock::Image` with the downloaded image data

#### Scenario: Agent does not support image capability

- **GIVEN** the agent does not support image prompt capability
- **WHEN** a trigger message has an image attachment
- **THEN** the prompt SHALL contain only text content blocks with attachment URL descriptions
- **AND** no image download SHALL be attempted

#### Scenario: Local email attachment handling
- **WHEN** this requirement is applied to an owner-validated local-email attachment
- **THEN** network URL/download wording SHALL apply only to network attachments; local metadata SHALL use the session-contained file path, and only trigger images with negotiated capability and within the existing size limit SHALL become image content blocks
- **AND** history files SHALL remain reference metadata unless materialized under the same current-session owner checks
