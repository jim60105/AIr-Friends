## MODIFIED Requirements

### Requirement: Size Limit and Download Timeout

Images exceeding 20 MB SHALL NOT be downloaded; they SHALL be described by URL only. Images with `image/gif` MIME type SHALL NOT be downloaded; they SHALL be described by URL only (the existing text description with URL is preserved). Image downloads SHALL have a 10-second timeout. Download failures (timeout, network error, HTTP error) SHALL be non-fatal — the system SHALL fall back to URL-only text description without throwing errors.

#### Scenario: Image exceeds 20 MB

- **GIVEN** an image attachment has `size` greater than 20 MB
- **WHEN** the system evaluates whether to download
- **THEN** the image SHALL NOT be downloaded and SHALL be described by URL only

#### Scenario: Animated GIF image filtered out

- **WHEN** a trigger message has an image attachment with `mimeType` equal to `image/gif`
- **THEN** the image SHALL NOT be downloaded
- **AND** the image SHALL NOT be included as a `ContentBlock::Image`
- **AND** the text description with URL SHALL still be present in the context

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
