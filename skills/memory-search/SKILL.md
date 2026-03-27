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

# Filter by category and scope
${HOME}/.agents/skills/memory-search/scripts/memory-search.ts \
  --session-id "$SESSION_ID" \
  --query "favorite food" \
  --category preference \
  --scope user
```

## Parameters

- `--query`: (Required) Search keywords
- `--limit`: (Optional) Maximum number of results (default: 10)
- `--category`: (Optional) Filter results by category: `fact`, `preference`, `episode`, `summary`, or `relationship`
- `--scope`: (Optional) `user`, `channel`, or omit to search both user and channel memories

## Response Format

Results include `tier`, `category`, `scope`, and `decay` fields for each memory entry. Results are sorted by decay-weighted relevance (higher decay × relevance score = higher ranking).

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
