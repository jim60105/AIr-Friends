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

### Requirement: Backward Compatibility

The `attachments` field on `NormalizedEvent` and `PlatformMessage` SHALL be optional. Messages without attachments SHALL have `attachments` as `undefined`. The context format for text-only messages SHALL remain unchanged from previous behavior.

#### Scenario: Text-only message unchanged

- **GIVEN** a user sends a text-only message with no attachments
- **WHEN** the message is processed
- **THEN** the normalized event SHALL have no `attachments` field and context format SHALL be unchanged

### Requirement: Attachment URL SSRF Validation

The system SHALL validate every attachment URL immediately before each server-side fetch at the download sink, applied to every network request regardless of platform or code path; validation SHALL require the URL scheme to be `http` or `https` and reject hosts resolving to loopback, private (RFC1918), link-local, unique-local, unspecified, or multicast addresses. A URL failing validation SHALL NOT be fetched and SHALL fall back to URL-only text description.

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

#### Scenario: Redirects re-validated up to a hop limit

- **GIVEN** a fetched URL redirects to another target
- **WHEN** the system follows the redirect with manual redirect handling
- **THEN** it SHALL re-validate each redirect target against the same validation rules before following
- **AND** it SHALL abort the fetch beyond a maximum of 5 redirect hops

#### Scenario: Ingestion-time validation is defense-in-depth

- **GIVEN** an attachment URL was previously validated at platform ingestion time
- **WHEN** the download sink prepares to fetch the URL
- **THEN** the sink SHALL still validate the URL itself before each fetch
- **AND** ingestion-time validation SHALL NOT be the sole guard against SSRF

### Requirement: Fetch SSRF DNS-Rebinding Mitigation

The daemon-side SSRF-validated fetch (`safeFetch`) SHALL connect to the specific IP address that was validated, rather than re-resolving the hostname at connection time, so a second, attacker-controlled DNS resolution cannot substitute an internal address between validation and connection.

#### Scenario: Validated address is the one connected to
- **GIVEN** a URL whose hostname first resolves to a public address that passes validation
- **WHEN** `safeFetch` proceeds to connect
- **THEN** it SHALL connect to the validated address rather than re-resolving, so a changed DNS answer cannot redirect the connection to an internal address

#### Scenario: Rebinding to internal address does not reach the connection
- **GIVEN** a hostname that passes validation on first resolution but would resolve to `127.0.0.1` on a second resolution
- **WHEN** `safeFetch` connects using the pinned validated address
- **THEN** the internal address SHALL NOT be contacted

#### Scenario: Connect-time pinning not directly expressible
- **GIVEN** connect-time IP pinning is not directly expressible
- **WHEN** `safeFetch` connects to the URL
- **THEN** the implementation SHALL resolve the host to a validated address and connect against that address while preserving the original `Host` header and SNI
- **AND** it SHALL re-apply the address-range checks to the pinned address

### Requirement: Quoted Attachment Provenance and URL-Only Context

Quoted-source attachments SHALL remain owned by the quoted reference and SHALL NOT be merged into the outer message attachments; their URLs and available metadata SHALL be represented as encoded third-party reference data alongside the source author. The daemon SHALL NOT download quoted-source images, GIFs or other files for prompt content, including when the outer note is the trigger and the agent supports image input.

#### Scenario: Mixed outer and quoted files retain ownership
- **GIVEN** a trigger has its own image and quotes a source with an image and a PDF
- **WHEN** event and prompt content are created
- **THEN** only the outer image SHALL be a candidate for the existing image-download pipeline
- **AND** the source image and PDF SHALL remain under the attributed quote with URL, filename, MIME type and supplied size/dimensions

#### Scenario: Quote-only image receives no download
- **GIVEN** the outer trigger has no files and quotes an attachment-only image source
- **WHEN** the session prepares prompt content with image capability enabled or disabled
- **THEN** the quoted image SHALL be represented by attributed URL/metadata text
- **AND** zero daemon image downloads SHALL be attempted

#### Scenario: Quoted private or redirecting URL never reaches fetch
- **GIVEN** a quoted image URL targets loopback, a metadata address, a non-HTTP scheme or a public URL redirecting internally
- **WHEN** prompt content is prepared
- **THEN** no request to that quoted URL SHALL be issued
- **AND** the URL SHALL remain encoded reference data without granting it any fetch authorization

#### Scenario: History quotes remain URL-only
- **GIVEN** a retained historical quote includes image/GIF attachments
- **WHEN** history is rendered
- **THEN** source URLs and metadata SHALL appear within the source boundary
- **AND** no image download or GIF conversion SHALL occur for those files

#### Scenario: Existing outer image protections are unchanged
- **GIVEN** an outer-trigger image lacks capability support, exceeds 20 MB, times out, fails conversion or is rejected by sink SSRF validation
- **WHEN** prompt content is prepared for a note with or without a quote
- **THEN** existing URL-only fallback and rejection behavior SHALL be preserved
- **AND** quoted files SHALL NOT bypass or change those decisions
