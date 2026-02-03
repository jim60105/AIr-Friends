---
name: fetch-context
type: shell
description: |
  Fetch additional context from the platform when needed.
  Use this to get more message history or search for related conversations.
command: deno run --allow-net skills/fetch-context/skill.ts
parameters:
  - name: session-id
    type: string
    required: true
    flag: --session-id
  - name: type
    type: string
    required: true
    flag: --type
    enum: [recent_messages, search_messages, user_info]
    description: Type of context to fetch
  - name: query
    type: string
    flag: --query
    description: Search query (for search_messages type)
  - name: limit
    type: number
    flag: --limit
    default: 20
    description: Maximum items to return
output:
  format: json
---

# Fetch Context Skill

Retrieve additional context from the platform to better understand the conversation.

## Usage

```bash
# Get recent messages
deno run --allow-net skills/fetch-context/skill.ts \
  --session-id "$SESSION_ID" \
  --type recent_messages \
  --limit 20

# Search messages
deno run --allow-net skills/fetch-context/skill.ts \
  --session-id "$SESSION_ID" \
  --type search_messages \
  --query "project deadline" \
  --limit 10
```

## Available Types

- `recent_messages`: Get more recent message history
- `search_messages`: Search for messages by keyword
- `user_info`: Get information about the current user

## Output

```json
{
  "success": true,
  "data": {
    "type": "recent_messages",
    "data": [
      {
        "messageId": "123",
        "userId": "456",
        "username": "Alice",
        "content": "Hello!",
        "timestamp": "2024-01-01T12:00:00Z",
        "isBot": false
      }
    ]
  }
}
```
