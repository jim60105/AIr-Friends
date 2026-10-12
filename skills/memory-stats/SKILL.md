---
name: memory-stats
description: Get memory statistics for the current workspace. Returns counts of total, enabled, disabled, high-importance, and normal-importance memories.
allowed-tools: Bash
---

# Memory Stats Skill

Get statistics about saved memories in the current workspace.

## Usage

> The placeholder `<skill root rendered in your system prompt>` is the absolute skill-script root rendered in your system prompt: substitute that literal root before invoking — never run this command with the placeholder, a `$HOME` expression, or any other root.

```bash
<skill root rendered in your system prompt>/memory-stats/scripts/memory-stats.ts \
  --session-id "<session id rendered in your system prompt>"
```

**`--session-id`**: Pass the literal session id rendered in your system prompt. The rendered id is authoritative in every deployment shape: the agent environment may carry no session identity at all (shared agent processes have none), the skill library resolves the owning session automatically, and a mismatched value is never honored.

## Response Format

Stats include:

- Per-tier breakdown (core/working/archive counts)
- Per-category breakdown (fact/preference/episode/summary/relationship counts)
- Channel memory counts when available

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
