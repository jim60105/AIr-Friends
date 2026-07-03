## MODIFIED Requirements

### Requirement: Edit-Reply Platform Behavior

`edit-reply` SHALL only operate on the current session's own most-recently-sent message: the handler SHALL reject the request when `params.messageId` does not equal `context.lastSentMessageId`. Subject to that scoping, `edit-reply` SHALL behave differently depending on the platform:

- **Discord**: SHALL use native `platformAdapter.editMessage()` to edit the message in-place.
- **Misskey Notes** (`note:` channel prefix): SHALL use a delete-and-recreate strategy — delete the old note via `notes/delete`, then create a new note via `notes/create` with the original trigger note's `replyId` to preserve threading. The returned `messageId` will differ from the original. Visibility and `visibleUserIds` SHALL be preserved.
- **Misskey Chat** (`chat:` channel prefix): SHALL use a delete-and-recreate strategy via `chat/messages/delete` followed by `chat/messages/create-to-user`.

If the delete step fails, the system SHALL abort without creating a new message and SHALL return an error.

#### Scenario: Edit-reply on foreign message rejected
- **GIVEN** a session whose `context.lastSentMessageId` is `msg-A`
- **WHEN** `edit-reply` is called with `messageId` equal to `msg-B` (a message from another conversation)
- **THEN** the handler SHALL reject the request with an error and SHALL NOT delete or edit any message

#### Scenario: Discord edit-reply
- **GIVEN** a reply was sent in a Discord channel and it is the session's last-sent message
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL call `platformAdapter.editMessage()` to edit in-place

#### Scenario: Misskey note edit-reply
- **GIVEN** a reply was sent as a Misskey note and it is the session's last-sent message
- **WHEN** `edit-reply` is called with the matching `messageId`
- **THEN** the system SHALL delete the old note and create a new note with the original `replyId`
- **AND** if the delete fails, the system SHALL NOT create a new note

#### Scenario: Successive Misskey edits in one session
- **GIVEN** a Misskey note reply was edited once, producing a new note ID (delete-and-recreate)
- **WHEN** `edit-reply` is called again in the same session with the new note ID
- **THEN** the session's tracked `lastSentMessageId` SHALL have been updated to that new ID after the first edit, so the second edit's scoping check SHALL pass and the edit SHALL proceed
