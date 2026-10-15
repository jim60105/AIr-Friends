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
4. **Timeout**: The script won't run for more than 30 seconds. If it hangs, cancel the running command with the running-command controls your agent documents (if any).
5. **Copy the platform's reaction value verbatim**: The emoji context renders each custom emoji as `<e><t>…</t><r>…</r></e>`. The `<r>` value is the exact string this platform accepts in `--emoji` (the same value the platform adapter publishes as `useAsReaction`). Copy that value as-is — never re-encode it as `<t>` text markup, and never invent a value that is not in the list. For standard Unicode emojis, use the emoji character directly (e.g., "👍", "❤️").
6. **Platform restrictions still apply**: An entry annotated `(reaction restricted: …)` may be rejected by the platform, stored as a different reaction, or be unusable for this account. Passing the exact supplied value does not bypass those platform restrictions.
7. **React only ONCE**: Never use this skill more than once. Each time you trigger a reaction, it will replace the previous one, as only one reaction can be displayed at a time. Think carefully and choose just one reaction.

## Usage

> The placeholder `<skill root rendered in your system prompt>` is the absolute skill-script root rendered in your system prompt: substitute that literal root before invoking — never run this command with the placeholder, a `$HOME` expression, or any other root.

```
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji "👍"
```

**`--session-id`**: Pass the literal session id rendered in your system prompt. The rendered id is authoritative in every deployment shape: the agent environment may carry no session identity at all (shared agent processes have none), the skill library resolves the owning session automatically, and a mismatched value is never honored.

**`--emoji`**: Pass the literal reaction value for this platform: the `<r>` value of the chosen emoji-list entry, or the Unicode character itself.

### Examples

React with a Unicode emoji:

```
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji "❤️"
```

React with a Discord custom emoji. Its `<r>` value is `name:id` (the fixture values below are
examples — substitute the `<r>` value your emoji list actually renders):

```
# Emoji list entry: <e><t><:wave:123456789012345678></t><r>wave:123456789012345678</r></e>
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji "wave:123456789012345678"
```

An animated Discord emoji carries the same `name:id` reaction value; only the `<t>` markup
differs (`<e><t><a:wave:123456789012345678></t><r>wave:123456789012345678</r></e>`).

React with a Misskey custom emoji. Its `<r>` value is `:name:`:

```
# Emoji list entry: <e><t>:wave:</t><r>:wave:</r></e>
<skill root rendered in your system prompt>/react-message/scripts/react-message.ts \
  --session-id "<session id rendered in your system prompt>" \
  --emoji ":wave:"
```

The forms are platform-specific: Discord does not accept `:name:`, and Misskey does not accept
`name:id`. Never convert one platform's value into the other's syntax.
