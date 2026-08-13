---
name: fetch-context
description: Fetch additional context from the platform, including recent messages, search through conversation history, or get user information. Use when you need more context than what's provided initially.
allowed-tools: Bash
---

# Fetch Context Skill

Retrieve additional context from the platform to better understand the conversation.

## Usage

The `search_messages` query is OPTIONAL per type. When present, it MUST NOT appear on the command line — use the two-step payload-file flow:

1. Write the query text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/query.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion).

2. Invoke the script with the payload file path:

   ```bash
   # Get recent messages
   ${HOME}/.agents/skills/fetch-context/scripts/fetch-context.ts \
     --session-id "$SESSION_ID" \
     --type recent_messages \
     --limit 20

   # Search messages
   ${HOME}/.agents/skills/fetch-context/scripts/fetch-context.ts \
     --session-id "$SESSION_ID" \
     --type search_messages \
     --query-file "$TMPDIR/$SESSION_ID/query.md" \
     --limit 10
   ```

**WARNING**: Never put the query on the command line. The legacy `--query "..."` / `--query=...` flag is REMOVED: the shell expands `$VAR` in it, which corrupts the search and can leak environment variables.

## Available Types

- `recent_messages`: Get more recent message history (no query needed)
- `search_messages`: Search for messages by keyword (query passed via `--query-file`)
- `user_info`: Get information about the current user

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_LEGACY_FLAG` (you used the removed `--query` flag — stage the text in `$TMPDIR/$SESSION_ID/query.md` and use `--query-file`), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
