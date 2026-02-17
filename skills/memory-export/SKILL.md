---
name: memory-export
description: Export all memories for the current user as a file. The file is sent directly via private message (DM) to the user, regardless of where the request was made. Use ONLY when the user explicitly requests to export their memories, and ONLY after confirming with the user.
allowed-tools: Bash
---

# Memory Export Skill

Export the current user's memories as a file attachment, sent via DM.

## Critical Rules

1. **User consent required**: Only execute this skill when the user **explicitly** requests to see or export their memories.
2. **Confirm before executing**: Before executing, you MUST ask the user to confirm via send-reply. Execute this skill only in the **next session** after receiving user confirmation (you will see the confirmation in conversation history).
3. **Privacy**: This exports the user's own memories only. It will never include other users' data or your personal notes from the agent workspace.
4. **DM delivery**: The export file is always sent via private message (DM), even if the user made the request in a public channel. You do NOT need to use send-reply to deliver the file.
5. **After export**: Use send-reply to inform the user that the export has been sent to their DM (e.g., "已匯出 N 筆記憶，請查收私訊。").
6. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.

## Usage

```
${HOME}/.agents/skills/memory-export/scripts/memory-export.ts \
  --session-id "$SESSION_ID" \
  --format markdown
```

## Parameters

- `--format`: Output format. `markdown` (default) or `json`
- `--importance`: Filter by importance. `high`, `normal`, or `all` (default: `all`)
- `--enabled-only`: Only include enabled memories. `true` (default) or `false`
