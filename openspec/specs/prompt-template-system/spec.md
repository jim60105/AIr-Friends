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

The system SHALL support the Vento template syntax, including variable output, `{{ include "file.md" }}` directives, conditionals, `set` assignments, comments, and whitespace-trim markers. The final rendered output SHALL be trimmed of leading and trailing whitespace via `result.content.trim()`.

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

#### Scenario: Set assignment
- **GIVEN** a template containing `{{ set name }}...{{ /set }}`
- **WHEN** the template is rendered
- **THEN** `name` SHALL be assigned the enclosed content as a local variable

#### Scenario: Whitespace trimming
- **GIVEN** a template containing `{{- ... -}}`
- **WHEN** the template is rendered
- **THEN** the surrounding whitespace SHALL be trimmed from the enclosed syntax

#### Scenario: Comment exclusion
- **GIVEN** a template containing `{{# comment #}}`
- **WHEN** the template is rendered
- **THEN** the comment SHALL be excluded from the output

#### Scenario: Output trimming
- **GIVEN** the prompted template has been fully rendered
- **WHEN** `result.content.trim()` is applied
- **THEN** leading and trailing whitespace SHALL be removed from the final rendered output

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

### Requirement: Skill-Instructing Templates Receive the Trusted Script Root

Every skill-instructing session SHALL deliver its selected agent's resolved absolute trusted skill-script root literally in the final prompt. Bundled and retry recipes SHALL quote complete executable paths and payload arguments alongside the existing literal session-id and staging values. Missing required root data or omission from a classified delivered prompt SHALL fail explicitly before delivery, without child-HOME, shell-token or another-session fallback.

#### Scenario: Agent-specific roots render without process HOME
- **WHEN** an OpenCode session and an OMP session render a skill-instructing template
- **THEN** each SHALL receive its selected trusted root and render an executable absolute recipe
- **AND** OMP's isolated HOME SHALL NOT be used to derive that path

#### Scenario: Missing root is not silently substituted
- **WHEN** a skill-instructing render or retry lacks the required trusted root
- **THEN** it SHALL fail explicitly before sending incomplete instructions
- **AND** it SHALL NOT fall back to a shell HOME expression or another session's root

#### Scenario: All skill-instructing session paths deliver the literal root
- **WHEN** normal/lurk reply, spontaneous, self research, summary, user maintenance, channel maintenance or scheduled reminder instructions are delivered
- **THEN** the actual final text from the selected bundled template SHALL contain that session's resolved literal absolute root
- **AND** session-id, exact staging and allowed-skill scope SHALL remain correct for that delivery path

#### Scenario: Correction retry uses the same selected root
- **WHEN** an existing missing-response or correction retry contains skill invocation instructions
- **THEN** it SHALL render the same selected root, id and staging as the session's initial prompt
- **AND** all executable and payload-file recipe arguments SHALL preserve their literal spelling

#### Scenario: Paths with spaces and shell characters remain literal
- **WHEN** the trusted root or staging contains spaces, apostrophes, dollar signs or backticks
- **THEN** each recipe SHALL quote its complete executable and payload-file arguments so those characters remain part of the argument
- **AND** recipe text SHALL NOT place free-text message, memory, query or caption content on the command line

#### Scenario: Mounted classified template omits its root
- **WHEN** a configured skill-instructing template renders without the required literal trusted root, or the root is empty or relative
- **THEN** the render/session boundary SHALL raise an explicit bounded configuration failure before prompt delivery
- **AND** it SHALL NOT send blank, unresolved or alternate-root instructions

#### Scenario: Generic and dashboard rendering do not acquire skills
- **WHEN** a generic non-skill render or dashboard web-chat prompt is produced
- **THEN** no new skills-root requirement or skill invocation recipe SHALL be imposed on the generic render
- **AND** web-chat's existing skill prohibition SHALL remain unchanged

### Requirement: Information Gathering Follows a Concrete Context Need

Bundled reply instructions SHALL permit a reply using adequate supplied context without additional information gathering. They SHALL require targeted retrieval when relevant history is missing or the user explicitly requests recall. They SHALL NOT require a memory search, workspace read or browser visit before every reply, and SHALL preserve the session's required delivery mechanism.

#### Scenario: Adequate context for a greeting
- **GIVEN** the supplied user context and recent messages suffice for a greeting
- **WHEN** normal or channel-lurk reply instructions are rendered
- **THEN** they SHALL permit an in-character reply without additional retrieval
- **AND** they SHALL still require the delivery skill for an external text reply
- **AND** this permission SHALL depend on context sufficiency rather than a hard-coded greeting string

