# Skills and Reply

## Purpose

Defines the shell-based skill execution architecture, Skill API HTTP server, session authentication, available skills, reply rules, retry mechanism, edit-reply behavior, and content processing (XML stripping, newline unescaping).

## Requirements

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as Deno TypeScript scripts located in `skills/{skill-name}/scripts/` directories. Each skill SHALL have a `SKILL.md` file describing its usage for the agent. External ACP Agents SHALL execute these scripts with a `--session-id` parameter. Scripts SHALL use the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP.

#### Scenario: Agent executes a skill script
- **GIVEN** an ACP Agent decides to use the `memory-save` skill
- **WHEN** the agent executes the script
- **THEN** the script SHALL receive `--session-id` as a parameter
- **AND** the script SHALL call the Skill API HTTP endpoint to perform the operation

### Requirement: Skill API HTTP Server

The system SHALL run an HTTP server (configurable host/port, typically `localhost:3001`) that exposes skill endpoints at `POST /api/skill/{skill-name}`. The server SHALL only accept POST requests (returning appropriate errors for other methods). OPTIONS requests SHALL return 204 for CORS preflight. The server SHALL implement a 1-second TTL request cache for deduplication of concurrent duplicate requests.

#### Scenario: Valid skill API call
- **GIVEN** an active session with ID `sess_abc_123`
- **WHEN** a POST request is sent to `/api/skill/memory-save` with `{ "sessionId": "sess_abc_123", "parameters": { ... } }`
- **THEN** the server SHALL authenticate the session, execute the skill handler, and return the result

#### Scenario: Invalid session rejected
- **GIVEN** an expired or non-existent session ID
- **WHEN** a skill API request is made with that session ID
- **THEN** the server SHALL return HTTP 401

### Requirement: Session-Based Authentication

The system SHALL authenticate all skill API requests via session ID. Session IDs SHALL follow the format `sess_{timestamp}_{UUID}` with 64+ bits of entropy. Sessions SHALL expire based on a configurable `timeoutMs`. The session registry SHALL check expiration on every `get()` call and run periodic cleanup every 60 seconds. Each API call SHALL refresh the session's `lastActivityAt` via `touch()`.

#### Scenario: Session expiration
- **GIVEN** a session that has been inactive beyond `timeoutMs`
- **WHEN** a skill API request is made with that session ID
- **THEN** the session registry SHALL return `undefined` and the server SHALL return 401

### Requirement: Available Skills

The system SHALL register the following skills via `SkillRegistry`:

| Skill             | Handler              | Description                     |
| ----------------- | -------------------- | ------------------------------- |
| `memory-save`     | MemoryHandler        | Save a new memory               |
| `memory-search`   | MemoryHandler        | Search existing memories        |
| `memory-patch`    | MemoryHandler        | Update memory attributes        |
| `memory-stats`    | MemoryHandler        | Get memory statistics           |
| `memory-export`   | MemoryHandler        | Export memories as file          |
| `send-reply`      | ReplyHandler         | Send a reply message            |
| `edit-reply`      | ReplyHandler         | Edit a previously sent reply    |
| `get-message`     | ReplyHandler         | Get a message by ID             |
| `fetch-context`   | ContextHandler       | Fetch additional platform data  |
| `react-message`   | ReactionHandler      | Add emoji reaction to a message |

The following skills SHALL be registered conditionally based on configuration:

| Skill              | Condition                         |
| ------------------ | --------------------------------- |
| `set-reminder`     | `remindersConfig?.enabled && reminderStore` |
| `cancel-reminder`  | Same as above                     |
| `list-reminders`   | Same as above                     |
| `send-file`        | `sendFileConfig?.enabled`         |

#### Scenario: Conditional skill not registered
- **GIVEN** reminders are not enabled in configuration
- **WHEN** the skill registry initializes
- **THEN** `set-reminder`, `cancel-reminder`, and `list-reminders` SHALL NOT be registered

### Requirement: Reply Rules

The system SHALL enforce the following reply limits per session:

- **`send-reply`**: Maximum 1 call per session (`MAX_REPLIES_PER_SESSION = 1`). Additional calls SHALL be rejected with HTTP 429 status and a message advising use of `edit-reply` instead.
- **Doom-loop detection**: If `send-reply` is attempted 4 or more times (`MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE = 4`), the system SHALL terminate the agent via `onTerminateRequest` callback.
- **`edit-reply`**: Requires a prior successful `send-reply` (`replySent = true`). If `edit-reply` is called 3 or more times (`MAX_EDIT_CALLS_BEFORE_TERMINATE = 3`), the system SHALL terminate the agent.
- **Minimum reply requirement**: At least one reply (via `send-reply`) or one reaction (via `react-message`) SHALL be produced per session. If neither occurs when the agent completes, the retry mechanism SHALL trigger.

#### Scenario: Second send-reply rejected
- **GIVEN** a session where `send-reply` has already been called once
- **WHEN** `send-reply` is called again
- **THEN** the server SHALL return HTTP 429 with an error message

