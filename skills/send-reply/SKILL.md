---
name: send-reply
description: Send the final reply message to the user on the platform. This is the ONLY way to communicate with the user externally.
allowed-tools: Bash
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Critical Rules

1. **At least one reply required**: You MUST send at least ONE reply before ending the session.
2. **Multiple replies allowed**: You can call send-reply multiple times. Each call sends a separate message.
3. **This is the ONLY external output**: All other processing remains internal.
4. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash.
5. **Think before you send**: Take a moment to review your message for clarity, tone, and content. Once you hit send, there's no going back.

## Usage

```bash
${HOME}/.agents/skills/send-reply/scripts/send-reply.ts \
  --session-id "$SESSION_ID" \
  --message "Your reply message here"
```
