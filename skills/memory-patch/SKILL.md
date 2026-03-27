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

# Mark a memory as superseding others (maintenance lineage)
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_new_summary" \
  --supersedes "mem_old1,mem_old2,mem_old3"

# Add related memory links
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_abc123" \
  --related-to "mem_def456,mem_ghi789"

# Change tier and category
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_abc123" \
  --tier core \
  --category preference

# Adjust decay value
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_abc123" \
  --decay 0.9
```

## Capabilities

- Enable/disable memories (use --enabled or --disabled flag)
- Change visibility level
- Adjust importance level
- Change memory tier (--tier: `core`, `working`, or `archive`)
- Change memory category (--category: `fact`, `preference`, `episode`, `summary`, or `relationship`)
- Adjust decay value (--decay: 0.0–1.0; ignored for core tier which always has decay=1.0)
- Link related memories (--related-to, comma-separated IDs)
- Mark supersession lineage (--supersedes, comma-separated IDs)

## Limitations

- **Cannot modify content** - content is immutable
- **Cannot delete** - can only disable

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
