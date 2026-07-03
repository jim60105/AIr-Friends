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
| `agentType`            | `string` (optional)             | ACP agent type (`"opencode"`)                        |
| `model`                | `string` (optional)             | Model identifier                                     |
| `yolo`                 | `boolean` (optional)            | Whether YOLO mode is enabled                         |
| `canWriteAgentWorkspace` | `boolean` (optional)          | Whether session allows writing to agent workspace    |
| `userContextMessage`   | `string` (optional)             | Pre-formatted user context (normal message only)     |

**Spontaneous post variables:**

| Variable                | Type                 | Description                              |
| ----------------------- | -------------------- | ---------------------------------------- |
| `recentMessagesFetched` | `boolean` (optional) | Whether recent messages were fetched     |
| `importantMemories`     | `string` (optional)  | Formatted important memories text        |
| `recentMessages`        | `string` (optional)  | Formatted recent messages text           |
| `availableEmojis`       | `string` (optional)  | Formatted available emojis text          |

**Memory maintenance variables:**

| Variable          | Type                | Description                               |
| ----------------- | ------------------- | ----------------------------------------- |
| `workspaceKey`    | `string` (optional) | Workspace key                             |
| `memoriesDump`    | `string` (optional) | JSON dump of enabled memories             |
| `minMemoryCount`  | `number` (optional) | Minimum memory count threshold            |

**Self-research variables:**

| Variable   | Type                | Description                    |
| ---------- | ------------------- | ------------------------------ |
| `rssItems` | `string` (optional) | Formatted RSS items block      |

**Reminder variables:**

| Variable             | Type                | Description                          |
| -------------------- | ------------------- | ------------------------------------ |
| `reminderMessage`    | `string` (optional) | Reminder message content             |
| `reminderCreatedAt`  | `string` (optional) | Reminder creation timestamp          |
| `reminderScheduledAt`| `string` (optional) | Reminder scheduled delivery timestamp|

#### Scenario: Core variables available
- **GIVEN** a normal message session
- **WHEN** the template is rendered
- **THEN** `isDm`, `platform`, `userId`, `channelId`, `guildId`, and `userContextMessage` SHALL be available

#### Scenario: Spontaneous-specific variables
- **GIVEN** a spontaneous post session
- **WHEN** the template is rendered
- **THEN** `recentMessagesFetched`, `importantMemories`, `recentMessages`, and `availableEmojis` SHALL be available
