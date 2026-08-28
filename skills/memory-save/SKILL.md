---
name: memory-save
description: Save information to persistent cross-conversation memory. Call this skill to save important information you learned. You MUST NOT manually modify the memory files.
allowed-tools: Bash
---

# Memory Save Skill

Save important information that should persist across conversations.

## Usage

**Two-step flow — the memory content MUST NOT appear on the command line.**

1. Write the memory content to a payload file under the session staging directory using your **edit/write tool**:

   ```
   $TMPDIR/$SESSION_ID/content.md
   ```

   The `$TMPDIR` / `$SESSION_ID` tokens in that path are expanded by the ACP path boundary, so the write is approved and the text bytes are preserved **verbatim** (no shell expansion). `$TMPDIR/$SESSION_ID/` is the per-spawn form of the staging directory; in shared-process deployments the staging directory is shown in your system prompt and the script resolves it automatically.

2. Invoke the script with the payload file path:

   ```bash
   ${HOME}/.agents/skills/memory-save/scripts/memory-save.ts \
     --session-id "$SESSION_ID" \
     --content-file "$TMPDIR/$SESSION_ID/content.md" \
     --importance high
   ```

**WARNING**: Never put memory content on the command line. The legacy `--content "..."` / `--content=...` flag is REMOVED: the shell expands `$VAR` in it, which corrupts stored memory and can leak environment variables.

## Parameters

- `--content-file`: (Required) Path of the payload file containing the memory content. Log what you learned and what you feel. You don't need to stick only to objective descriptions. Write in a relaxed way, using YOUR character's perspective and subjective descriptions.
- `--importance`: `normal` (default) or `high`. High importance memories are for user preferences, critical facts, or information that should be prioritized in recall. Normal importance is for general information that is not important or will be out of date soon.
- `--tier`: (Optional) `core`, `working`, or `archive` (default: `archive`). Core memories are persistent identity facts (never decay). Working memories are active context. Archive memories are long-term storage subject to decay.
- `--category`: (Optional) `fact`, `preference`, `episode`, `summary`, or `relationship` (default: `fact`). Classifies the type of information being stored.
- `--scope`: (Optional) `user` or `channel` (default: `user`). When `channel`, saves to channel-scoped memory instead of user-scoped memory.
- `--decay`: (Optional) 0.0–1.0 importance-weighted temporal relevance. Defaults are based on tier: core=1.0 (no decay), working=0.8, archive=0.5. Lower values indicate less current relevance.
- `--related-to`: (Optional) Comma-separated IDs of semantically related memories
- `--supersedes`: (Optional) Comma-separated IDs of memories this new memory replaces

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes: `SKILL_LEGACY_FLAG` (you used the removed `--content` flag — stage the text in `$TMPDIR/$SESSION_ID/content.md` and use `--content-file`), `SKILL_MISSING_PAYLOAD` (no `--content-file` given), `SKILL_PAYLOAD_OUT_OF_BOUNDS` (payload path outside `$TMPDIR/$SESSION_ID/`), `SKILL_PAYLOAD_NOT_FOUND` (payload file not written yet — write it first with the edit/write tool).

## Notes

- **Visibility is auto-determined**: DM conversations save to private memory, public conversations (guild/thread) save to public memory. You do NOT need to specify visibility.

## Critical Rules

1. **Timeout**: The script won't run for more than 30 seconds. If it hangs, do stop_bash and do not retry, return an error message in JSON format.
