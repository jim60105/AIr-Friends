---
name: send-file
description: Send one or more files from the workspace to the user on the platform. The files must exist within the workspace directory.
allowed-tools: Bash
---

# Send File Skill

Send one or more files from your workspace to the current conversation channel in a single invocation.

## Critical Rules

1. **Files must exist**: Every file must already exist in your workspace before calling this skill.
2. **Workspace boundary**: Only files within the workspace or agent-workspace can be sent. Path traversal (../) is not allowed, and a symlink that resolves outside the workspace or agent-workspace is rejected.
3. **Size limits**: Files exceeding the configured size limit will be rejected. Default per-file limit is 25 MB; default per-invocation batch limit is 50 MB total across all files. At most 10 files can be sent per invocation.
4. **Extension restrictions**: If an extension whitelist is configured, only matching file types can be sent.
5. **One send per session**: Only ONE successful `send-file` call is allowed per session (a multi-file batch counts as one call). Further calls are rejected with HTTP 429, and repeated attempts terminate the agent. If you need to send more, include everything in the single invocation.
6. **This skill may be disabled**: The administrator may disable this skill. If you receive a "disabled" error, inform the user that file sending is not available.
7. **Timeout**: The script won't run for more than 30 seconds. If it hangs, cancel the running command with the running-command controls your agent documents (if any). A stopped send may still have reached the platform, so never retry that send.
8. **Threading**: The file message is sent as a reply to the user's trigger message. A subsequent `send-reply` in the same session will be threaded to this file message (keeping the conversation in one thread), not to the trigger.
9. **Email delivery**: On the `email` platform each delivered file is its own email to the user (a text reply is a separate email), and the deployment's configured signature is appended centrally, exactly once — never write a signature or sign-off block yourself.

## Result

On success the script returns `messageId` (the delivered message ID), `messageIds` (all delivered IDs, in send order), `filesCount`, and `nextAction`. On partial delivery (Misskey chat) it returns the delivered IDs alongside the error.

Read `filesCount` and `messageIds` before you decide anything. The single send-file slot (rule 5) is judged by what was DELIVERED, not by the `success` flag:

- A result reporting a positive `filesCount` means those files ARE delivered, even when `success` is false. `messageIds` lists the delivered platform message IDs, and a batch sent as a single message can report fewer IDs than files. Misskey chat delivers one message per file, so a batch can stop half-way. Do NOT resend the batch, and do NOT resend the files that did not arrive: the remaining files are abandoned for this session.
- Such a delivered result also satisfies rule 5. The slot is consumed and a further `send-file` call is rejected. Only a failure BEFORE any platform send — one of the documented `SKILL_*` payload/flag errors, an unreadable or rejected path, or invalid or oversized input — leaves the slot unused, so only then may you fix the reported cause and invoke the skill again.
- A generic platform error that reports no delivered IDs and no positive `filesCount` is NOT evidence that nothing reached the platform: the request had already been dispatched, so treat that outcome as uncertain and follow the recovery guidance in the `send-reply` skill instead of retrying.
- A text reply you still owe keeps its own separate quota, and it is threaded to the last delivered file message when one exists, otherwise to the trigger message (rule 8).

## Usage

Pass **one `--file-paths` flag per file** (repeatable; short alias `-f`). At least one occurrence is required.

### Path resolution

`--file-paths` values are resolved against the session workspace root (your working directory):

- **Relative values resolve from that root.** With the example workspace root `/work/discord/123`,
  the existing file `/work/discord/123/tmp/sess_42/file.png` is sent exactly as
  `--file-paths "tmp/sess_42/file.png"`. Copying or moving that nested file to the workspace root
  is unnecessary — send it where it already is.
- **An absolute path inside the workspace or agent-workspace is also accepted**, e.g.
  `--file-paths "/work/discord/123/exports/report.pdf"`.
- **Attachment paths need NOT be session-staged.** Session staging is the required home of the
  caption payload file only; a file anywhere inside the workspace can be sent.

The boundaries above are unchanged: traversal and symlink escapes are rejected, the per-file, batch
and count size limits apply, and the one-send quota still allows a single invocation.