#### Scenario: Missing history requires recall
- **GIVEN** the question needs history absent from supplied context, or explicitly requests recall
- **WHEN** reply instructions are rendered
- **THEN** they SHALL direct targeted memory search and permit the existing category/scope filters
- **AND** workspace or browser gathering SHALL be tied to information relevant to that request

#### Scenario: A single owning retrieval rule
- **WHEN** the bundled reply instructions are rendered for OpenCode or OMP in restricted or YOLO mode
- **THEN** the memory-retrieval section SHALL own the context-sufficiency rule once
- **AND** no later critical rule SHALL impose unconditional information gathering
- **AND** existing character, memory-correction and memory-saving guidance SHALL remain available

### Requirement: Conversational Templates Do Not Require Reasoning Narration

Bundled reply, spontaneous-post and dashboard-chat instructions SHALL NOT require think-out-loud narration or a narrated thought process before replies or tools. They SHALL preserve character voice and session-specific work. Dashboard chat SHALL retain direct text output and its skill prohibition.

#### Scenario: Reply review without compulsory narration
- **WHEN** the reply template is rendered
- **THEN** it SHALL retain an instruction to review the reply before delivery without requiring narration
- **AND** it SHALL NOT require a reasoning transcript before tool use

#### Scenario: Spontaneous posting retains its purpose
- **WHEN** the spontaneous-post template is rendered
- **THEN** it SHALL retain topic selection and character-authored posting instructions
- **AND** it SHALL NOT require narrating how the post was designed

#### Scenario: Dashboard chat remains skill-free
- **WHEN** dashboard-chat instructions are rendered
- **THEN** they SHALL require an in-character direct response without compulsory reasoning narration
- **AND** they SHALL NOT acquire memory-search, reply-skill or other external-delivery requirements

### Requirement: Permission Guidance Matches The Session Engine And Mode

Bundled initial and corrective instructions SHALL scope permission claims to the selected engine and effective session mode. Restricted guidance SHALL retain applicable command/path constraints. YOLO guidance SHALL NOT state restricted shell-operator or command denials as universal facts. Operational recommendations SHALL be distinguishable from enforced restrictions.

#### Scenario: Restricted OpenCode retains its real restrictions
- **WHEN** bundled capability and browser instructions are rendered for restricted OpenCode
- **THEN** they SHALL retain the restricted command allowlist, OpenCode-specific pre-gate denials and per-segment chaining rule
- **AND** they SHALL distinguish tolerated standard-stream fd redirects from prohibited file redirects, pipes, backgrounding and newline separators
- **AND** an allowed `||` chain SHALL NOT be described as impossible merely because it uses `||`

#### Scenario: Restricted OMP receives shared policy without false attribution
- **WHEN** the same bundled instructions are rendered for restricted OMP
- **THEN** applicable shared command/operator/path restrictions and native OMP tool-use guidance SHALL remain present
- **AND** the instructions SHALL NOT describe OpenCode as the engine enforcing that session's upstream tool policy

#### Scenario: YOLO does not inherit restricted shell claims
- **WHEN** bundled reply, spontaneous or self-research browser/capability instructions are rendered for YOLO OpenCode or native-YOLO OMP
- **THEN** they SHALL NOT claim pipes, file redirects or named restricted-mode commands are always denied
- **AND** they SHALL NOT claim all operations or filesystem paths are permitted
- **AND** OMP guidance SHALL retain the native LSP denial and service/background tool semantics

#### Scenario: Stdout handling is a recommendation
- **WHEN** OMP shell-use instructions recommend reading stdout and exit status from the tool result
- **THEN** the recommendation SHALL NOT assert shell redirection is prohibited in native-YOLO
- **AND** the one-shot command advice and background-completion handling SHALL remain available

#### Scenario: Restricted writes are described conditionally
- **WHEN** restricted capability guidance is rendered with shared-workspace write authorization true or false
- **THEN** it SHALL describe staging writes and shared-workspace writes consistently with those flags and existing extension policy
- **AND** it SHALL NOT label every restricted operation as read-only or grant unauthorized shared writes

#### Scenario: Existing delivery and browser contracts survive
- **WHEN** any affected session prompt or correction is rendered
- **THEN** literal skill-root/session/staging recipes, allowed-skill scope, browser close instructions and the 403/429 browser fallback SHALL retain their existing meaning
- **AND** operator-provided overrides SHALL remain unchanged

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
