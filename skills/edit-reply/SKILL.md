---
name: edit-reply
description: Edit the last reply message that was sent via send-reply
parameters:
  - name: messageId
    type: string
    required: true
    description: The ID of the message to edit (obtained from send-reply result)
  - name: message
    type: string
    required: true
    description: The new message content to replace the original
---

# edit-reply

Edit the previously sent reply message. Use this when you need to correct errors or update information in your last reply.

## Prerequisites

- You must have already sent a reply using `send-reply` and obtained the `messageId` from its result
- Can only edit messages sent by the bot in the current session

## Usage

**Two-step flow — the new message text MUST NOT appear on the command line.**

1. Write the corrected text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/reply.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion). `$TMPDIR/$SESSION_ID/` is the per-spawn form of the staging directory; in shared-process deployments the staging directory is shown in your system prompt and the script resolves it automatically.

2. Invoke the script with the payload file path:

   ```bash
   ${HOME}/.agents/skills/edit-reply/scripts/edit-reply.ts \
     --session-id "$SESSION_ID" \
     --message-id "<messageId from send-reply>" \
     --message-file "$TMPDIR/$SESSION_ID/reply.md"
   ```

**WARNING**: Never put message content on the command line. The legacy `--message "..."` / `--message=...` flags are REMOVED: the shell expands `$VAR` in them (e.g. `$0` → `/usr/bin/bash`, `$HOME`, `$API_KEY`), which corrupts your message and can leak environment variables to the user.

## Parameters

| Parameter        | Required | Description                                                                                                                                                                                                                                      |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--session-id`   | Yes      | Use the session id rendered in your system prompt. `$SESSION_ID` works only in per-spawn deployments; in shared-process mode it is not set and the skill library resolves the owning session automatically — a mismatched value is never honored |
| `--message-id`   | Yes      | The ID of the message to edit (obtained from send-reply result)                                                                                                                                                                                  |
| `--message-file` | Yes      | Path of the payload file containing the new text (must be under `$TMPDIR/$SESSION_ID/`)                                                                                                                                                          |

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_LEGACY_FLAG` (you used the removed `--message` flag — stage the text in `$TMPDIR/$SESSION_ID/reply.md` and use `--message-file`), `SKILL_MISSING_PAYLOAD` (no `--message-file` given), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).

## Important Notes

- You can call this multiple times to make additional edits
- Only the most recent content will be visible on the platform
- The `messageId` must be from a previous `send-reply` call in the same session
- **Only `send-reply` messages are editable** — messages delivered by `send-file` are NEVER editable, and passing a file-message ID to this skill will be rejected. There is no edit-file skill.
- Editing keeps the reply's original thread position: a reply sent before a file send stays threaded to the trigger message, and one sent after stays threaded to the file message. Editing never rewrites the conversation's thread topology.

## Platform-Specific Behavior

- **Discord**: Uses native message edit API. The `messageId` remains the same after editing.
- **Misskey**: Uses delete-and-recreate strategy (Misskey has no edit API). The returned `messageId` will be **different** from the original. Use the new `messageId` for subsequent edits.

## Limits

- Maximum **2 edits** per session. Third retry attempts will cause the agent process to be terminated.
- Ultrathink carefully and ensure you have all the text prepared before proceeding, as you may not get another chance.
