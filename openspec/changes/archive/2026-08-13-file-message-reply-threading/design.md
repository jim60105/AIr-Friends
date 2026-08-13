## Context

The bot's session state tracks two message IDs today:

- `lastSentMessageId` — set by the Skill API server after every successful `send-reply` and `edit-reply`; consumed by `edit-reply` for its scoping check (`params.messageId !== context.lastSentMessageId` → reject) and by `get-message` as a fallback. Its JSDoc claims it is "the last message ID sent by the bot in this session", which is now misleading.
- `replyToMessageId` — derived per skill call from `session.triggerEvent?.messageId` and threaded into every external send: `send-reply`, `send-file`, Misskey `edit-reply` re-creation, and `react-message`.

`send-file` (Feature: send-file response and multi-file) delivers externally visible messages but stores no message ID on the session: the result returns `messageId` / `messageIds` to the agent, yet nothing in the server records them. Consequently a `send-reply` after a file send threads to the original trigger message, splitting the conversation: on Misskey the file note and the reply note become siblings under the trigger; on Discord the reply references the trigger while the file message sits between them.

The change makes the file message the new conversation anchor for subsequent replies, and hardens the boundary between "message I sent" (edit scope) and "message being replied to" (threading anchor) so no tool can confuse the two.

## Goals / Non-Goals

**Goals:**

- Store the last `send-file`-delivered message ID on the session record, separate from `lastSentMessageId`.
- Make subsequent `send-reply` calls thread to the file message (when one was sent), else the trigger message.
- Keep `edit-reply` structurally unable to edit file messages: its scoping check stays bound to `lastSentMessageId`, which `send-file` never updates.
- Keep `react-message` targeting the user's trigger message (unchanged behavior) via an explicit `triggerMessageId`.
- Preserve each edited reply's original thread parent on Misskey re-creation via a per-reply anchor (`lastReplyAnchorMessageId`), so editing never rewrites conversation topology.
- Extend `get-message`'s no-arg fallback to cover the stored file message ID.
- Record the stored IDs in the `file_sent` audit entry.

**Non-Goals:**

- No changes to the `send-file` result contract returned to the agent (`messageId`, `messageIds`, `filesCount` already exist).
- No new config surface, no env vars, no metric changes.
- No changes to the retry / `hasResponded` logic (`fileSent` already covers file-only turns).
- No rename of the existing `lastSentMessageId` field (avoid churn across ~30 test sites; the semantic split is enforced by the new field and docs).
- No changes to `send-file` quota, doom-loop, payload-file, or preflight validation behavior.

## Decisions

### D1: New session fields `lastFileMessageId` and `lastReplyAnchorMessageId`, kept apart from `lastSentMessageId`

`ActiveSession` gains two fields with matching `SessionRegistry` accessors:

