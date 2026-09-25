## Why

Relevant long-term memories reach the Main LLM only if the agent decides to call `memory-search`, and it often answers without doing so. With a calibrated engine and bounded fixed injection in place, every triggered turn can carry a small, high-confidence Fast Recall section.

This is change 7 of 9. It depends on `memory-recall-calibration` (calibrated thresholds) and `memory-fixed-budgets` (the injected-id exclusion set).

## What Changes

- Every triggered session runs Fast Recall once, using the trigger message and the same user's previous message after the last `/clear`, and excluding memories already injected by fixed loading.
- A "Relevant Memory" sub-section and an unverified, attributed "Relevant Channel Notes" sub-section are rendered right after the fixed memories. The whole section is omitted when nothing is selected.
- Fast Recall is skipped for spontaneous contexts and when `memory.recall.fastRecallEnabled` is `false`. Any failure is logged and the session proceeds without the section.
- `prompts/system_reply.md` describes Fast Recall and when to escalate to `memory-search`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: Adds "Fast Recall in Initial Context".
- `memory-recall`: Adds "Fast Recall Prompt Section" and "Fast Recall Failure Isolation".
- `channel-memory`: Adds "Channel Memory Framing in Fast Recall".
- `configuration-and-deployment`: Adds "Fast Recall Toggle Configuration".

## Impact

- **Code**:
  - `src/core/memory-recall/fast-recall.ts` (renderer).
  - `src/core/context-assembler.ts` (optional retriever argument, previous-message lookup, Fast Recall call and rendering, an optional `agentWorkspacePath` parameter reserved for `note-fast-recall`).
  - `src/core/agent-core.ts` (passes the shared retriever).
  - `src/core/session-orchestrator.ts` (passes `agentWorkspacePath`).
  - Config types and loader.
- **Prompts and docs**: `prompts/system_reply.md`, `config.example.yaml`, `docs/MEMORY_DESIGN.md`, `AGENTS.md`.
- **Tests**: context-assembler tests for exclusion, placement, `/clear`, disabled mode, spontaneous mode and failure isolation.
