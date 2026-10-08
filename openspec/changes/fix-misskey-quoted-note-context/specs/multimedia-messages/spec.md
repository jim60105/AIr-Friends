## ADDED Requirements

### Requirement: Quoted Attachment Provenance and URL-Only Context

Quoted-source attachments SHALL remain owned by the quoted reference and SHALL NOT be merged into the outer message attachments. Their URLs and available metadata SHALL be represented as encoded third-party reference data alongside the source author. The daemon SHALL NOT download quoted-source images, GIFs or other files for prompt content, including when the outer note is the trigger and the agent supports image input. Retained historical quote attachments SHALL likewise be URL-only. Existing outer-trigger capability negotiation, 20 MB size limit, ten-second timeout, GIF conversion, text fallback and sink SSRF validation SHALL remain unchanged.

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
