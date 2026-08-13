---
name: send-reply
description: Send the final reply message to the user on the platform. This is the ONLY way to communicate with the user externally. If you don't use this skill, the user won't see your response.
allowed-tools: Bash
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Critical Rules

1. **One reply only**: You can only send ONE reply. You MUST send exactly ONE reply.
2. **This is the ONLY external output**: All other processing remains internal.
3. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash.
4. **No second attempt**: If you fail to send the reply or if the script encounters an error, you won't get a second chance to send another reply. That means you failed your job. Make sure your message is final and well-crafted before executing this skill.
5. **Think before you send**: Take a moment to review your message for clarity, tone, and content. Once you hit send, there's no going back.
6. **Exit directly after sending the reply**: After executing this `send-reply` skill, you must exit immediately. Do not summarize, continue processing, or attempt to send another message. Your job is done.
7. **Threading**: The reply is threaded to the message the file tool (`send-file`) most recently delivered, when one exists in this session; otherwise it is threaded to the user's trigger message.

## Usage

**Two-step flow — the message text MUST NOT appear on the command line.**

1. Write your reply text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/reply.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion).

2. Invoke the script with the payload file path:

   ```bash
   ${HOME}/.agents/skills/send-reply/scripts/send-reply.ts \
     --session-id "$SESSION_ID" \
     --message-file "$TMPDIR/$SESSION_ID/reply.md"
   ```

**WARNING**: Never put message content on the command line. The legacy `--message "..."` / `--message=...` flags are REMOVED: the shell expands `$VAR` in them (e.g. `$0` → `/usr/bin/bash`, `$HOME`, `$API_KEY`), which corrupts your message and can leak environment variables to the user.

## Parameters

| Parameter        | Required | Description                                                                               |
| ---------------- | -------- | ----------------------------------------------------------------------------------------- |
| `--session-id`   | Yes      | Current session ID (from `$SESSION_ID` environment)                                       |
| `--message-file` | Yes      | Path of the payload file containing the reply text (must be under `$TMPDIR/$SESSION_ID/`) |

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes:

| Code                          | Meaning                                        | Fix                                                                        |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `SKILL_LEGACY_FLAG`           | You used the removed `--message` flag          | Put the text in `$TMPDIR/$SESSION_ID/reply.md` and use `--message-file`    |
| `SKILL_MISSING_PAYLOAD`       | No `--message-file` given                      | Write the payload file first, then invoke with `--message-file`            |
| `SKILL_PAYLOAD_OUT_OF_BOUNDS` | Payload path is outside `$TMPDIR/$SESSION_ID/` | The script only reads its own session's staging dir — stage the text there |
| `SKILL_PAYLOAD_NOT_FOUND`     | Payload file missing/unreadable                | Write the file FIRST with the edit/write tool, then invoke the script      |

## Limits

- Maximum **1 reply** per session. After sending the first reply, subsequent calls will be rejected.
- If rejected, use `edit-reply` to modify the existing message instead.
- Excessive retry attempts will cause the agent process to be terminated.
- Ultrathink carefully and ensure you have all the text prepared before proceeding, as you may not get another chance.
