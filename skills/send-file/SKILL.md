---
name: send-file
description: Send one or more files from the workspace to the user on the platform. The files must exist within the workspace directory.
allowed-tools: Bash
---

# Send File Skill

Send one or more files from your workspace to the current conversation channel in a single invocation.

## Critical Rules

1. **Files must exist**: Every file must already exist in your workspace before calling this skill.
2. **Workspace boundary**: Only files within the workspace or agent-workspace can be sent. Path traversal (../) is not allowed.
3. **Size limits**: Files exceeding the configured size limit will be rejected. Default per-file limit is 25 MB; default per-invocation batch limit is 50 MB total across all files. At most 10 files can be sent per invocation.
4. **Extension restrictions**: If an extension whitelist is configured, only matching file types can be sent.
5. **One send per session**: Only ONE successful `send-file` call is allowed per session (a multi-file batch counts as one call). Further calls are rejected with HTTP 429, and repeated attempts terminate the agent. If you need to send more, include everything in the single invocation.
6. **This skill may be disabled**: The administrator may disable this skill. If you receive a "disabled" error, inform the user that file sending is not available.
7. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash.

## Usage

Pass **one `--file-paths` flag per file** (repeatable; short alias `-f`). At least one occurrence is required.

The caption is OPTIONAL. When present, it MUST NOT appear on the command line — use the two-step payload-file flow (same rules as `send-reply`):

1. (Optional) Write the caption text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/caption.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion).

2. Invoke the script with the payload file path:

   ```
   ${HOME}/.agents/skills/send-file/scripts/send-file.ts \
     --session-id "$SESSION_ID" \
     --file-paths "relative/path/to/file.png" \
     --file-paths "relative/path/to/second.pdf" \
     --caption-file "$TMPDIR/$SESSION_ID/caption.md"
   ```

**WARNING**: Never put caption text on the command line. The legacy `--caption "..."` / `--caption=...` flag is REMOVED: the shell expands `$VAR` in it, which corrupts the caption and can leak environment variables to the user. The singular `--file-path` flag is also REMOVED — it is rejected with code `SKILL_SINGLE_FILE_FLAG`; use the repeatable `--file-paths` flag instead.

### Parameters

| Parameter        | Required | Description                                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `--session-id`   | Yes      | Session ID from `$SESSION_ID` environment variable                                          |
| `--file-paths`   | Yes      | Repeatable file path (relative to the workspace root); one occurrence per file, at least 1  |
| `-f`             | No       | Short alias for `--file-paths`                                                              |
| `--caption-file` | No       | Path of the payload file containing the caption text (must be under `$TMPDIR/$SESSION_ID/`) |

### Example

```
# Send an image
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-paths "output/chart.png"

# Send multiple files in one message
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-paths "exports/report.pdf" \
  --file-paths "exports/chart.png" \
  --file-paths "exports/data.json"

# Send multiple files with a description
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-paths "exports/report.pdf" \
  --file-paths "exports/chart.png" \
  --caption-file "$TMPDIR/$SESSION_ID/caption.md"
```

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_SINGLE_FILE_FLAG` (you used the removed singular `--file-path` flag — use repeatable `--file-paths`), `SKILL_LEGACY_FLAG` (you used the removed `--caption` flag — stage the text in `$TMPDIR/$SESSION_ID/caption.md` and use `--caption-file`), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).
