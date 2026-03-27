---
name: memory-save
description: Save information to persistent cross-conversation memory. Call this in every conversation. Always use this skill to save any information you learn. You MUST NOT manually modify the memory files.
allowed-tools: Bash
---

# Memory Save Skill

Save important information that should persist across conversations.

## Usage

```bash
${HOME}/.agents/skills/memory-save/scripts/memory-save.ts \
  --session-id "$SESSION_ID" \
  --content "User prefers formal communication" \
  --importance high
```

## Parameters

- `--content`: (Required) The memory content to save. Log what you learned and what you feel. You don't need to stick only to objective descriptions. Write in a relaxed way, using YOUR character's perspective and subjective descriptions.
- `--importance`: `normal` (default) or `high`. High importance memories are for user preferences, critical facts, or information that should be prioritized in recall. Normal importance is for general information that is not important or will be out of date soon.
- `--tier`: (Optional) `core`, `working`, or `archive` (default: `archive`). Core memories are persistent identity facts (never decay). Working memories are active context. Archive memories are long-term storage subject to decay.
- `--category`: (Optional) `fact`, `preference`, `episode`, `summary`, or `relationship` (default: `fact`). Classifies the type of information being stored.
- `--scope`: (Optional) `user` or `channel` (default: `user`). When `channel`, saves to channel-scoped memory instead of user-scoped memory.
- `--decay`: (Optional) 0.0–1.0 importance-weighted temporal relevance. Defaults are based on tier: core=1.0 (no decay), working=0.8, archive=0.5. Lower values indicate less current relevance.
- `--related-to`: (Optional) Comma-separated IDs of semantically related memories
- `--supersedes`: (Optional) Comma-separated IDs of memories this new memory replaces

## Notes

- **Visibility is auto-determined**: DM conversations save to private memory, public conversations (guild/thread) save to public memory. You do NOT need to specify visibility.

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
