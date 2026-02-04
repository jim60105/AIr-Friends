---
name: memory-patch
type: shell
description: |
  Modify the state of an existing memory (enable/disable, change visibility/importance).
  Cannot modify the content - only metadata. Memories cannot be deleted, only disabled.
parameters:
  - name: session-id
    type: string
    required: true
    flag: --session-id
  - name: memory-id
    type: string
    required: true
    flag: --memory-id
    description: The ID of the memory to modify
  - name: enabled
    type: boolean
    flag: --enabled
    description: Enable the memory (use --enabled flag)
  - name: disabled
    type: boolean
    flag: --disabled
    description: Disable the memory (use --disabled flag)
  - name: visibility
    type: string
    flag: --visibility
    enum: [public, private]
  - name: importance
    type: string
    flag: --importance
    enum: [high, normal]
output:
  format: json
---

# Memory Patch Skill

Modify metadata of existing memories without changing content.

## Usage

```bash
# Disable a memory
deno run --allow-net /home/deno/.copilot/skills/memory-patch/skill.ts \
  --session-id "$SESSION_ID" \
  --memory-id "mem_abc123" \
  --disabled

# Change importance
deno run --allow-net /home/deno/.copilot/skills/memory-patch/skill.ts \
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

## Output

```json
{ "success": true, "data": { "id": "mem_abc123", "enabled": false } }
```
