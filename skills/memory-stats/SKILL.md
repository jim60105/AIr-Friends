---
name: memory-stats
description: Get memory statistics for the current workspace. Returns counts of total, enabled, disabled, high-importance, and normal-importance memories.
allowed-tools: Bash
---

# Memory Stats Skill

Get statistics about saved memories in the current workspace.

## Usage

```bash
${HOME}/.agents/skills/memory-stats/scripts/memory-stats.ts \
  --session-id "$SESSION_ID"
```

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