- `lastFileMessageId` — set ONLY when a `send-file` call delivered at least one message, storing the *last* delivered message ID (`result.data.messageId`, which the file handler already computes as `result.messageId ?? messageIds[last]` — for Misskey chat partial delivery this is the most recent delivered chat message, the correct anchor for a follow-up reply). If the result reports delivery without a usable message ID (defensive: `messageId` is optional in the result types), the server derives it from the last entry of `messageIds`; if neither exists it logs a warning and records nothing — the anchor silently stays on the trigger rather than pointing at a nonexistent message.
- `lastReplyAnchorMessageId` — set ONLY on a successful `send-reply`, storing the reply anchor that call was created with (the `replyToMessageId` value computed for that call's context: `lastFileMessageId ?? triggerEvent.messageId`). `edit-reply` consumes it (D2). It is NOT updated by `edit-reply` itself, because Misskey delete-and-recreate keeps the same thread parent.

Rationale: keeping the fields separate makes the `edit-reply` boundary *structural* rather than a runtime convention — the scoping check compares against `lastSentMessageId`, which no file-send code path ever writes. Alternatives considered: (a) letting `send-file` write `lastSentMessageId` — rejected: it would make file messages editable and break the documented "file messages are not `edit-reply`-able" contract; (b) renaming `lastSentMessageId` → `lastReplyMessageId` — rejected as churn with no behavioral gain (non-goal); (c) reading the edited message's own platform parent (Misskey `note.replyId`) at edit time instead of storing the anchor — rejected: it couples threading to platform API internals and loses the anchor when the note fetch fails; storing the anchor at creation is explicit, testable, and platform-agnostic.

### D2: Reply anchor resolution `lastFileMessageId ?? triggerEvent.messageId`, with per-reply anchors for edits

The server builds `skillContext.replyToMessageId` per call as `session.lastFileMessageId ?? session.triggerEvent?.messageId`. Ordering analysis:

- `send-file` before `send-reply` (the motivating flow): at `send-file` time `lastFileMessageId` is unset → the file message threads to the trigger; after success the setter runs → the subsequent `send-reply` threads to the file message, and `lastReplyAnchorMessageId` records the file message. ✓
- `send-reply` before `send-file`: reply threads to trigger; `send-file` threads to trigger (anchor still unset). The reply's `lastReplyAnchorMessageId` is the trigger. ✓
- `edit-reply` after either ordering: the recreated Misskey note threads to **`lastReplyAnchorMessageId`** — the anchor the edited reply was created with — NOT the current anchor. A reply sent before the file send keeps threading to the trigger; a reply sent after the file send keeps threading to the file message. Editing never rewrites an existing reply's thread parent. Defensive fallback: if `lastReplyAnchorMessageId` is unset (cannot happen after a successful send-reply, but guarded anyway), the current anchor is used.
- A second `send-file` is impossible (per-session quota), so the anchor never self-references.

"Subsequent" is defined as *a skill call initiated after the `send-file` call has returned* — the same temporal semantics as the agent's sequential tool loop; a hypothetical concurrent `send-reply` racing an in-flight `send-file` would use the pre-file anchor (the trigger), which is safe and consistent with the ordering analysis.

### D3: New context field `triggerMessageId` keeps `react-message` on the trigger

`SkillContext` gains `triggerMessageId` (the original `triggerEvent.messageId`), and `ReactionHandler` reacts to `context.triggerMessageId` instead of `context.replyToMessageId`. Without this, the shared anchor resolution (D2) would silently retarget reactions to the bot's own file message — a pointless self-reaction and an unrequested behavior change. The "No trigger message to react to" error condition is unchanged (both fields are undefined together: `send-file` is rejected in triggerless sessions, so a file anchor can never exist without a trigger). `replyToMessageId`'s JSDoc is updated to "resolved reply anchor (`lastFileMessageId ?? triggerMessageId`)" so future consumers do not mistake it for the trigger identity.

### D4: `get-message` fallback chain

`handleGetMessage` resolves `params.messageId || context.lastSentMessageId || context.lastFileMessageId`. This lets the agent re-fetch the file message it just sent without copying the ID from the earlier result. `lastSentMessageId` stays first so reply-edit workflows keep working unchanged.

### D5: `file_sent` audit carries the stored IDs

The `file_sent` audit entry gains `messageId` (last delivered) and `messageIds` (all delivered, in send order), sourced from `result.data`. `SessionAuditEntry` data gains both optional fields. IDs are platform snowflakes/note IDs — not user content — so they are written verbatim regardless of `hashContent`.

### D6: Documentation teaches the contract

- `skills/send-file/SKILL.md`: document the result fields (`messageId`, `messageIds`, `filesCount`) and state that a later `send-reply` will be threaded to the file message.
- `skills/send-reply/SKILL.md`: note that when files were sent earlier in the session, the reply is threaded to the file message.
- `skills/edit-reply/SKILL.md`: state explicitly that only `send-reply` messages are editable and file messages never are, and that an edit keeps the reply's original thread position.
- `AGENTS.md` and `docs/SKILLS_IMPLEMENTATION.md`: update the send-file section (currently states it "does NOT update `lastSentMessageId`") to document `lastFileMessageId`, the per-reply anchor `lastReplyAnchorMessageId`, and the anchor resolution.

## Risks / Trade-offs

- [Discord reply-reference race] Discord's `messageReference` to the just-sent file message can only fail if the file message is deleted before the reply; within a single session the file message is recent, so the risk is negligible → no mitigation beyond the platform's existing error path (the send-reply failure rolls back `replySent` and surfaces the error to the agent).
- [Misskey `notes/show` on the anchor during edit] `editNote` fetches the anchor note to build reply params; the anchor (trigger or file note) exists within the same session, so the existing catch-and-default path covers any failure → no change.
- [Edit re-parenting regression] If a future edit path fell back to the *current* anchor instead of the per-reply anchor (`lastReplyAnchorMessageId`), editing a reply sent before a file send would silently re-thread it under the file message → guarded by the explicit `lastReplyAnchorMessageId` wiring and a dedicated ordering test (reply → file → edit keeps the trigger as parent).
- [Reaction retarget regression] D3 exists precisely to prevent the anchor change from moving reactions; the risk is a future dev "simplifying" `react-message` back to `replyToMessageId` → the reaction-handler test asserting the trigger target guards this.
- [Doc drift on `lastSentMessageId` semantics] The field name now understates its meaning (text replies only) → JSDoc clarification (D1) and AGENTS.md update (D6) mitigate; a future rename is documented as a possible follow-up.
- [Undefined delivered message ID] A delivery success without a usable `messageId`/`messageIds` entry (defensive, cannot occur with current adapters) would leave no file anchor → the server warns and leaves the anchor on the trigger rather than storing a bogus ID (D1).
- [Partial-delivery anchor] On Misskey chat, a partial send stores the last *delivered* message ID; a follow-up reply threads to a delivered message — never to a failed/undeleted one → no orphan anchor.
- [Concurrent skill calls] `lastFileMessageId` is written only after the send-file call returns; a reply initiated concurrently with an in-flight file send uses the pre-file anchor (trigger) → documented semantics ("subsequent" = after the send-file call returned), matching the agent's sequential tool loop.

## Migration Plan

None required. Early-stage project with zero production users; session state is in-memory per session and never persisted, so there is nothing to migrate. Rollback is a revert of the change.

## Open Questions

- None outstanding. (Whether `react-message` should ever target the bot's own file message is explicitly out of scope; the trigger target is preserved by design.)
