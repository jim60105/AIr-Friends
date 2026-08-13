## 1. Session State

- [x] 1.1 Add `lastFileMessageId?: string` to `ActiveSession` in `src/skill-api/session-registry.ts` with JSDoc clarifying it is the last `send-file`-delivered message ID (reply anchor), distinct from `lastSentMessageId` (send-reply/edit-reply only)
- [x] 1.2 Add `setLastFileMessageId(sessionId, messageId)` and `getLastFileMessageId(sessionId)` methods on `SessionRegistry`
- [x] 1.3 Add `lastReplyAnchorMessageId?: string` to `ActiveSession` with JSDoc clarifying it is the reply anchor recorded when the last text reply was created (set only on `send-reply` success, never changed by `edit-reply`)
- [x] 1.4 Add `setLastReplyAnchorMessageId(sessionId, messageId)` and `getLastReplyAnchorMessageId(sessionId)` methods on `SessionRegistry`
- [x] 1.5 Clarify `lastSentMessageId` JSDoc in `ActiveSession` to state it is updated only by `send-reply`/`edit-reply` and never by `send-file`

## 2. Skill Context

- [x] 2.1 In `src/skills/types.ts`, add `triggerMessageId?: string` (original trigger message ID), `lastFileMessageId?: string`, and `lastReplyAnchorMessageId?: string` to `SkillContext`; clarify `lastSentMessageId` doc to "last send-reply/edit-reply message only" and `replyToMessageId` doc to "resolved reply anchor (`lastFileMessageId ?? triggerMessageId`)"
- [x] 2.2 In `src/skill-api/server.ts`, build the skill context with `triggerMessageId: session.triggerEvent?.messageId`, `lastFileMessageId: session.lastFileMessageId`, `lastReplyAnchorMessageId: session.lastReplyAnchorMessageId`, and resolve `replyToMessageId` as `session.lastFileMessageId ?? session.triggerEvent?.messageId` (capture the resolved value in a local so it can be recorded per-reply)

## 3. Send-File Tracking

- [x] 3.1 In `src/skill-api/server.ts`, after a `send-file` call with at least one delivered file (`filesCount > 0`), call `setLastFileMessageId()` with the last delivered message ID: `data.messageId`, else the last non-empty entry of `data.messageIds`; if neither exists, log a warning and record nothing
- [x] 3.2 Ensure the send-file success path never touches `setLastSentMessageId` (verify the existing code already scopes it to send-reply/edit-reply only)

## 4. Skill Handlers

- [x] 4.1 In `src/skills/reaction-handler.ts`, react to `context.triggerMessageId` instead of `context.replyToMessageId` (update the missing-trigger error check to use `triggerMessageId`)
- [x] 4.2 In `src/skills/reply-handler.ts`, extend `handleGetMessage` fallback to `params.messageId || context.lastSentMessageId || context.lastFileMessageId`
- [x] 4.3 In `src/skills/reply-handler.ts`, change `handleEditReply` to pass `context.lastReplyAnchorMessageId ?? context.replyToMessageId` to `platformAdapter.editMessage()` (preserves the edited reply's original thread parent); verify the `lastSentMessageId` scoping check itself needs no change

## 5. Audit

- [x] 5.1 In `src/types/audit.ts`, add `messageId?: string` and `messageIds?: string[]` to the `file_sent` section of `SessionAuditEntry.data`
- [x] 5.2 In `src/skill-api/server.ts`, include `messageId` and `messageIds` (from result data) in the `file_sent` audit entry, recorded verbatim regardless of `hashContent`

## 6. Skill Documentation

- [x] 6.1 Update `skills/send-file/SKILL.md`: document the result fields (`messageId`, `messageIds`, `filesCount`) and state that a later `send-reply` will be threaded to the file message
- [x] 6.2 Update `skills/send-reply/SKILL.md`: note that when files were sent earlier in the session, the reply is threaded to the file message
- [x] 6.3 Update `skills/edit-reply/SKILL.md`: state explicitly that only `send-reply` messages are editable and file messages never are, and that an edit keeps the reply's original thread position

## 7. Project Docs

- [x] 7.1 Update `AGENTS.md` send-file section: replace the "does NOT update `lastSentMessageId`" note with the `lastFileMessageId` / `lastReplyAnchorMessageId` + reply-anchor description
- [x] 7.2 Update `docs/SKILLS_IMPLEMENTATION.md` to match the new message-ID roles and threading behavior

## 8. Tests

- [x] 8.1 `tests/skill-api/session-registry.test.ts`: `setLastFileMessageId`/`getLastFileMessageId` and `setLastReplyAnchorMessageId`/`getLastReplyAnchorMessageId` round-trips and per-session isolation
- [x] 8.2 `tests/skill-api/server.test.ts`: send-file success stores `lastFileMessageId` (not `lastSentMessageId`); send-file total failure stores nothing; delivery without a usable message ID records no anchor; send-reply success records `lastReplyAnchorMessageId` (the anchor that call used); subsequent send-reply skill context resolves `replyToMessageId` to the file message; `triggerMessageId` present in context; `file_sent` audit entry includes `messageId`/`messageIds`
- [x] 8.3 `tests/skills/reply-handler.test.ts`: get-message falls back to `lastFileMessageId` when no `lastSentMessageId`; explicit `messageId` still wins; edit-reply passes `lastReplyAnchorMessageId` to `editMessage` and falls back to `replyToMessageId` when unset
- [x] 8.4 `tests/skills/reaction-handler.test.ts`: reaction targets `triggerMessageId` even when a file message was sent; no-trigger error unchanged
- [x] 8.5 `tests/skill-api/server.test.ts` (or orchestrator-level): ordering scenario reply → file → edit keeps the edited reply's anchor on the trigger (thread parent NOT rewritten to the file message)
- [x] 8.6 `tests/skill-api/server.test.ts`: Misskey chat partial delivery (2 of 3 delivered) records the last delivered ID as `lastFileMessageId` and a subsequent send-reply threads to it
- [x] 8.7 `tests/types/audit.test.ts`: `file_sent` data accepts `messageId`/`messageIds`

## 9. Verification

- [x] 9.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/`
- [x] 9.2 Run `deno check src/main.ts`
- [x] 9.3 Run `deno test` and confirm test coverage stays above 75%
