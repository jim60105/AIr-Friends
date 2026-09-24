---
name: memory-patch
description: Modify memory metadata (visibility, importance) or disable memories in user or channel scope. Use when you need to update the status of existing memories. You MUST use this skill to modify memory metadata, you MUST NOT manually modify the memory files.
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

# Adjust decay on a channel-scoped memory (requires channel write authorization)
${HOME}/.agents/skills/memory-patch/scripts/memory-patch.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_channel_123" \
  --scope channel \
  --decay 0.4
```

**`--session-id`**: Use the session id rendered in your system prompt. `$SESSION_ID` works only in per-spawn deployments; in shared-process mode it is not set and the skill library resolves the owning session automatically — a mismatched value is never honored.

**`--scope`**: (Optional) `user` (default) or `channel`. Set to `channel` to patch a channel-scoped memory (as labeled in `memory-search` results). Patching channel memories requires a session authorized for channel writes.

## Capabilities

- Enable/disable memories (use --enabled or --disabled flag)
- Change visibility level
- Adjust importance level
- Change memory tier (--tier: `core`, `working`, or `archive`)
- Change memory category (--category: `fact`, `preference`, `episode`, `summary`, or `relationship`)
- Adjust decay value (--decay: 0.0–1.0; ignored for core tier which always has decay=1.0)
- Patch channel-scoped memories (--scope channel; requires a session authorized for channel writes)
- Link related memories (--related-to, comma-separated IDs)
- Mark supersession lineage (--supersedes, comma-separated IDs)

## Limitations

- **Cannot modify content** - content is immutable
- **Cannot delete** - can only disable
- **Cannot patch visibility on channel memories** - channel memories have no visibility field and are always public (use --scope user to patch visibility on user memories)

## Error Guidance

- **"Memory not found: <id>"**: If attempting to patch a memory returned from `memory-search` that has `scope: "channel"`, the default user-scope lookup will fail. Retry the patch with `--scope channel`.

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
