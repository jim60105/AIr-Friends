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

**`--session-id`**: Use the session id rendered in your system prompt. `$SESSION_ID` works only in per-spawn deployments; in shared-process mode it is not set and the skill library resolves the owning session automatically — a mismatched value is never honored.

## Response Format

Stats include:

- Per-tier breakdown (core/working/archive counts)
- Per-category breakdown (fact/preference/episode/summary/relationship counts)
- Channel memory counts when available

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
