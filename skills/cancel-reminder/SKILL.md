---
name: cancel-reminder
description: Cancel a previously set reminder by its ID
allowed-tools: Bash
---

# cancel-reminder

Cancel a previously set reminder. The reminder must belong to the current user.

## Constraints

- **DM only**: This skill can ONLY be used in a DM conversation.

## Usage

```bash
${HOME}/.agents/skills/cancel-reminder/scripts/cancel-reminder.ts \
  --session-id "$SESSION_ID" \
  --reminder-id "rem_1705312800000_a1b2c3d4"
```

## Parameters

| Parameter       | Required | Description                                                   |
| --------------- | -------- | ------------------------------------------------------------- |
| `--session-id`  | Yes      | Current session ID                                            |
| `--reminder-id` | Yes      | The ID of the reminder to cancel (returned by `set-reminder`) |

## Example Response

```json
{
  "success": true,
  "data": {
    "reminderId": "rem_1705312800000_a1b2c3d4",
    "cancelled": true
  }
}
```

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
