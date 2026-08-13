# Skills and Reply (Delta)

## ADDED Requirements

### Requirement: Reply Threading Anchor and Message ID Roles

The system SHALL distinguish four message-ID roles per session so no tool can confuse the ID of a message the bot sent with the ID of the message being replied to:

- **`lastSentMessageId`** — the ID of the last message sent via `send-reply` or `edit-reply`. It SHALL be updated ONLY by those two skills (the Skill API server refreshes it after each successful call, including Misskey's delete-and-recreate new ID). It is consumed by `edit-reply` scoping and by the `get-message` fallback. A message delivered by `send-file` SHALL NEVER be recorded here.
- **`lastFileMessageId`** — the ID of the last message delivered by `send-file`. It SHALL be updated ONLY by `send-file`, and ONLY when at least one file was delivered (on Misskey chat partial delivery it SHALL be the last *delivered* message ID). It is consumed as the reply threading anchor and by the `get-message` fallback.
- **`lastReplyAnchorMessageId`** — the message ID that the last text reply was created as a reply to (the reply anchor in effect when `send-reply` succeeded). It SHALL be recorded ONLY on a successful `send-reply` and SHALL NOT be changed by `edit-reply`. Misskey `edit-reply` re-creation SHALL thread to this recorded anchor, so editing a reply never rewrites its original thread parent.
- **`triggerMessageId`** — the ID of the message that triggered the session (empty for triggerless sessions). It is the fallback reply anchor and the target of `react-message`.

The session's **reply anchor** SHALL resolve to `lastFileMessageId ?? triggerMessageId`. `send-reply` SHALL thread its message to the reply anchor. Misskey `edit-reply` re-creation SHALL thread to `lastReplyAnchorMessageId` (falling back to the reply anchor when unset). `send-file` SHALL thread to the trigger message (its delivered ID is only recorded after the call succeeds, and only one `send-file` call per session is permitted, so the anchor is always the trigger when `send-file` runs). `react-message` SHALL target `triggerMessageId`, never the bot's own file message.

The `get-message` skill SHALL resolve its target message as `params.messageId`, falling back to `lastSentMessageId`, then `lastFileMessageId`, and SHALL return an error when none exists.

#### Scenario: Send-reply after file send threads to the file message
- **GIVEN** a session that delivered files via `send-file` (so `lastFileMessageId` is `file-note-1`) and has a trigger message `trigger-1`
- **WHEN** `send-reply` is called
- **THEN** the reply SHALL be threaded to `file-note-1`, not to `trigger-1`
- **AND** `lastReplyAnchorMessageId` SHALL be recorded as `file-note-1`

#### Scenario: Send-reply before file send threads to the trigger message
- **GIVEN** a session that sent a reply first and delivers files afterwards
- **WHEN** `send-reply` was called before the file send
- **THEN** the reply SHALL be threaded to the trigger message (the anchor was still the trigger at call time)
- **AND** `lastReplyAnchorMessageId` SHALL be recorded as the trigger message
- **AND** the subsequent `send-file` SHALL also be threaded to the trigger message

#### Scenario: Failed file send leaves the anchor on the trigger
- **GIVEN** a session where a `send-file` call failed with no delivered messages
- **WHEN** `send-reply` is called afterwards
- **THEN** the reply SHALL be threaded to the trigger message
- **AND** no `lastFileMessageId` SHALL be recorded

#### Scenario: File send does not pollute the edit scope
- **GIVEN** a session that delivered files (so `lastFileMessageId` is `file-1`) and then sent a reply (so `lastSentMessageId` is `reply-1`)
- **WHEN** the session state is inspected
- **THEN** `lastSentMessageId` SHALL be `reply-1` and SHALL NOT be `file-1`

#### Scenario: Get-message fallback covers the file message
- **GIVEN** a session that delivered files via `send-file` but sent no text reply
- **WHEN** `get-message` is called without a `messageId` parameter
- **THEN** the skill SHALL fetch the message identified by `lastFileMessageId`

## MODIFIED Requirements

### Requirement: Edit-Reply Platform Behavior

`edit-reply` SHALL only operate on the current session's own most-recently-sent **text reply** message: the handler SHALL reject the request when `params.messageId` does not equal `context.lastSentMessageId`. Because `send-file` records its delivered message ID in `lastFileMessageId` and NEVER in `lastSentMessageId`, file-message IDs SHALL NEVER be editable: any attempt to pass a `send-file` message ID to `edit-reply` SHALL be rejected by the same scoping check and SHALL NOT delete or edit the file message. Subject to that scoping, `edit-reply` SHALL behave differently depending on the platform:

- **Discord**: SHALL use native `platformAdapter.editMessage()` to edit the message in-place.
- **Misskey Notes** (`note:` channel prefix): SHALL use a delete-and-recreate strategy — delete the old note via `notes/delete`, then create a new note via `notes/create` with the message the edited reply was originally created as a reply to (`context.lastReplyAnchorMessageId`, falling back to the reply anchor) as `replyId` to preserve the reply's original thread parent. The returned `messageId` will differ from the original. Visibility and `visibleUserIds` SHALL be preserved.
- **Misskey Chat** (`chat:` channel prefix): SHALL use a delete-and-recreate strategy via `chat/messages/delete` followed by `chat/messages/create-to-user`.

If the delete step fails, the system SHALL abort without creating a new message and SHALL return an error.

#### Scenario: Edit-reply on foreign message rejected
- **GIVEN** a session whose `context.lastSentMessageId` is `msg-A`
- **WHEN** `edit-reply` is called with `messageId` equal to `msg-B` (a message from another conversation)
- **THEN** the handler SHALL reject the request with an error and SHALL NOT delete or edit any message

#### Scenario: Edit-reply on a file message rejected
- **GIVEN** a session that delivered files (so `context.lastFileMessageId` is `file-1`) and sent a reply (so `context.lastSentMessageId` is `reply-1`)
- **WHEN** `edit-reply` is called with `messageId` equal to `file-1`
- **THEN** the handler SHALL reject the request with an error
- **AND** the file message SHALL NOT be deleted or edited

#### Scenario: Discord edit-reply
- **GIVEN** a reply was sent in a Discord channel and it is the session's last-sent message
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL call `platformAdapter.editMessage()` to edit in-place

#### Scenario: Misskey note edit-reply
- **GIVEN** a reply was sent as a Misskey note and it is the session's last-sent message
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL delete the old note and create a new note with the reply anchor as `replyId`
- **AND** if the delete fails, the system SHALL NOT create a new note

#### Scenario: Misskey note edit after a file send re-threads to the file note
- **GIVEN** a Misskey note session that sent a file note (so `context.lastFileMessageId` is `file-note-1`) and then a text reply threaded to it (so `context.lastReplyAnchorMessageId` is `file-note-1`)
- **WHEN** `edit-reply` is called on the text reply
- **THEN** the recreated note SHALL be threaded to `file-note-1` (the anchor recorded when the reply was created), preserving the conversation thread

#### Scenario: Editing a reply sent before the file send keeps its original thread parent
- **GIVEN** a Misskey note session where a text reply was sent first, threaded to the trigger (so `context.lastReplyAnchorMessageId` is `trigger-1`), and a file note was delivered afterwards (so `context.lastFileMessageId` is `file-note-1`)
- **WHEN** `edit-reply` is called on the text reply
- **THEN** the recreated note SHALL be threaded to `trigger-1`, NOT to `file-note-1` — the edit SHALL NOT rewrite the reply's original thread topology

#### Scenario: Successive Misskey edits in one session
- **GIVEN** a Misskey note reply was edited once, producing a new note ID (delete-and-recreate)
- **WHEN** `edit-reply` is called again in the same session with the new note ID
- **THEN** the session's tracked `lastSentMessageId` SHALL have been updated to that new ID after the first edit, so the second edit's scoping check SHALL pass and the edit SHALL proceed

### Requirement: Reaction Handling

The `react-message` skill SHALL add an emoji reaction to the message that triggered the session (`context.triggerMessageId`), even when the bot has since sent its own messages (e.g. a file message): a reaction SHALL NEVER target a message the bot itself sent. It SHALL require a non-empty `emoji` parameter and a valid `context.triggerMessageId` (the trigger message). The system SHALL track reactions per workspace:channel combination via `reactionSentMap` to prevent duplicate reactions.

#### Scenario: Reaction added to trigger message
- **GIVEN** a session triggered by a message
- **WHEN** `react-message` is called with `emoji = "👍"`
- **THEN** the system SHALL call `platformAdapter.addReaction()` on the trigger message

#### Scenario: Reaction after a file send still targets the trigger message
- **GIVEN** a session that delivered files via `send-file` and has a trigger message `trigger-1`
- **WHEN** `react-message` is called
- **THEN** the reaction SHALL be added to `trigger-1`
- **AND** SHALL NOT be added to the bot's own file message

#### Scenario: No trigger message for reaction
- **GIVEN** a session without a `triggerMessageId` (e.g., spontaneous post)
- **WHEN** `react-message` is called
- **THEN** the handler SHALL return an error indicating no trigger message exists

### Requirement: Send-File Response Tracking

The system SHALL track successful `send-file` calls as session responses, mirroring reply and reaction tracking. The file-sent state SHALL be session-scoped: `SessionRegistry` SHALL maintain a per-session `fileSent` flag (initialized `false` at registration, alongside the existing `replySent` flag) with `markFileSent(sessionId)` and `hasFileSent(sessionId)` operations. The Skill API server SHALL call `markFileSent()` when at least one file was delivered to the platform (including partial Misskey chat delivery); it SHALL NOT be marked on total failure. When at least one file was delivered, the Skill API server SHALL ALSO record the last delivered message ID as the session's `lastFileMessageId` via `setLastFileMessageId()`, resolving it from the result data as `messageId`, else the last entry of `messageIds`; if the result carries no usable message ID at all, the server SHALL log a warning and record nothing (the reply anchor stays on the trigger — it SHALL NOT record a bogus ID). On total failure it SHALL NOT record any ID. `lastFileMessageId` SHALL NEVER be written by `send-reply`, `edit-reply`, or any other skill, and `lastSentMessageId` SHALL NEVER be written by `send-file` — the ID roles stay strictly separate. The session orchestrator SHALL read `hasFileSent(sessionId)` (a missing/expired session SHALL be treated as `fileSent: false`) and SHALL consider the agent to have responded when `replySent || reactionSent || fileSent` is true. Because the state lives on the session record, it is inherently cleared when a session ends and can never leak across concurrent sessions on the same channel. The `SessionResponse` SHALL include a `fileSent` boolean, set to `false` explicitly in every flow that does not track file sends. Error-message dispatch SHALL be skipped when `fileSent` is true.

#### Scenario: File send counts as a response
- **GIVEN** a session where the agent called `send-file` successfully but neither `send-reply` nor `react-message`
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** the session SHALL be treated as successful without retrying

#### Scenario: File send records the delivered message ID
- **GIVEN** a session where `send-file` delivered a single message `file-1`
- **WHEN** the Skill API server processes the successful result
- **THEN** `lastFileMessageId` SHALL be set to `file-1`
- **AND** `lastSentMessageId` SHALL remain unset

#### Scenario: Partial file delivery counts as a response and records the last delivered ID
- **GIVEN** a Misskey chat session where 2 of 3 files were delivered (message IDs `file-1`, `file-2`) before a mid-batch failure
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** `lastFileMessageId` SHALL be `file-2` (the last delivered message)
- **AND** the missing-response retry SHALL NOT trigger

#### Scenario: Total failure records no file ID
- **GIVEN** a session where a `send-file` call fails with no delivered messages
- **WHEN** the Skill API server processes the failed result
- **THEN** `fileSent` SHALL NOT be marked
- **AND** `lastFileMessageId` SHALL NOT be set

#### Scenario: Delivery without a usable message ID records no anchor
- **GIVEN** a `send-file` result that reports delivered files but carries neither `messageId` nor a usable `messageIds` entry
- **WHEN** the Skill API server processes the result
- **THEN** `fileSent` SHALL be marked (files were delivered)
- **AND** `lastFileMessageId` SHALL NOT be set
- **AND** a warning SHALL be logged

#### Scenario: File-send state is per-session
- **GIVEN** two consecutive sessions for the same workspace:channel, the first delivering a file
- **WHEN** the second session's agent completes without any response
- **THEN** the second session SHALL NOT inherit the first session's `fileSent` state or `lastFileMessageId`
- **AND** the missing-response retry SHALL trigger for the second session

#### Scenario: File-send disabled yields false
- **GIVEN** the `send-file` skill is disabled in configuration
- **WHEN** the orchestrator evaluates the session response
- **THEN** `fileSent` SHALL be `false` (the Skill API server never marks it because the skill is not registered)

#### Scenario: Error dispatch skipped after file send
- **GIVEN** a session that ends with `success: false` but `fileSent: true`
- **WHEN** the reply dispatcher evaluates the response
- **THEN** no error message SHALL be dispatched to the platform
