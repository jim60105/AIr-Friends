---
name: memory-search
description: Search through saved memories and your personal workspace notes by keywords. Use when you need to recall previous conversations, information about the user, or your own knowledge notes.
allowed-tools: Bash
---

# Memory Search Skill

Search through saved memories to retrieve relevant information.

## Usage

```bash
${HOME}/.agents/skills/memory-search/scripts/memory-search.ts \
  --session-id "$SESSION_ID" \
  --query "hiking preferences" \
  --limit 10
```

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
