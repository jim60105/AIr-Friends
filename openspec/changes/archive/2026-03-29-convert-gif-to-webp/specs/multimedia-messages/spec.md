## MODIFIED Requirements

### Requirement: Size Limit and Download Timeout

Images exceeding 20 MB SHALL NOT be downloaded; they SHALL be described by URL only. Images with `image/gif` MIME type SHALL be downloaded, converted to static WebP format using ImageMagick, and sent as `ContentBlock::Image` with `image/webp` MIME type. The conversion SHALL extract only the first frame. If conversion fails, the system SHALL fall back to text-description-only. Image downloads SHALL have a 10-second timeout. Download failures (timeout, network error, HTTP error) SHALL be non-fatal — the system SHALL fall back to URL-only text description without throwing errors.

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
