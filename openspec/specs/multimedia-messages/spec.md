# Multimedia Messages

## Purpose

Support passing image and file attachments from platform messages to the ACP Agent, with capability negotiation, size limits, and graceful fallbacks.
## Requirements
### Requirement: Attachment Interface

Each attachment SHALL conform to the `Attachment` interface with fields: `id` (string), `url` (string), `mimeType` (string), `filename` (string), `isImage` (boolean), and optional `size` (number), `width` (number), `height` (number). The `isImage` field SHALL be `true` when the MIME type starts with `"image/"`.

#### Scenario: Image attachment has isImage true

- **GIVEN** a file with `mimeType: "image/png"`
- **WHEN** the attachment is created
- **THEN** `isImage` SHALL be `true`

#### Scenario: Non-image attachment has isImage false

- **GIVEN** a file with `mimeType: "application/pdf"`
- **WHEN** the attachment is created
- **THEN** `isImage` SHALL be `false`

### Requirement: Discord Attachment Extraction

The system SHALL extract attachments from Discord `message.attachments` (Collection) and convert each to an `Attachment` using `discordAttachmentToAttachment()`. The system SHALL format Discord `message.stickers` as text representations appended to message content in the format `[Sticker: name (tags)]` or `[Sticker: name]` when tags are absent. Stickers SHALL NOT be included in the `attachments` array.

#### Scenario: Discord message with image attachment

- **GIVEN** a Discord message has one image in `message.attachments`
- **WHEN** the message is converted to a normalized event
- **THEN** the `attachments` array SHALL contain one `Attachment` with the Discord attachment's properties

#### Scenario: Discord message with sticker

- **GIVEN** a Discord message has a sticker named `"wave"` with tags `"hello"`
- **WHEN** the message is converted
- **THEN** the message content SHALL include `[Sticker: wave (hello)]`

#### Scenario: Discord message with no attachments

- **GIVEN** a Discord message has no attachments and no stickers
- **WHEN** the message is converted
- **THEN** the `attachments` field SHALL be `undefined`

### Requirement: Misskey Attachment Extraction

The system SHALL extract attachments from Misskey `note.files` (DriveFile array) for note messages. For Misskey chat messages, the system SHALL extract from `message.file` (single DriveFile or null). Each DriveFile SHALL be converted to an `Attachment` with `mimeType` from `file.type`, dimensions from `file.properties.width`/`height`, and `isImage` from `file.type.startsWith("image/")`.

#### Scenario: Misskey note with files

- **GIVEN** a Misskey note has two files in `note.files`
- **WHEN** the note is converted to a normalized event or platform message
- **THEN** the `attachments` array SHALL contain two `Attachment` objects

#### Scenario: Misskey chat message with file

- **GIVEN** a Misskey chat message has a single `message.file`
- **WHEN** the message is converted
- **THEN** the `attachments` array SHALL contain one `Attachment` object

#### Scenario: Misskey note with no files

- **GIVEN** a Misskey note has `files` as an empty array or undefined
- **WHEN** the note is converted
- **THEN** the `attachments` field SHALL be `undefined`

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

### Requirement: Backward Compatibility

The `attachments` field on `NormalizedEvent` and `PlatformMessage` SHALL be optional. Messages without attachments SHALL have `attachments` as `undefined`. The context format for text-only messages SHALL remain unchanged from previous behavior.

#### Scenario: Text-only message unchanged

- **GIVEN** a user sends a text-only message with no attachments
- **WHEN** the message is processed
- **THEN** the normalized event SHALL have no `attachments` field and context format SHALL be unchanged

### Requirement: Attachment URL SSRF Validation

The system SHALL validate every attachment URL immediately before each server-side fetch to prevent Server-Side Request Forgery. This validation SHALL be enforced at the download sink itself (the image downloader in the session orchestrator), applied to every network request regardless of which platform or code path populated the attachment URL; platform ingestion-time validation is optional defense-in-depth and SHALL NOT be the sole guard. Validation SHALL: (1) require the URL scheme to be `http` or `https`; (2) resolve the host and reject the fetch when any resolved address is loopback, private (RFC1918), link-local (`169.254.0.0/16`, `fe80::/10`), unique-local (`fc00::/7`), unspecified, or multicast; and (3) fetch with manual redirect handling, re-validating each redirect target against the same rules before following, up to a maximum of 5 redirect hops (aborting beyond that). A URL that fails validation SHALL NOT be fetched; the attachment SHALL fall back to URL-only text description.

#### Scenario: Loopback URL rejected

- **GIVEN** a trigger message image attachment whose URL resolves to `127.0.0.1`
- **WHEN** the system evaluates whether to download the image
- **THEN** the fetch SHALL NOT be performed
- **AND** the attachment SHALL be described by URL only

#### Scenario: Link-local metadata endpoint rejected

- **GIVEN** an image attachment whose URL host resolves to `169.254.169.254`
- **WHEN** the system evaluates the URL
- **THEN** the fetch SHALL NOT be performed

#### Scenario: Non-http scheme rejected

- **GIVEN** an image attachment whose URL scheme is `file` or `gopher`
- **WHEN** the system evaluates the URL
- **THEN** the fetch SHALL NOT be performed

#### Scenario: Redirect to internal address rejected

- **GIVEN** an image attachment whose URL is public but redirects (302) to `http://127.0.0.1:3001/`
- **WHEN** the system fetches with manual redirect handling
- **THEN** it SHALL re-validate the redirect target, reject the internal address, and SHALL NOT follow the redirect

#### Scenario: Valid public image URL fetched

- **GIVEN** an image attachment whose URL is `https://media.example.com/pic.png` resolving to a public address
- **WHEN** the system evaluates the URL
- **THEN** the fetch SHALL proceed (subject to existing size and timeout constraints)

