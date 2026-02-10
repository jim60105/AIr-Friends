---
name: react-message
description: Add an emoji reaction to the trigger message. Use this to express quick emotions or acknowledge messages without sending a full text reply.
allowed-tools: Bash
---

# React Message Skill

Add an emoji reaction to the message that triggered this conversation.

## Critical Rules

1. **Use appropriate emoji**: Choose an emoji that matches the tone and context of the conversation.
2. **Reaction is optional**: You don't have to react. Only react when it feels natural.
3. **Can be used with or without send-reply**: You may react AND send a reply, or just react without replying.
4. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash.
5. **Use the correct emoji format**: For custom emojis, use the format provided in the emoji list. For standard Unicode emojis, use the emoji character directly (e.g., "👍", "❤️").

## Usage

```
${HOME}/.agents/skills/react-message/scripts/react-message.ts \
  --session-id "$SESSION_ID" \
  --emoji "👍"
```

### Examples

React with a Unicode emoji:

```
${HOME}/.agents/skills/react-message/scripts/react-message.ts \
  --session-id "$SESSION_ID" \
  --emoji "❤️"
```

React with a custom platform emoji (use the `useAsReaction` format from the emoji list):

```
${HOME}/.agents/skills/react-message/scripts/react-message.ts \
  --session-id "$SESSION_ID" \
  --emoji ":custom_emoji_name:"
```
