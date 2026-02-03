---
name: send-reply
description: |
  Send the final reply message to the user on the platform.
  This is the ONLY way to communicate with the user externally.
  Can only be called ONCE per interaction - subsequent calls will fail.
parameters:
  type: object
  properties:
    message:
      type: string
      description: The final message to send to the user
    attachments:
      type: array
      items:
        type: object
        properties:
          type:
            type: string
            enum: [image, file]
          url:
            type: string
          filename:
            type: string
      description: Optional attachments to include
  required: [message]
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Critical Rules

1. **One reply only**: You can only send ONE reply per interaction
2. **This is the ONLY external output**: All other processing remains internal
3. **Make it complete**: Ensure your reply addresses the user's request fully

## Guidelines

- Be conversational and natural
- Address all parts of the user's message
- Don't mention internal processing steps

## Example

```json
{
  "message": "Hello! I remember you mentioned you like hiking. How was your recent trip?",
  "attachments": []
}
```
