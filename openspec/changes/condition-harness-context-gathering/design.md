# Design

## Context

See [proposal.md](proposal.md) for motivation and [the delta](specs/prompt-template-system/spec.md) for the contract. `prompts/system_reply.md:102` already conditions memory search on missing context or an explicit recall request. Lines 104 and 124 override that decision with unconditional gathering. Lines 123 and 129 demand narration. `system_spontaneous.md:47` and `system_web_chat.md:40` contain equivalent narration mandates.

The trace `tmp/export-8df2b0a92efb1fb.clef` covers two user sessions and summary phases. At 22:05:14 the agent says the initial greeting context suffices, then cites “Always use skills” as its reason to search and inspect workspace notes/journal. At 22:05:40 it reports irrelevant search results and adequate existing context. These observations support removing the contradiction; they do not establish general latency or model-quality claims.

## Goals / Non-Goals

The design keeps the existing instruction owners and reduces repeated text. It does not add a relevance classifier, retrieval quota, short-message branch, model switch or tool wrapper. It leaves initial-context assembly and automatic fast recall unchanged. Required work in research, summary, maintenance and reminder sessions remains intact.

## Decisions

### Keep the retrieval decision in the existing memory section

Revise the first reply instruction to state that adequate supplied context needs no extra gathering. Keep the existing recall triggers and category/scope options. Tie additional workspace/browser reads to an identified information need. Delete the later unconditional gathering bullet and its duplicate critical rule rather than introducing a new shared fragment.

Character/personality fragments remain unchanged. Keep the reminder to review tone and content before delivery without demanding narration. Preserve memory correction and relevant saving guidance. Removing all memory guidance would discard useful recall behavior; retaining a second condensed gathering rule would permit another contradiction.

### Audit the delivered template paths

Normal replies and channel-lurk replies use the configured reply template through context assembly. Spontaneous delivery re-renders `system_spontaneous.md` in `SessionOrchestrator.buildSpontaneousPromptFromTemplate`. Dashboard first-turn assembly loads `system_web_chat.md` in `src/dashboard/server.ts`. Remove narration in each owning conversational section without changing these callsites.

The audit also found task-specific instructions in self-research/reminder/summary templates, plus OMP-only shell guidance in `agent_permissions.md`. They need no gathering-policy edits. Leave `system_prompt_override.md` free of OMP additions, and do not copy the existing OMP shell section into conversational templates. Restricted-only gating must not hide existing OMP guidance from YOLO.

### Test instructions rather than model internals

Extend existing template tests and the existing delivered prompt-path fixtures where available. Render OpenCode/OMP with restricted/YOLO variables for reply and spontaneous paths; exercise the dashboard template separately. Assert a single conditional retrieval rule, preserved recall triggers and delivery instructions, absence of compulsory narration, and unchanged dashboard skill prohibition. Include adequate greeting context and a missing-history request as fixtures. These are instruction-contract tests, not proof of future model tool choices.

## Risks / Trade-offs

Removing blanket gathering can reduce incidental context discovery. The explicit missing-history and recall rules retain deliberate retrieval. Removing narration does not control the model's internal reasoning, so acceptance concerns authored instructions alone. Mounted custom templates can retain older wording; this change updates bundled defaults without a migration or compatibility layer.
