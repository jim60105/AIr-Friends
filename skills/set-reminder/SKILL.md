---
name: set-reminder
description: Set a one-time reminder to be delivered via DM at a future time
allowed-tools: Bash
---

# set-reminder

Set a one-time reminder that will be delivered to the user via **direct message (DM)** at the specified time.

## Constraints

- **DM only**: This skill can ONLY be used in a DM conversation. If the user asks to set a reminder in a public channel, tell them to send you a DM.
- **One per session**: You can only set ONE reminder per conversation turn. If you need to set multiple reminders, ask the user to send separate messages.
- **One-time only**: Recurring/repeating reminders are NOT supported. Each reminder fires exactly once. If the user asks for a daily/weekly reminder, explain this limitation and suggest they set individual reminders.
- **ISO 8601 format**: The `--scheduled-at` parameter MUST be a valid ISO 8601 UTC timestamp (e.g., `2025-01-15T10:00:00Z`). You are responsible for converting the user's natural language time expression to this format.

## Usage

```bash
${HOME}/.agents/skills/set-reminder/scripts/set-reminder.ts \
  --session-id "$SESSION_ID" \
  --scheduled-at "2025-01-15T10:00:00Z" \
  --message "Team meeting in 30 minutes"
```

## Parameters

| Parameter        | Required | Description                                              |
| ---------------- | -------- | -------------------------------------------------------- |
| `--session-id`   | Yes      | Current session ID                                       |
| `--scheduled-at` | Yes      | ISO 8601 UTC timestamp for when the reminder should fire |
| `--message`      | Yes      | The reminder message content                             |

## Rules

- `scheduledAt` must be a valid ISO 8601 timestamp in the future (at least 1 minute from now)
- Each user has a maximum of 20 active reminders
- The reminder will always be delivered via DM, regardless of where it was set
- On success, returns the `reminderId` for future cancellation via `cancel-reminder`

## Example Response

```json
{
  "success": true,
  "data": {
    "reminderId": "rem_1705312800000_a1b2c3d4",
    "scheduledAt": "2025-01-15T10:00:00.000Z"
  }
}
```

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
