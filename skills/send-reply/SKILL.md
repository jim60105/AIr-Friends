---
name: send-reply
description: Send the final reply message to the user on the platform. This is the ONLY way to communicate with the user externally. If you don't use this skill, the user won't see your response.
allowed-tools: Bash
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Critical Rules

1. **One reply only**: You can only send ONE reply. You MUST send exactly ONE reply.
2. **This is the ONLY external output**: All other processing remains internal.
3. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash.
4. **No second attempt**: If you fail to send the reply or if the script encounters an error, you won't get a second chance to send another reply. That means you failed your job. Make sure your message is final and well-crafted before executing this skill.
5. **Think before you send**: Take a moment to review your message for clarity, tone, and content. Once you hit send, there's no going back.
6. **Exit directly after sending the reply**: After executing this `send-reply` skill, you must exit immediately. Do not summarize, continue processing, or attempt to send another message. Your job is done.

## Usage

```bash
${HOME}/.agents/skills/send-reply/scripts/send-reply.ts \
  --session-id "$SESSION_ID" \
  --message "Your reply message here"
```

## Limits

- Maximum **1 reply** per session. After sending the first reply, subsequent calls will be rejected.
- If rejected, use `edit-reply` to modify the existing message instead.
- Excessive retry attempts will cause the agent process to be terminated.
