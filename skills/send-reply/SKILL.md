---
name: send-reply
description: Send the final reply message to the user on the platform. This is the ONLY way to communicate with the user externally.
allowed-tools: Bash
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Usage

```bash
scripts/send-reply.ts \
  --session-id "$SESSION_ID" \
  --message "Your reply message here"
```

## Critical Rules

1. **One reply only**: You can only send ONE reply per interaction
2. **This is the ONLY external output**: All other processing remains internal
3. **Make it complete**: Ensure your reply addresses the user's request fully

## Output Format

On success:

```json
{ "success": true, "data": { "messageId": "123456789", "timestamp": "2024-01-01T12:00:00Z" } }
```

On failure:

```json
{ "success": false, "error": "Reply already sent for this session" }
```

## Exit Codes

- `0`: Success
- `1`: Error (check stderr or stdout JSON for details)
