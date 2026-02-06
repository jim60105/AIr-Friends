---
name: fetch-context
description: Fetch additional context from the platform, including recent messages, search through conversation history, or get user information. Use when you need more context than what's provided initially.
allowed-tools: Bash
---

# Fetch Context Skill

Retrieve additional context from the platform to better understand the conversation.

## Usage

```bash
# Get recent messages
scripts/fetch-context.ts \
  --session-id "$SESSION_ID" \
  --type recent_messages \
  --limit 20

# Search messages
scripts/fetch-context.ts \
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
