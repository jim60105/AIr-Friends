## Why

When an agent answers a request by sending files via `send-file`, the delivered message ID is returned to the agent but never stored in session state, and a subsequent `send-reply` still threads to the original trigger message. On platforms where threading matters (Misskey notes, Discord reply threading), the reply lands next to the user's trigger while the file message sits between them — the conversation splits into two threads. The session state also conflates "message the bot sent" (`lastSentMessageId`) with "message being replied to" (`replyToMessageId`), which is exactly the ID confusion that lets edit tools target the wrong message.

## What Changes

- **File message ID is stored.** After a `send-file` call delivers at least one message, the Skill API server stores the last delivered message ID on the session record in a NEW field `lastFileMessageId`, kept strictly separate from `lastSentMessageId`. The send-file result contract (which already returns `messageId` / `messageIds` to the agent) is unchanged.
- **Subsequent send-reply threads to the file message.** The session's reply anchor becomes `lastFileMessageId ?? triggerEvent.messageId`: once files have been sent, a later `send-reply` replies to the message the file tool just sent, keeping the conversation in one thread.
- **The two ID roles are explicitly distinguished.** `lastSentMessageId` remains the ID of the last message sent via `send-reply`/`edit-reply` ONLY — `send-file` never touches it — so `edit-reply`'s scoping check (`params.messageId === lastSentMessageId`) structurally rejects file-message IDs: the edit tool can only ever edit text-reply messages, never file messages. A new `triggerMessageId` context field carries the original trigger message so `react-message` keeps reacting to the user's message instead of accidentally targeting the bot's own file message.
- **Editing preserves the edited reply's original thread parent.** A new per-reply anchor (`lastReplyAnchorMessageId`) records which message each text reply was created as a reply to; Misskey `edit-reply` re-creation threads to that recorded anchor, never to the current anchor — so editing a reply sent *before* a file send keeps it under the trigger, and editing one sent *after* keeps it under the file message. Editing never rewrites an existing reply's thread topology.
- **`get-message` fallback covers file messages.** Without an explicit `messageId`, `get-message` falls back to `lastSentMessageId` then `lastFileMessageId`, so the agent can inspect the file message it just sent.
- **Audit records the stored IDs.** The `file_sent` audit entry gains the delivered `messageId` / `messageIds`.
- **Docs teach the contract.** `send-file` / `send-reply` / `edit-reply` SKILL.md files, `AGENTS.md`, and `docs/SKILLS_IMPLEMENTATION.md` document the threading behavior and the edit-scope boundary.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `skills-and-reply`:
  - ADDED "Reply Threading Anchor and Message ID Roles" — the four ID roles (`lastSentMessageId` reply-only, `lastFileMessageId` file-only, `lastReplyAnchorMessageId` per-reply parent, `triggerMessageId` trigger) and the anchor resolution `lastFileMessageId ?? triggerMessageId` used by reply threading; `get-message` fallback extends to `lastFileMessageId`.
  - "Edit-Reply Platform Behavior" — scoping stays bound to `lastSentMessageId`, so file-message IDs are never editable; Misskey re-creation threads to the anchor recorded when the edited reply was created (the file message when the reply followed a file send, otherwise the trigger), never the current anchor.
  - "Reaction Handling" — `react-message` SHALL target the original trigger message (new explicit `triggerMessageId`), even after a file send.
  - "Send-File Response Tracking" — on delivery, `send-file` records its last delivered message ID in `lastFileMessageId` (never `lastSentMessageId`); result contract unchanged.
- `session-audit-log`: `file_sent` phase data gains `messageId` and `messageIds`.

## Impact

- `src/skill-api/session-registry.ts` — `ActiveSession` gains `lastFileMessageId` and `lastReplyAnchorMessageId` with `setLastFileMessageId()` / `getLastFileMessageId()` and `setLastReplyAnchorMessageId()` / `getLastReplyAnchorMessageId()`.
- `src/skill-api/server.ts` — store the last delivered file message ID after a successful `send-file`; record the per-reply anchor (`replyToMessageId` value used) on `send-reply` success; resolve `replyToMessageId` as `lastFileMessageId ?? triggerEvent.messageId`; add `triggerMessageId`, `lastFileMessageId`, and `lastReplyAnchorMessageId` to the skill context; emit `messageId`/`messageIds` in the `file_sent` audit entry.
- `src/skills/types.ts` — `SkillContext` gains `triggerMessageId`, `lastFileMessageId`, and `lastReplyAnchorMessageId`; `lastSentMessageId` doc clarified to "last send-reply/edit-reply message only"; `replyToMessageId` doc clarified to "resolved reply anchor".
- `src/skills/reaction-handler.ts` — react to `context.triggerMessageId` instead of `context.replyToMessageId`.
- `src/skills/reply-handler.ts` — `get-message` fallback chain `messageId → lastSentMessageId → lastFileMessageId`; `edit-reply` passes `context.lastReplyAnchorMessageId ?? context.replyToMessageId` to `editMessage` (send-reply threading reads the resolved anchor; scoping check unchanged).
- `src/types/audit.ts` — `file_sent` data gains `messageId` / `messageIds`.
- `skills/send-file/SKILL.md`, `skills/send-reply/SKILL.md`, `skills/edit-reply/SKILL.md` — document result fields, reply threading after file send, and the edit-scope boundary.
- Docs: `AGENTS.md`, `docs/SKILLS_IMPLEMENTATION.md`.
- Tests: `tests/skill-api/session-registry.test.ts`, `tests/skill-api/server.test.ts` (storage + anchor resolution + per-reply anchor + audit), `tests/skills/reply-handler.test.ts` (get-message fallback, edit-reply anchor passthrough), `tests/skills/reaction-handler.test.ts` (trigger target), `tests/types/audit.test.ts`.
- No configuration changes; no migration needed (early-stage project, zero users).
