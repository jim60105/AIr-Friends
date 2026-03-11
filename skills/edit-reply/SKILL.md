---
name: edit-reply
description: Edit the last reply message that was sent via send-reply
parameters:
  - name: messageId
    type: string
    required: true
    description: The ID of the message to edit (obtained from send-reply result)
  - name: message
    type: string
    required: true
    description: The new message content to replace the original
---

# edit-reply

Edit the previously sent reply message. Use this when you need to correct errors or update information in your last reply.

## Prerequisites

- You must have already sent a reply using `send-reply` and obtained the `messageId` from its result
- Can only edit messages sent by the bot in the current session

## Usage

```bash
${HOME}/.agents/skills/edit-reply/scripts/edit-reply.ts \
  --session-id "$SESSION_ID" \
  --message-id "<messageId from send-reply>" \
  --message "Corrected reply content"
```

## Important Notes

- You can call this multiple times to make additional edits
- Only the most recent content will be visible on the platform
- The `messageId` must be from a previous `send-reply` call in the same session

## Platform-Specific Behavior

- **Discord**: Uses native message edit API. The `messageId` remains the same after editing.
- **Misskey**: Uses delete-and-recreate strategy (Misskey has no edit API). The returned `messageId` will be **different** from the original. Use the new `messageId` for subsequent edits.

## Important Notes

- **Content comparison**: Before editing, the skill checks if the new content is identical
  to the current message. If they match, the edit is rejected with an error.
- **Exit after edit**: On success, the response includes a `nextAction` field instructing
  you to exit immediately. Continuing to call edit-reply after success may result in
  process termination.

## Response

### Success
```json
{
  "success": true,
  "data": {
    "messageId": "msg_123",
    "timestamp": "2024-01-15T10:30:45.123Z",
    "nextAction": "You have done your job. EXIT IMMEDIATELY or you will be terminated."
  }
}
```

### Failure (same content)
```json
{
  "success": false,
  "error": "The edit content is the same as the current message content. No changes were made."
}
```
