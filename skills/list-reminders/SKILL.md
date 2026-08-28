---
name: list-reminders
description: List all active reminders for the current user
allowed-tools: Bash
---

# list-reminders

List all active (pending) reminders for the current user.

## Constraints

- **DM only**: This skill can ONLY be used in a DM conversation.

## Usage

```bash
${HOME}/.agents/skills/list-reminders/scripts/list-reminders.ts \
  --session-id "$SESSION_ID"
```

## Parameters

| Parameter      | Required | Description                                                                                                                                                                                                                                      |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--session-id` | Yes      | Use the session id rendered in your system prompt. `$SESSION_ID` works only in per-spawn deployments; in shared-process mode it is not set and the skill library resolves the owning session automatically — a mismatched value is never honored |

## Example Response

```json
{
  "success": true,
  "data": {
    "reminders": [
      {
        "id": "rem_1705312800000_a1b2c3d4",
        "message": "Team meeting",
        "scheduledAt": "2025-01-15T10:00:00.000Z",
        "createdAt": "2025-01-14T15:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
