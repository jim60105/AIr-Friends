# Delta: prompt-template-system

## MODIFIED Requirements

### Requirement: Available Template Variables

The `TemplateVariables` interface SHALL define the following variables available in all templates:

**Core variables (always available):**

| Variable               | Type                            | Description                                          |
| ---------------------- | ------------------------------- | ---------------------------------------------------- |
| `isDm`                 | `boolean`                       | Whether this is a direct message conversation        |
| `platform`             | `"discord" \| "misskey" \| "internal"` | Platform identifier                           |
| `userId`               | `string`                        | User's platform ID                                   |
| `channelId`            | `string`                        | Channel/conversation ID                              |
| `guildId`              | `string`                        | Server/guild ID (empty string if N/A)                |
| `agentType`            | `string` (optional)             | ACP agent type (`"opencode"` or `"omp"`)             |
| `model`                | `string` (optional)             | Model identifier                                     |
| `yolo`                 | `boolean` (optional)            | Whether YOLO mode is enabled                         |
| `canWriteAgentWorkspace` | `boolean` (optional)          | Whether session allows writing to agent workspace    |
| `userContextMessage`   | `string` (optional)             | Pre-formatted user context (normal message only)     |
| `sessionId`            | `string` (optional)             | Literal active Skill API session id                  |
| `tmpDir`               | `string` (optional)             | Absolute session payload staging directory (`{session workspace}/tmp/{sessionId}`) |

For every session type whose prompt instructs skill payload staging — normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel), and scheduled reminder — the render call sites SHALL supply `sessionId` (the literal active Skill API session id) and `tmpDir` (that session's ABSOLUTE staging directory) on every render of those templates: the templates SHALL NOT fall back to `$SESSION_ID`/`$TMPDIR` shell tokens when a variable is absent (no `{{ sessionId || "$SESSION_ID" }}` / `{{ tmpDir || "$TMPDIR/$SESSION_ID" }}` fallback forms remain in bundled templates), so a rendered payload-staging prompt never contains an unexpanded shell token where the agent is told to write or reference a payload file. The values SHALL be the same literal id and absolute canonical staging directory that the Skill API and the ACP filesystem authorization use, independent of the agent process environment (per-spawn and pooled alike).

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
