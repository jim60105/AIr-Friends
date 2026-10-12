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
6. **React only ONCE**: Never use this skill more than once. Each time you trigger a reaction, it will replace the previous one, as only one reaction can be displayed at a time. Think carefully and choose just one reaction.

## Usage

> The placeholder `<skill root rendered in your system prompt>` is the absolute skill-script root rendered in your system prompt: substitute that literal root before invoking — never run this command with the placeholder, a `$HOME` expression, or any other root.

```
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji "👍"
```

**`--session-id`**: Pass the literal session id rendered in your system prompt. The rendered id is authoritative in every deployment shape: the agent environment may carry no session identity at all (shared agent processes have none), the skill library resolves the owning session automatically, and a mismatched value is never honored.

### Examples

React with a Unicode emoji:

```
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji "❤️"
```

React with a custom platform emoji (use the `useAsReaction` format from the emoji list):

```
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji ":custom_emoji_name:"
```
