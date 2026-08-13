---
name: send-file
description: Send a file from the workspace to the user on the platform. The file must exist within the workspace directory.
allowed-tools: Bash
---

# Send File Skill

Send a file from your workspace to the current conversation channel.

## Critical Rules

1. **File must exist**: The file must already exist in your workspace before calling this skill.
2. **Workspace boundary**: Only files within the workspace or agent-workspace can be sent. Path traversal (../) is not allowed.
3. **Size limits**: Files exceeding the configured size limit will be rejected. Default limit is 25 MB.
4. **Extension restrictions**: If an extension whitelist is configured, only matching file types can be sent.
5. **This skill may be disabled**: The administrator may disable this skill. If you receive a "disabled" error, inform the user that file sending is not available.
6. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash.

## Usage

The caption is OPTIONAL. When present, it MUST NOT appear on the command line — use the two-step payload-file flow:

1. (Optional) Write the caption text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/caption.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion).

2. Invoke the script with the payload file path:

   ```
   ${HOME}/.agents/skills/send-file/scripts/send-file.ts \
     --session-id "$SESSION_ID" \
     --file-path "relative/path/to/file.png" \
     --caption-file "$TMPDIR/$SESSION_ID/caption.md"
   ```

**WARNING**: Never put caption text on the command line. The legacy `--caption "..."` / `--caption=...` flag is REMOVED: the shell expands `$VAR` in it, which corrupts the caption and can leak environment variables to the user.

### Parameters

| Parameter        | Required | Description                                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `--session-id`   | Yes      | Session ID from `$SESSION_ID` environment variable                                          |
| `--file-path`    | Yes      | File path relative to the workspace root                                                    |
| `--caption-file` | No       | Path of the payload file containing the caption text (must be under `$TMPDIR/$SESSION_ID/`) |

### Example

```
# Send an image
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-path "output/chart.png"

# Send a file with a description
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-path "exports/report.pdf" \
  --caption-file "$TMPDIR/$SESSION_ID/caption.md"
```

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_LEGACY_FLAG` (you used the removed `--caption` flag — stage the text in `$TMPDIR/$SESSION_ID/caption.md` and use `--caption-file`), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).
