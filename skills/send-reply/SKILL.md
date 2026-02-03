---
name: send-reply
type: shell
description: |
  Send the final reply message to the user on the platform.
  This is the ONLY way to communicate with the user externally.
  Can only be called ONCE per interaction - subsequent calls will fail.
command: deno run --allow-net skills/send-reply/skill.ts
parameters:
  - name: session-id
    type: string
    required: true
    flag: --session-id
    description: The session identifier (provided in SESSION_ID file)
  - name: message
    type: string
    required: true
    flag: --message
    description: The final message to send to the user
output:
  format: json
  fields:
    - name: success
      type: boolean
    - name: data.messageId
      type: string
    - name: error
      type: string
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Usage

```bash
deno run --allow-net skills/send-reply/skill.ts \
  --session-id "$SESSION_ID" \
  --message "Your reply message here"
```

## Critical Rules

1. **One reply only**: You can only send ONE reply per interaction
2. **This is the ONLY external output**: All other processing remains internal
3. **Make it complete**: Ensure your reply addresses the user's request fully
4. **Session ID**: Read the session ID from the `SESSION_ID` file in the working directory

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
