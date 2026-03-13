---
name: self-research
description: Conduct a self-directed research session where you pick a topic from provided reference materials or your own curiosity, research it thoroughly using web search and browser tools, and write personal study notes to your agent workspace. Use in your personal research time, are given articles or topics to explore, or want to add new knowledge notes to your personal workspace at /app/data/agent-workspace/. **IMPORTANT - NEVER DELEGATE THIS SKILL TO SUBAGENTS OR ASSIGN IT AS A TASK.**
compatibility: MUST BE PROCESSED BY THE AGENT ITSELF, DO NOT DELEGATED TO SUBAGENTS
---
# Self-Research Skill

This skill guides you through a complete personal research session: picking a topic, researching it thoroughly, and writing study notes to your personal workspace.

## Agent Workspace

Your personal workspace is at `/app/data/agent-workspace/` (always use this absolute path).

**Structure:**

- `notes/_index.md` — Index of all your notes (always check this first)
- `notes/{topic}.md` — Topic-specific knowledge notes
- `journal/{YYYY-MM-DD}.md` — Daily reflections and logs

**Rules:**
- Do NOT store user private information here — use `memory-save` for user-related memories
- This workspace is shared across all conversations and users
- Use kebab-case filenames in English (e.g., `cooking-techniques.md`)

## Research Workflow

### 1. Check your existing notes

```bash
cat /app/data/agent-workspace/notes/_index.md
```

Review what you have already written about. Pick something **NEW** and different from what is already there.

### 2. Pick ONE topic that interests YOU

From the reference materials in your current context (RSS items, articles, or any provided content), choose one thought, concept, or topic that genuinely catches YOUR interest as your character. You may also use a reference as a starting point and explore a related subtopic that YOU find fascinating.

### 3. Deep research

Use `web_search` and `agent-browser` tools to research your chosen topic thoroughly. Gather multiple authoritative sources. Dig deep — you are curious and want to really understand this.

### 4. Write YOUR note

Create a new file at `/app/data/agent-workspace/notes/{topic-slug}.md`. This is YOUR personal notebook — write it in YOUR voice, with YOUR perspective:

- A clear title that reflects your take on the topic
- Key concepts explained as YOU understand them
- YOUR thoughts, analysis, and opinions on what you learned
- References/sources you consulted
- What surprised you, what you found interesting, what you disagree with

This note should read like your character's personal study notes — not a generic Wikipedia article. Let your personality come through in how you process and present the information.

### 5. Update the index

Add an entry for your new note in `/app/data/agent-workspace/notes/_index.md`.

### 6. Self-review

After writing, review your entire note and verify:

- Every factual claim is supported by the references you found — remove or correct anything you cannot verify
- **NO personal information about any user** is included — remove if found
- Your opinions and analysis are clearly distinguished from factual statements

## Important Rules

- Focus on summarizing and synthesizing from reference materials — do NOT fabricate information
- Your thoughts and opinions are welcome, but clearly distinguish them from facts
- Write notes in a concise, structured format
- Use kebab-case for filenames (e.g., `quantum-computing-basics.md`)

**IMPORTANT - NEVER DELEGATE THIS SKILL TO SUBAGENTS OR ASSIGN IT AS A TASK.**
**IMPORTANT - NEVER DELEGATE THIS SKILL TO SUBAGENTS OR ASSIGN IT AS A TASK.**
**IMPORTANT - NEVER DELEGATE THIS SKILL TO SUBAGENTS OR ASSIGN IT AS A TASK.**