#### Scenario: Doom-loop terminates agent
- **GIVEN** a session where `send-reply` has been attempted 4 times
- **WHEN** the 4th attempt is detected
- **THEN** the system SHALL invoke `onTerminateRequest` to terminate the agent process

#### Scenario: edit-reply before send-reply fails
- **GIVEN** a session where no reply has been sent yet
- **WHEN** `edit-reply` is called
- **THEN** the handler SHALL return an error "No reply has been sent yet"

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without having called `send-reply` or `react-message`. The retry SHALL clear the reply state, send a second prompt on the same ACP session requesting the agent to send a reply, and if the retry also fails, return a failure response.

#### Scenario: Successful retry produces reply
- **GIVEN** an agent completes without sending a reply or reaction
- **WHEN** the retry mechanism triggers
- **THEN** the system SHALL send a retry prompt on the same session
- **AND** if the agent calls `send-reply` during retry, the session SHALL succeed

#### Scenario: Failed retry returns error
- **GIVEN** an agent completes without a reply and the retry also fails
- **WHEN** the retry prompt completes without a `send-reply` call
- **THEN** the system SHALL return a failure response indicating the agent did not produce a reply

### Requirement: Edit-Reply Platform Behavior

`edit-reply` SHALL behave differently depending on the platform:

- **Discord**: SHALL use native `platformAdapter.editMessage()` to edit the message in-place.
- **Misskey Notes** (`note:` channel prefix): SHALL use a delete-and-recreate strategy — delete the old note via `notes/delete`, then create a new note via `notes/create` with the original trigger note's `replyId` to preserve threading. The returned `messageId` will differ from the original. Visibility and `visibleUserIds` SHALL be preserved.
- **Misskey Chat** (`chat:` channel prefix): SHALL use a delete-and-recreate strategy via `chat/messages/delete` followed by `chat/messages/create-to-user`.

If the delete step fails, the system SHALL abort without creating a new message and SHALL return an error.

#### Scenario: Discord edit-reply
- **GIVEN** a reply was sent in a Discord channel
- **WHEN** `edit-reply` is called with the `messageId`
- **THEN** the system SHALL call `platformAdapter.editMessage()` to edit in-place

#### Scenario: Misskey note edit-reply
- **GIVEN** a reply was sent as a Misskey note
- **WHEN** `edit-reply` is called
- **THEN** the system SHALL delete the old note and create a new note with the original `replyId`
- **AND** if the delete fails, the system SHALL NOT create a new note

### Requirement: XML Tag Stripping

The system SHALL strip XML-like tags from reply content before sending to platforms using the regex `/<\/?[a-zA-Z][a-zA-Z0-9_]*>/g`. Inner text between tags SHALL be preserved. This SHALL apply to both `send-reply` and `edit-reply`.

#### Scenario: XML tags removed from reply
- **GIVEN** a reply message contains `<e>😆</e>`
- **WHEN** `stripXmlTags()` is applied
- **THEN** the result SHALL be `😆`

### Requirement: Literal Newline Unescaping

The system SHALL convert literal `\n` sequences (2 characters: backslash + n) to actual newline characters in reply content via `unescapeNewlines()`. This SHALL apply to both `send-reply` and `edit-reply`, after XML tag stripping.

#### Scenario: Literal backslash-n converted
- **GIVEN** a reply message contains the literal string `Hello\nWorld`
- **WHEN** `unescapeNewlines()` is applied
- **THEN** the result SHALL contain an actual newline between `Hello` and `World`

### Requirement: Reaction Handling

The `react-message` skill SHALL add an emoji reaction to the trigger message. It SHALL require a non-empty `emoji` parameter and a valid `context.replyToMessageId` (the trigger message). The system SHALL track reactions per workspace:channel combination via `reactionSentMap` to prevent duplicate reactions.

#### Scenario: Reaction added to trigger message
- **GIVEN** a session triggered by a message
- **WHEN** `react-message` is called with `emoji = "👍"`
- **THEN** the system SHALL call `platformAdapter.addReaction()` on the trigger message

#### Scenario: No trigger message for reaction
- **GIVEN** a session without a `replyToMessageId` (e.g., spontaneous post)
- **WHEN** `react-message` is called
- **THEN** the handler SHALL return an error indicating no trigger message exists

### Requirement: Send-File Workspace Boundary

The `send-file` skill SHALL validate that requested file paths are within the user's workspace or the agent workspace (if available). Path traversal (`..`) SHALL be blocked. Files exceeding `config.maxFileSizeMb` (default: 25 MB) SHALL be rejected. Only files with extensions in `config.allowedExtensions` SHALL be permitted. File read failures SHALL return an error without crashing.

#### Scenario: Path traversal blocked
- **GIVEN** a `send-file` request with path `../../etc/passwd`
- **WHEN** `validateFilePath()` is called
- **THEN** the system SHALL throw a `SkillError` with code `SKILL_INVALID_PARAMS`

#### Scenario: File within workspace allowed
- **GIVEN** a `send-file` request for a file within the workspace boundary
- **WHEN** `validateFilePath()` is called
- **THEN** the validation SHALL pass and the file SHALL be sent
