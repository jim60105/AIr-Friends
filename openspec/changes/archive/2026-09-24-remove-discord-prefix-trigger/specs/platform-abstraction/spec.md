## MODIFIED Requirements

### Requirement: Discord Message Processing

The Discord adapter SHALL handle message events with filtering, normalization, and mention processing.

#### Scenario: Message filtering
- **GIVEN** a Discord message event
- **WHEN** `shouldRespondToMessage()` evaluates the message
- **THEN** it SHALL reject messages from bots and messages from self
- **AND** in DM channels it SHALL respond only when DM allowance (`allowDm`) is enabled
- **AND** in guild channels it SHALL respond only when `respondToMention` is enabled and the message mentions the bot; no command-prefix trigger SHALL exist

#### Scenario: Prefix-prefixed guild message does not trigger
- **GIVEN** a guild (non-DM) Discord message whose content starts with a former command prefix such as `"!"` and which does NOT mention the bot, evaluated even if a caller still supplies a legacy `commandPrefix` option
- **WHEN** `shouldRespondToMessage()` evaluates the message
- **THEN** it SHALL return `false`

#### Scenario: Bot mention removal
- **GIVEN** a message that mentions the bot
- **WHEN** processed by the adapter
- **THEN** it SHALL remove the bot mention from the content before emitting the event

#### Scenario: Sticker handling
- **GIVEN** a Discord message with stickers
- **WHEN** normalized
- **THEN** sticker content SHALL be appended to the message content as `[Sticker: name (tags)]` when sticker tags are present, or `[Sticker: name]` when tags are absent
