---
name: memory-save
type: shell
description: |
  Save important information to persistent memory for future conversations.
  Memory is append-only and cannot be deleted, only disabled.
parameters:
  - name: session-id
    type: string
    required: true
    flag: --session-id
  - name: content
    type: string
    required: true
    flag: --content
    description: The memory content to save (plain text)
  - name: visibility
    type: string
    flag: --visibility
    default: public
    enum: [public, private]
  - name: importance
    type: string
    flag: --importance
    default: normal
    enum: [high, normal]
output:
  format: json
---

# Memory Save Skill

Save important information that should persist across conversations.

## Usage

```bash
deno run --allow-net /home/deno/.copilot/skills/memory-save/skill.ts \
  --session-id "$SESSION_ID" \
  --content "User prefers formal communication" \
  --importance high
```

## Parameters

- `--content`: (Required) The memory content to save
- `--visibility`: `public` (default) or `private`
- `--importance`: `normal` (default) or `high`

## Output

```json
{
  "success": true,
  "data": { "id": "mem_xxx", "content": "...", "visibility": "public", "importance": "normal" }
}
```
