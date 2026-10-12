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

> The placeholder `<skill root rendered in your system prompt>` is the absolute skill-script root rendered in your system prompt: substitute that literal root before invoking — never run this command with the placeholder, a `$HOME` expression, or any other root.

```bash
<skill root rendered in your system prompt>/cancel-reminder/scripts/cancel-reminder.ts \
  --session-id "<session id rendered in your system prompt>" \
  --reminder-id "rem_1705312800000_a1b2c3d4"
```

## Parameters

| Parameter       | Required | Description                                                                                                                                                                                               |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--session-id`  | Yes      | Pass the literal session id rendered in your system prompt — authoritative in every deployment shape; the skill library resolves the owning session automatically and a mismatched value is never honored |
| `--reminder-id` | Yes      | The ID of the reminder to cancel (returned by `set-reminder`)                                                                                                                                             |

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
