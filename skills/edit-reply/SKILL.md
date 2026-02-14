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
