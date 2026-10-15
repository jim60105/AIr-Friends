# Spec Delta

## ADDED Requirements

### Requirement: Reaction Recipes Use the Platform Reaction Value

The react-message skill instructions SHALL direct agents to pass the exact platform-provided `useAsReaction` value, represented by `<r>` in rendered emoji context, to `--emoji`. They SHALL distinguish Discord and Misskey custom examples and preserve Unicode usage, without re-encoding a reaction value as text markup.

#### Scenario: Discord custom reaction
- **GIVEN** a Discord emoji with text value `<:wave:123456789012345678>` and reaction value `wave:123456789012345678`
- **WHEN** the agent follows the documented Discord recipe
- **THEN** the recipe SHALL pass `--emoji "wave:123456789012345678"`
- **AND** it SHALL direct substitution of the actual supplied reaction value, including for animated custom emojis

#### Scenario: Misskey custom reaction
- **GIVEN** a Misskey emoji with reaction value `:wave:`
- **WHEN** the agent follows the documented Misskey recipe
- **THEN** the recipe SHALL pass `--emoji ":wave:"` without claiming that syntax applies to Discord

#### Scenario: Unicode and restrictions remain intact
- **WHEN** reaction instructions describe standard Unicode emojis and restricted custom emojis
- **THEN** they SHALL retain direct Unicode-character usage and the existing optional once-per-session guidance
- **AND** using an exact supplied value SHALL NOT imply that platform reaction restrictions are bypassed

### Requirement: File Recipes Address Existing Nested Workspace Files

The send-file skill instructions SHALL explain that relative `--file-paths` values resolve from the session workspace root. They SHALL show an existing session-staged file sent as `tmp/<sessionId>/file.png` without copying it to the workspace root. Attachment-path examples SHALL remain distinct from absolute session-scoped caption-payload examples and SHALL preserve existing containment rules.

#### Scenario: Send the staged image in place
- **GIVEN** workspace `/work/discord/123`, literal session id `sess_42`, and existing `/work/discord/123/tmp/sess_42/file.png`
- **WHEN** the documented session-staged example is followed
- **THEN** it SHALL pass `--file-paths "tmp/sess_42/file.png"` with that literal session id
- **AND** it SHALL state that copying or moving the existing nested file to the workspace root is unnecessary

#### Scenario: Caption path remains absolute
- **WHEN** the documented example adds a caption
- **THEN** it SHALL pass the caption using `--caption-file` under the rendered absolute session staging directory
- **AND** it SHALL keep caption text off the command line and use the rendered trusted script root

#### Scenario: Existing security boundaries remain
- **WHEN** the recipes describe nested files
- **THEN** they SHALL retain traversal and symlink-escape prohibitions, file/batch limits and the one-send quota
- **AND** they SHALL NOT imply that attachment paths must be session-staged or that existing accepted in-workspace absolute paths are forbidden

### Requirement: Skill Cancellation Instructions Are Agent-Portable

Bundled skill documents and the summary template SHALL NOT prescribe the stale `stop_bash` tool name or a speculative replacement alias. Their cancellation wording SHALL refer to the selected agent's documented running-command controls when available, without duplicating agent-specific shell parameters or treating cancellation as proof of non-delivery.

#### Scenario: Published instructions avoid invented tool names
- **WHEN** bundled skill documents and summary instructions are inspected
- **THEN** no executable instruction SHALL name `stop_bash`
- **AND** cancellation advice SHALL defer to available documented controls without inventing a status or cancellation tool

#### Scenario: Delivery uncertainty survives cancellation
- **WHEN** a sending script is stopped after it may have contacted the platform
- **THEN** the instructions SHALL NOT claim cancellation proves that nothing was delivered
- **AND** existing no-retry constraints on non-delivery skills SHALL remain unchanged
