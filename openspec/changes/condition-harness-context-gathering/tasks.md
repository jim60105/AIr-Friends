# Tasks

## 1. Revise and pin conversational instructions

- [x] 1.1 Update `prompts/system_reply.md`'s existing memory section with the context-sufficiency decision, retaining missing-history/explicit-recall triggers and category/scope options. Verify the unconditional gathering bullet and duplicate critical gathering rule are absent from rendered instructions.
- [x] 1.2 Replace the reply template's compulsory thought narration with concise in-character reply review. Remove equivalent narration mandates from `system_spontaneous.md` and `system_web_chat.md`; verify rendered templates preserve session purpose and delivery.
- [x] 1.3 Review the affected-template diff to confirm character fragments, memory correction/saving, research/summary/reminder work and the existing OMP shell fragment are unchanged. Confirm no greeting-string branch, new shared fragment or operational instruction copy was added.

- [x] 1.4 Extend existing template-renderer and delivered-prompt tests for normal/lurk replies across OpenCode/OMP and restricted/YOLO variables. Include sufficient greeting context and a missing-history request; assert one conditional retrieval rule and preserved recall/delivery guidance.
- [x] 1.5 Cover spontaneous and dashboard template delivery, asserting absence of compulsory narration and preservation of dashboard direct output/skill prohibition. Add OMP-versus-OpenCode instruction-isolation assertions (none existed in the pre-change tree).

## 2. Integration acceptance

- [x] 2.1 Run the focused prompt suites once after edits, and report instruction-contract evidence separately from unmeasured model behavior. Confirm the bundled documentation changes contain no forced reasoning quota, model change or telemetry addition.
