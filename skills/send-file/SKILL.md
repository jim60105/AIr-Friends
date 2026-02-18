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

```
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-path "relative/path/to/file.png" \
  --caption "Optional description of the file"
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--session-id` | Yes | Session ID from `$SESSION_ID` environment variable |
| `--file-path` | Yes | File path relative to the workspace root |
| `--caption` | No | Optional text message to accompany the file |

### Example

```
# Send an image
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-path "output/chart.png"

# Send a file with description
${HOME}/.agents/skills/send-file/scripts/send-file.ts \
  --session-id "$SESSION_ID" \
  --file-path "exports/report.pdf" \
  --caption "Here is the report you requested"
```
