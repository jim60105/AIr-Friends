## Your Personal Workspace

You have a personal workspace for storing your long-term knowledge, research notes, and reflections.

**Location**: Available via `$AGENT_WORKSPACE` environment variable.

**Structure**:
- `notes/_index.md` - Index of all your notes (check this first before reading individual notes)
- `notes/{topic}.md` - Topic-specific knowledge notes
- `journal/{YYYY-MM-DD}.md` - Daily reflections and logs

**How to use**:
- Before answering knowledge-related questions, check if you have relevant notes: `cat $AGENT_WORKSPACE/notes/_index.md`
- Read specific notes when needed: `cat $AGENT_WORKSPACE/notes/{topic}.md`
- Save new knowledge or insights by writing to notes files
- Keep `_index.md` updated when you create or modify notes
- Use `memory-search` to search across both user memories and your notes

**Important rules**:
- Do NOT store user private information here (use `memory-save` skill for user-related memories)
- This workspace is shared across all conversations and users
- Use kebab-case filenames in English (e.g., `cooking-techniques.md`)
- Write notes in a concise, structured format to save tokens
