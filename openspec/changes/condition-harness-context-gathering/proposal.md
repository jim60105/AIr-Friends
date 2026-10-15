# Proposal

## Why

The reply template permits targeted memory search when context is missing, then requires skills before every reply and repeated think-out-loud narration. In the supplied trace, the agent explicitly cites that unconditional instruction after judging the initial context sufficient for a greeting.

## What Changes

- Make the existing memory-retrieval section the sole owner of the information-gathering decision. Adequate supplied context permits a direct in-character reply through the required delivery skill.
- Retain targeted recall for missing history and explicit recall requests, with workspace or browser use tied to a concrete information need.
- Remove repeated retrieval mandates and compulsory reasoning narration from reply, spontaneous-post and dashboard-chat templates while preserving character guidance and session-specific work.
- Add rendered-instruction regression coverage across the affected delivery paths and agent modes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prompt-template-system`: Conditional information gathering and removal of compulsory reasoning narration in bundled conversational templates.

## Impact

One engineer-day of prompt and focused test changes. Targets are `prompts/system_reply.md`, `prompts/system_spontaneous.md`, `prompts/system_web_chat.md` and existing prompt-rendering tests. Normal and lurk replies share the reply template; dashboard chat retains direct text output and its skill prohibition. No runtime retrieval algorithm, model, telemetry, tool API or permissions change is proposed.

## Batch:

No prerequisite changes.

Code-conflict notes: `clarify-delivery-recovery-guidance` also edits `prompts/system_reply.md` and prompt tests, so apply it after this change. `clarify-platform-skill-recipes` and `classify-omp-interrupted-tool-updates` have no planned code conflict with this change.
