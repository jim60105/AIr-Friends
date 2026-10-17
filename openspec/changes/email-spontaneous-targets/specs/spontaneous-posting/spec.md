# Spec Delta

## ADDED Requirements

### Requirement: Disabled opt-in targeting

Email spontaneous mail SHALL default disabled and target only explicitly opted-in currently permitted accounts.

#### Scenario: Allowlist changes
- **WHEN** a selected account is disabled before actual submission
- **THEN** the send is rejected and no third-party grant is used

### Requirement: New private spontaneous thread

Each email spontaneous activity SHALL begin a new owner-scoped thread without inheriting a previous reply anchor or destination grant.

#### Scenario: Consecutive ticks
- **WHEN** the same permitted opted-in account is selected twice
- **THEN** distinct internal/wire threads are used with no In-Reply-To header

### Requirement: Tick deduplication

Repeated calls or restart of one spontaneous tick SHALL consult durable send evidence and SHALL NOT duplicate submitted or uncertain mail.

#### Scenario: Tick resumes
- **WHEN** process restarts after SMTP outcome becomes unknown
- **THEN** that tick requires review and produces no replacement submission

## MODIFIED Requirements

### Requirement: Bot Workspace Key

Non-email spontaneous post sessions SHALL use the bot's own identity for workspace resolution. Email spontaneous sessions SHALL use the permitted selected target user's workspace.

#### Scenario: Workspace key
- **GIVEN** a spontaneous post session on platform `"discord"` with bot ID `"botId123"`
- **WHEN** the workspace key is generated
- **THEN** it SHALL be `"discord/botId123"` (using the bot's own user ID, not a real user)

---

#### Scenario: Email spontaneous tick boundary
- **WHEN** an email spontaneous tick runs
- **THEN** it SHALL use the opted-in target owner, create a new thread and grant no third-party destination
- **AND** repeated or uncertain sends in that tick SHALL use one durable logical operation without another SMTP submission


### Requirement: Prompt Template

Spontaneous post sessions SHALL use the `system_spontaneous.md` Vento template with specific template variables.

#### Scenario: Template variables
- **GIVEN** a spontaneous post session
- **WHEN** the prompt is rendered
- **THEN** the template SHALL receive variables including `recentMessagesFetched` (boolean), `importantMemories` (formatted text), `recentMessages` (formatted text), `availableEmojis` (formatted text), `sessionId`, `agentType`, `model`, `yolo`, `isDm` (`true` for email, otherwise `false`), `platform` (`"email"` for email, otherwise `"internal"`), `userId` (target identity for email, otherwise empty string), `channelId` (new owner-thread channel for email, otherwise empty string), and `guildId` (empty string)

#### Scenario: recentMessagesFetched flag
- **GIVEN** recent messages were fetched successfully
- **WHEN** the template renders
- **THEN** `recentMessagesFetched` SHALL be `true`, allowing the template to conditionally include recent message context

---

#### Scenario: Email spontaneous tick boundary
- **WHEN** an email spontaneous tick runs
- **THEN** it SHALL use the opted-in target owner, create a new thread and grant no third-party destination
- **AND** repeated or uncertain sends in that tick SHALL use one durable logical operation without another SMTP submission


### Requirement: Agent Execution and Reply

The spontaneous post session SHALL execute the full agent prompt flow with retry support.

#### Scenario: Agent prompt execution
- **GIVEN** assembled context and rendered prompt
- **WHEN** the session executes
- **THEN** it SHALL create an ACP connector, connect, create a session, set the model, send the prompt, and wait for the agent to call `send-reply`

#### Scenario: Multiple replies allowed
- **GIVEN** a non-email spontaneous post session
- **WHEN** the agent calls `send-reply` multiple times
- **THEN** each call SHALL send a separate message to the platform

#### Scenario: Retry on missing reply
- **GIVEN** the agent completes without calling `send-reply`
- **WHEN** `stopReason` is `"end_turn"` and retry threshold is not exceeded
- **THEN** it SHALL retry on the same ACP session with a retry prompt

---

#### Scenario: Email spontaneous tick boundary
- **WHEN** an email spontaneous tick runs
- **THEN** it SHALL use the opted-in target owner, create a new thread and grant no third-party destination
- **AND** repeated or uncertain sends in that tick SHALL use one durable logical operation without another SMTP submission
