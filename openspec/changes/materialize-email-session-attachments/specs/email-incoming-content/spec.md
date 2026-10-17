# Spec Delta

## ADDED Requirements

### Requirement: Session-contained attachment access

Accepted email attachments exposed to an agent SHALL have readable copies inside the authenticated owner's current canonical session staging boundary before context is returned or rendered. This covers trigger, included history and alternate retrieval. Archive bytes SHALL remain unchanged, archive paths SHALL NOT be exposed, and paths from other sessions SHALL NOT be reused.

#### Scenario: Trigger and history files are available

- **WHEN** a session assembles an authenticated attachment-only trigger and included same-owner history with attachments
- **THEN** every exposed attachment has a current-session path whose bytes match its archived bytes
- **AND** the trigger remains valid without invented authored text

#### Scenario: Alternate retrieval stages into calling session

- **WHEN** the agent retrieves an authorized email using get-message or fetch-context
- **THEN** returned attachment locations refer to copies inside that calling session's staging boundary
- **AND** a later session retrieving the same source receives its own session location

#### Scenario: Unsafe or unavailable source

- **WHEN** an attachment belongs to another owner, uses unsafe path components, encounters a symlink escape or cannot be read or staged
- **THEN** access fails explicitly without exposing archive paths or outside-boundary bytes
- **AND** no unstaged reference is presented as a usable file

#### Scenario: Session cleanup preserves archive

- **WHEN** session temporary copies are reclaimed
- **THEN** durable source and attachment bytes remain available for later authorized retrieval and backend forwarding

#### Scenario: Escaping staging ancestor

- **WHEN** an existing staging-root ancestor redirects outside the trusted current-session boundary through a symlink
- **THEN** preparation refuses before any outside directory creation, file write or archive-byte read

### Requirement: Trigger-only inline email images

Only eligible image attachments on the current email trigger SHALL produce ACP image content blocks, subject to existing image capability and size policies. Included history or alternate retrieval SHALL expose staged file references without implicitly adding image blocks to the prompt.

#### Scenario: Trigger image and historical image

- **WHEN** an image-capable session receives an eligible trigger image and includes a historical image
- **THEN** the trigger produces an image block from its staged bytes
- **AND** the historical image appears as a staged file reference without an image block

#### Scenario: Both production prompt paths

- **WHEN** either normal or alternate production prompt construction handles an eligible email trigger image
- **THEN** staging completes before image block construction and the trigger is not skipped for lacking a session path

#### Scenario: Converted image copies stay isolated

- **WHEN** two same-owner sessions process the same eligible trigger GIF
- **THEN** conversion inputs and derived outputs stay inside each calling session's validated staging boundary without shared filenames outside those boundaries
