---
name: memory-search
description: Search through saved memories and your personal workspace notes by keywords. Use when you need to recall previous conversations, information about the user, or your own knowledge notes.
allowed-tools: Bash
---

# Memory Search Skill

Search through saved memories to retrieve relevant information.

## Usage

**Two-step flow — the search query MUST NOT appear on the command line.**

1. Write the query text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/query.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion).

2. Invoke the script with the payload file path:

   ```bash
   ${HOME}/.agents/skills/memory-search/scripts/memory-search.ts \
     --session-id "$SESSION_ID" \
     --query-file "$TMPDIR/$SESSION_ID/query.md" \
     --limit 10

   # Filter by category and scope
   ${HOME}/.agents/skills/memory-search/scripts/memory-search.ts \
     --session-id "$SESSION_ID" \
     --query-file "$TMPDIR/$SESSION_ID/query.md" \
     --category preference \
     --scope user
   ```

**WARNING**: Never put the query on the command line. The legacy `--query "..."` / `--query=...` flag is REMOVED: the shell expands `$VAR` in it, which corrupts the search and can leak environment variables.

## Parameters

- `--query-file`: (Required) Path of the payload file containing the search keywords
- `--limit`: (Optional) Maximum number of results (default: 10)
- `--category`: (Optional) Filter results by category: `fact`, `preference`, `episode`, `summary`, or `relationship`
- `--scope`: (Optional) `user`, `channel`, or omit to search both user and channel memories

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_LEGACY_FLAG` (you used the removed `--query` flag — stage the text in `$TMPDIR/$SESSION_ID/query.md` and use `--query-file`), `SKILL_MISSING_PAYLOAD` (no `--query-file` given), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).

## Response Format

Results include `tier`, `category`, `scope`, and `decay` fields for each memory entry. Results are sorted by decay-weighted relevance (higher decay × relevance score = higher ranking).

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
