## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, sections 8 and 11. After `memory-fixed-budgets`, `assembleContext()` selects fixed memories through `selectFixedMemories()`, which returns `injectedIds`. `formatContext()` renders the fixed sections, then the conversation.

## Goals / Non-Goals

**Goals:**

- Add Fast Recall with zero effect on the reply path when it returns nothing or fails.

**Non-Goals:**

- Note pointers (`note-fast-recall`).
- Fixed budgets (`memory-fixed-budgets`).

## Decisions

- **Retriever injection**: `ContextAssembler` takes an optional `MemoryRetriever`. When it is omitted, the assembler builds a default from its `MemoryStore` and the recall config. `src/core/agent-core.ts` passes the same shared instance used by `MemoryHandler`. Existing `new ContextAssembler(...)` sites in `tests/core/context-assembler.test.ts` and the four `tests/core/session-orchestrator*.test.ts` files keep compiling.
- **Previous user message**: after `applyClearCommand()`, scan `recentMessages` from newest to oldest for the first message with `userId === event.userId`, `messageId !== event.messageId` and `!isBot`. This needs no extra fetch.
- **Call placement**: Fast Recall runs after recent messages are fetched, because it needs the previous message. The result is stored on `AssembledContext.fastRecall`. `formatContext()` renders it through `fast-recall.ts` directly after the fixed sections and counts it as mandatory tokens.
- **Failure isolation**: `try/catch` around the call. On error, `logger.warn("Fast Recall failed", { error })` is logged and `fastRecall` stays `undefined`.
- **Prompt text**: `prompts/system_reply.md` line 84 is rewritten to say that high-confidence memories may already be provided under "Relevant Memory", and that `memory-search` should be called when information is insufficient, fuller history is needed or the user asks to recall past events.

## Risks / Trade-offs

- [Fast Recall adds latency to every turn] → Linear scan over in-memory snapshots. The calibration test gates p95 latency.
- [The previous message pulls an old topic back into recall] → The weight is 0.35 and hints come from the current message only.
- [A false positive injects irrelevant memory] → Thresholds are calibrated for a false-positive rate of at most 5%, and `fastRecallEnabled: false` is an operational kill switch.

## Migration Plan

Deploy normally. Set `memory.recall.fastRecallEnabled: false` to disable Fast Recall without a code change.
