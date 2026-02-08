---
name: memory-save
description: Save important information to persistent cross-conversation memory. Use when you learn something important about the user or context that should be remembered for future conversations. You MUST use this skill to save any information you want to recall later, you MUST NOT manually modify the memory files.
allowed-tools: Bash
---

# Memory Save Skill

Save important information that should persist across conversations.

## Usage

```bash
${HOME}/.agents/skills/memory-save/scripts/memory-save.ts \
  --session-id "$SESSION_ID" \
  --content "User prefers formal communication" \
  --importance high
```

## Parameters

- `--content`: (Required) The memory content to save
- `--importance`: `normal` (default) or `high`

## Notes

- **Visibility is auto-determined**: DM conversations save to private memory, public conversations (guild/thread) save to public memory. You do NOT need to specify visibility.

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
