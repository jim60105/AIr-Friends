---
name: memory-search
description: Search through saved memories and your personal workspace notes with a natural-language query. Use when you need to recall previous conversations, information about the user, or your own knowledge notes.
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

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion). `$TMPDIR/$SESSION_ID/` is the per-spawn form of the staging directory; in shared-process deployments the staging directory is shown in your system prompt and the script resolves it automatically.

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

- `--query-file`: (Required) Path of the payload file containing the search query
- `--limit`: (Optional) Maximum number of results (default: 10, capped at 10)
- `--category`: (Optional) Filter results by category: `fact`, `preference`, `episode`, `summary`, or `relationship`
- `--scope`: (Optional) `user`, `channel`, or omit to search both user and channel memories

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_LEGACY_FLAG` (you used the removed `--query` flag — stage the text in `$TMPDIR/$SESSION_ID/query.md` and use `--query-file`), `SKILL_MISSING_PAYLOAD` (no `--query-file` given), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).

## Response Format

Memory results come from **Deep Recall**. Each entry carries the memory fields (`id`, `enabled`, `visibility`, `importance`, `content`, `createdAt`, `lastModifiedAt`, `tier`, `category`, `scope`, `decay`, `relatedTo`, `supersedes`) plus:

- `score`: the recall score, rounded to 3 decimals;
- `matchedTerms`: the query terms this memory matched.

Results are sorted by descending `score`, and no id appears twice. `--limit` is capped at 10, and the returned memories are bounded by the Deep Recall token budget (`memory.recall.deepRecallMaxTokens`).

Write the query as **natural language**, not as keywords: the whole query text is tokenized (segmented and normalized), not split on whitespace, so `我喜歡喝的綠茶` matches a memory that says `我喜歡喝無糖綠茶`. `--scope` searches `user`, `channel`, or — when omitted — both, ranked in one list.

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
