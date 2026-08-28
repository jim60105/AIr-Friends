---
name: get-message
description: Get the content of a sent message by its ID
parameters:
  - name: messageId
    type: string
    required: false
    description: The ID of the message to fetch. If omitted, returns the last message sent in this session.
---

# get-message

Retrieve the content and metadata of a message by its ID. Useful for checking the current content before editing.

## Usage

```bash
${HOME}/.agents/skills/get-message/scripts/get-message.ts \
  --session-id "$SESSION_ID" \
  --message-id "<messageId from send-reply>"

# Or without --message-id to get the last sent message:
${HOME}/.agents/skills/get-message/scripts/get-message.ts \
  --session-id "$SESSION_ID"
```

**`--session-id`**: Use the session id rendered in your system prompt. `$SESSION_ID` works only in per-spawn deployments; in shared-process mode it is not set and the skill library resolves the owning session automatically — a mismatched value is never honored.

## Response

```json
{
  "success": true,
  "data": {
    "messageId": "msg_123",
    "content": "The message text content",
    "userId": "user_456",
    "username": "BotName",
    "timestamp": "2024-01-15T10:30:45.123Z",
    "isBot": true
  }
}
```

## Important Notes

- If `messageId` is omitted, the last message sent via `send-reply` or `edit-reply` in the current session is returned.
- If no message has been sent yet and no `messageId` is provided, an error is returned.
- Only messages accessible in the current channel can be fetched.