### Caption (optional)

The caption is OPTIONAL. When present, it MUST NOT appear on the command line — use the two-step payload-file flow (same rules as `send-reply`):

1. (Optional) Write the caption text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   <absolute staging directory rendered in your system prompt>/caption.md
   ```

   Use the **absolute staging directory your system prompt renders** verbatim — never build the path from environment variables. The write goes through the ACP filesystem interface, so the text bytes are preserved **verbatim** (no shell expansion), and the script resolves the owning session automatically in every deployment shape.

2. Invoke the script with the payload file path:

> The placeholder `<skill root rendered in your system prompt>` is the absolute skill-script root rendered in your system prompt: substitute that literal root before invoking — never run this command with the placeholder, a `$HOME` expression, or any other root.

   ```
   <skill root rendered in your system prompt>/send-file/scripts/send-file.ts \
     --session-id "<session id rendered in your system prompt>" \
     --file-paths "relative/path/to/file.png" \
     --file-paths "relative/path/to/second.pdf" \
     --caption-file "<absolute staging directory rendered in your system prompt>/caption.md"
   ```

**WARNING**: Never put caption text on the command line. The legacy `--caption "..."` / `--caption=...` flag is REMOVED: the shell expands `$VAR` in it, which corrupts the caption and can leak environment variables to the user. The singular `--file-path` flag is also REMOVED — it is rejected with code `SKILL_SINGLE_FILE_FLAG`; use the repeatable `--file-paths` flag instead.

### Parameters

| Parameter        | Required | Description                                                                                                                                                                                               |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--session-id`   | Yes      | Pass the literal session id rendered in your system prompt — authoritative in every deployment shape; the skill library resolves the owning session automatically and a mismatched value is never honored |
| `--file-paths`   | Yes      | Repeatable attachment path; a relative value resolves from the workspace root and an absolute value inside the workspace/agent-workspace is also accepted. One occurrence per file, at least 1           |
| `-f`             | No       | Short alias for `--file-paths`                                                                                                                                                                            |
| `--caption-file` | No       | Path of the payload file containing the caption text (must be under `<absolute staging directory rendered in your system prompt>/`)                                                                       |

### Example

```
# Send an image
<skill root rendered in your system prompt>/send-file/scripts/send-file.ts \
  --session-id "<session id rendered in your system prompt>" \
  --file-paths "output/chart.png"

# Send multiple files in one message
<skill root rendered in your system prompt>/send-file/scripts/send-file.ts \
  --session-id "<session id rendered in your system prompt>" \
  --file-paths "exports/report.pdf" \
  --file-paths "exports/chart.png" \
  --file-paths "exports/data.json"

# Send an existing session-staged file in place, without copying it to the workspace root
# (fixture: workspace root /work/discord/123 and literal session sess_42 — substitute the
# workspace root and the session id your system prompt renders, consistently with the
# tmp/<sessionId>/ directory the file lives in)
<skill root rendered in your system prompt>/send-file/scripts/send-file.ts \
  --session-id "sess_42" \
  --file-paths "tmp/sess_42/file.png"

# Send a nested file by its absolute workspace path, with a caption
<skill root rendered in your system prompt>/send-file/scripts/send-file.ts \
  --session-id "<session id rendered in your system prompt>" \
  --file-paths "/work/discord/123/tmp/sess_42/file.png" \
  --caption-file "<absolute staging directory rendered in your system prompt>/caption.md"

# Send multiple files with a description
<skill root rendered in your system prompt>/send-file/scripts/send-file.ts \
  --session-id "<session id rendered in your system prompt>" \
  --file-paths "exports/report.pdf" \
  --file-paths "exports/chart.png" \
  --caption-file "<absolute staging directory rendered in your system prompt>/caption.md"
```

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_SINGLE_FILE_FLAG` (you used the removed singular `--file-path` flag — use repeatable `--file-paths`), `SKILL_LEGACY_FLAG` (you used the removed `--caption` flag — stage the text in `<absolute staging directory rendered in your system prompt>/caption.md` and use `--caption-file`), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `<absolute staging directory rendered in your system prompt>/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).
