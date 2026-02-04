---
name: memory-search
type: shell
description: Search through saved memories using keywords.
parameters:
  - name: session-id
    type: string
    required: true
    flag: --session-id
  - name: query
    type: string
    required: true
    flag: --query
    description: Search query keywords
  - name: limit
    type: number
    flag: --limit
    default: 10
    description: Maximum number of results to return
output:
  format: json
---

# Memory Search Skill

Search through saved memories to retrieve relevant information.

## Usage

```bash
deno run --allow-net /home/deno/.copilot/skills/memory-search/skill.ts \
  --session-id "$SESSION_ID" \
  --query "hiking preferences" \
  --limit 10
```

## Output

```json
{
  "success": true,
  "data": {
    "memories": [
      {
        "id": "mem_xxx",
        "content": "User loves hiking in the mountains",
        "visibility": "public",
        "importance": "high",
        "timestamp": "2024-01-01T12:00:00Z"
      }
    ]
  }
}
```
