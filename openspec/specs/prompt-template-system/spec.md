# Prompt Template System

## Purpose

Customizable prompt rendering using the Vento template engine, enabling prompt modification without rebuilding containers by mounting override files.

## Requirements

### Requirement: Vento Template Engine

The system SHALL use the Vento template engine (`ventojs`) for rendering all prompt templates. The engine SHALL be configured with `autoescape: false`, `autoDataVarname: true`, and `dataVarname: "it"`. The `includes` path SHALL be set to the resolved absolute path of the prompts directory.

#### Scenario: Engine initialization
- **GIVEN** the prompts directory is `./prompts/`
- **WHEN** `createTemplateEngine()` is called
- **THEN** a Vento `Environment` SHALL be created with `includes` pointing to the absolute prompts directory

### Requirement: Template Processing Rules

The system SHALL support the following Vento template syntax:

| Syntax                              | Behavior                                              |
| ----------------------------------- | ----------------------------------------------------- |
| `{{ variableName }}`                | Output a template variable value                      |
| `{{ include "./filename.md" }}`     | Load and inline a file from the prompts directory     |
| `{{ if condition }}...{{ /if }}`    | Conditional rendering                                 |
| `{{ set name }}...{{ /set }}`       | Assign content to a local variable                    |
| `{{- ... -}}`                       | Trim surrounding whitespace                           |
| `{{# comment #}}`                   | Comment excluded from output                          |

The final rendered output SHALL be trimmed of leading and trailing whitespace via `result.content.trim()`.

#### Scenario: Variable interpolation
- **GIVEN** a template containing `{{ platform }}`
- **AND** the variable `platform` is `"discord"`
- **WHEN** the template is rendered
- **THEN** the output SHALL contain `discord`

#### Scenario: Include directive
- **GIVEN** a template containing `{{ include "./character_name.md" }}`
- **AND** `character_name.md` contains `Yuna`
- **WHEN** the template is rendered
- **THEN** the output SHALL contain `Yuna`

#### Scenario: Conditional rendering
- **GIVEN** a template containing `{{ if isDm }}private{{ /if }}`
- **AND** `isDm` is `true`
- **WHEN** the template is rendered
- **THEN** the output SHALL contain `private`

#### Scenario: Missing include
- **GIVEN** a template containing `{{ include "./nonexistent.md" }}`
- **WHEN** the template is rendered
- **THEN** a `ConfigError` SHALL be thrown with the missing file information

### Requirement: Template Rendering Functions

The system SHALL provide three rendering entry points:

1. **`createTemplateEngine(promptsDir)`** — Creates a Vento `Environment`
2. **`renderTemplate(env, templatePath, variables)`** — Renders a template file (path resolved to absolute)
3. **`renderTemplateString(env, templateContent, variables)`** — Renders an inline template string

Both `renderTemplate` and `renderTemplateString` SHALL throw a `ConfigError` with code `CONFIG_INVALID` on render failure.

#### Scenario: Render failure
- **GIVEN** a template contains invalid Vento syntax
- **WHEN** `renderTemplate()` is called
- **THEN** a `ConfigError` SHALL be thrown with the error message and template path

### Requirement: loadSystemPrompt Function

The `loadSystemPrompt(path, variables)` function SHALL verify the prompt file exists (throwing `ConfigError` with `CONFIG_NOT_FOUND` if missing), create a Vento engine pointing at the file's parent directory, and render the template with the provided variables.

#### Scenario: System prompt loaded
- **GIVEN** `system_reply.md` exists in the prompts directory
- **WHEN** `loadSystemPrompt("./prompts/system_reply.md", variables)` is called
- **THEN** the template SHALL be rendered with the provided `TemplateVariables`

#### Scenario: System prompt file missing
- **GIVEN** the prompt file does not exist
- **WHEN** `loadSystemPrompt()` is called
- **THEN** a `ConfigError` with code `CONFIG_NOT_FOUND` SHALL be thrown

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

### Requirement: Container Deployment

Default prompt files SHALL be bundled in the container at `/app/prompts/`. The container SHALL declare `/app/prompts` as a `VOLUME` for optional overrides. Users MAY mount individual prompt files to `/app/prompts/<filename>:ro` without rebuilding the container. Unmounted files SHALL retain their bundled defaults.

#### Scenario: Custom prompt override
- **GIVEN** a user mounts `./my-prompts/character_name.md` to `/app/prompts/character_name.md:ro`
- **WHEN** the template includes `{{ include "./character_name.md" }}`
- **THEN** the user-provided content SHALL be used instead of the bundled default

#### Scenario: Partial override
- **GIVEN** a user mounts only `character_name.md` and `character_info.md`
- **WHEN** the template includes other files (e.g., `agent_workspace.md`)
- **THEN** the bundled default versions SHALL be used for non-overridden files

### Requirement: Prompts Directory Structure

The system SHALL organize prompt templates in the `prompts/` directory. The main entry-point templates SHALL be selected based on session type. Fragment files MAY be included from the same directory using relative paths in `{{ include }}` directives.

#### Scenario: Session-type prompt selection
- **GIVEN** a normal message session
- **WHEN** the system prompt is loaded
- **THEN** the template at `agent.systemPromptPath` (default: `./prompts/system_reply.md`) SHALL be rendered
