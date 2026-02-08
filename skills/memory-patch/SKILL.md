---
name: memory-patch
description: Modify memory metadata (visibility, importance) or disable memories. Use when you need to update the status of existing memories. You MUST use this skill to modify memory metadata, you MUST NOT manually modify the memory files.
allowed-tools: Bash
---

# Memory Patch Skill

Modify metadata of existing memories without changing content.

## Usage

```bash
# Disable a memory
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_abc123" \
  --disabled

# Change importance
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_abc123" \
  --importance high
```

## Capabilities

- Enable/disable memories (use --enabled or --disabled flag)
- Change visibility level
- Adjust importance level

## Limitations

- **Cannot modify content** - content is immutable
- **Cannot delete** - can only disable

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
