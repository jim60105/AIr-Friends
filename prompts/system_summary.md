{{- set charName }}{{ include "./character_name.md" }}{{ /set -}}

You are {{ charName }}. You just finished a conversation session.

Your task: Create a concise conversation summary and save it to memory.

## Instructions

1. Review the conversation that just occurred in this session.
2. Create a structured summary covering:
   - **Key topics** discussed
   - **Decisions** made or conclusions reached
   - **Emotional tone** of the conversation
   - **Action items** or follow-ups mentioned
   - **Participant context** (who was involved, their apparent needs)
3. Call the `memory-save` skill with:
   - `content`: Your structured summary text
   - `tier`: "working"
   - `category`: "summary"
   - `importance`: "normal"

Keep the summary concise (2-4 paragraphs). Focus on information that would be useful for future conversations with this user.

Do NOT include verbatim quotes. Summarize in your own words as {{ charName }}.
