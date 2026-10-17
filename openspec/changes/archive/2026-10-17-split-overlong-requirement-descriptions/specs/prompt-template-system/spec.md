# Spec Delta

## MODIFIED Requirements

### Requirement: Available Template Variables

The `TemplateVariables` interface SHALL define the variables templates may consume: the core variables available to every session — including `platform` accepting `"discord" \| "misskey" \| "internal"` and `agentType` holding the ACP agent type `"opencode"` or `"omp"`, with `tmpDir` an optional absolute staging directory of `{session workspace}/tmp/{sessionId}` — plus the session-type-specific variables, with the types, descriptions and optionality the scenarios below state.

#### Scenario: Core variables available
- **GIVEN** a normal message session
- **WHEN** the template is rendered
- **THEN** `isDm`, `platform`, `userId`, `channelId`, `guildId`, and `userContextMessage` SHALL be available
- **AND** `sessionId` SHALL be the literal active Skill API session id and `tmpDir` the absolute staging directory for that session

#### Scenario: Spontaneous-specific variables
- **GIVEN** a spontaneous post session
- **WHEN** the template is rendered
- **THEN** `recentMessagesFetched`, `importantMemories`, `recentMessages`, and `availableEmojis` SHALL be available
- **AND** `sessionId` and `tmpDir` SHALL be supplied for that session

#### Scenario: Every payload-staging render supplies the pair
- **GIVEN** the self-research, conversation-summary, memory-maintenance, and channel-memory-maintenance prompt paths
- **WHEN** each renders its system prompt
- **THEN** the render SHALL pass `sessionId` and `tmpDir` (self-research included, closing the gap where it previously rendered without a staging directory)
- **AND** the rendered payload-staging text SHALL contain the literal id and absolute directory rather than `$TMPDIR`/`$SESSION_ID`

#### Scenario: No token fallback survives rendering
- **GIVEN** any payload-staging session type rendered through the bundled templates
- **WHEN** the rendered text instructs the agent where to stage a payload file or which `--session-id` to pass
- **THEN** that instruction SHALL contain the literal values
- **AND** the rendered text SHALL NOT contain `$TMPDIR` or `$SESSION_ID` tokens inside the staging/session-id instructions

#### Scenario: Core variable details
- **GIVEN** a template is rendered
- **THEN** `isDm` (boolean) SHALL indicate whether the conversation is a direct message
- **AND** `platform` SHALL be `"discord"`, `"misskey"`, or `"internal"`
- **AND** `userId` (string) SHALL hold the user's platform ID
- **AND** `channelId` (string) SHALL hold the channel/conversation ID
- **AND** `guildId` (string) SHALL hold the server/guild ID, empty string if N/A
- **AND** `agentType` (string, optional) SHALL be the ACP agent type (`"opencode"`)
- **AND** `model` (string, optional) SHALL hold the model identifier
- **AND** `yolo` (boolean, optional) SHALL indicate whether YOLO mode is enabled
- **AND** `canWriteAgentWorkspace` (boolean, optional) SHALL indicate whether the session allows writing to the agent workspace
- **AND** `userContextMessage` (string, optional) SHALL hold the pre-formatted user context (normal message only)

#### Scenario: Spontaneous variable details
- **GIVEN** a spontaneous post session
- **THEN** `recentMessagesFetched` (boolean, optional) SHALL indicate whether recent messages were fetched
- **AND** `importantMemories` (string, optional) SHALL hold formatted important memories text
- **AND** `recentMessages` (string, optional) SHALL hold formatted recent messages text
- **AND** `availableEmojis` (string, optional) SHALL hold formatted available emojis text

#### Scenario: Memory maintenance variables
- **GIVEN** a memory maintenance session
- **WHEN** the template is rendered
- **THEN** `workspaceKey` (string, optional) SHALL hold the workspace key
- **AND** `memoriesDump` (string, optional) SHALL hold a JSON dump of enabled memories
- **AND** `minMemoryCount` (number, optional) SHALL hold the minimum memory count threshold

#### Scenario: Self-research variables
- **GIVEN** a self-research session
- **WHEN** the template is rendered
- **THEN** `rssItems` (string, optional) SHALL hold the formatted RSS items block

#### Scenario: Reminder variables
- **GIVEN** a reminder session
- **WHEN** the template is rendered
- **THEN** `reminderMessage` (string, optional) SHALL hold the reminder message content
- **AND** `reminderCreatedAt` (string, optional) SHALL hold the reminder creation timestamp
- **AND** `reminderScheduledAt` (string, optional) SHALL hold the reminder scheduled delivery timestamp

## ADDED Requirements

### Requirement: Payload-Staging Variables Are Supplied As Literals

Every payload-staging session type SHALL receive `sessionId` (the literal active Skill API session id) and `tmpDir` (that session's ABSOLUTE staging directory) on every render; bundled templates SHALL NOT contain `{{ sessionId || "$SESSION_ID" }}` or `{{ tmpDir || "$TMPDIR/$SESSION_ID" }}` fallbacks. The values SHALL equal the literal id and canonical staging directory the Skill API and ACP filesystem authorization use, whatever the agent process environment, per-spawn and pooled alike.

#### Scenario: Every payload-staging session type receives the pair
- **GIVEN** the normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel) and scheduled reminder prompt paths, each of whose prompt instructs skill payload staging
- **WHEN** each renders its system prompt
- **THEN** the render SHALL pass `sessionId` and `tmpDir`
- **AND** the rendered payload-staging text SHALL contain the literal id and absolute directory rather than `$TMPDIR`/`$SESSION_ID`

#### Scenario: No bundled template carries a token fallback form
- **GIVEN** any payload-staging session type rendered through the bundled templates
- **WHEN** the rendered text instructs the agent where to stage a payload file or which `--session-id` to pass
- **THEN** that instruction SHALL contain the literal values
- **AND** the bundled templates SHALL NOT contain the `{{ sessionId || "$SESSION_ID" }}` or `{{ tmpDir || "$TMPDIR/$SESSION_ID" }}` fallback forms

#### Scenario: Supplied values match the Skill API and ACP authorization
- **GIVEN** a payload-staging session running in per-spawn or pooled operation
- **WHEN** its prompt is rendered
- **THEN** the supplied `sessionId` and `tmpDir` SHALL be the same literal id and absolute canonical staging directory the Skill API and the ACP filesystem authorization use
- **AND** they SHALL NOT derive from the agent process environment
