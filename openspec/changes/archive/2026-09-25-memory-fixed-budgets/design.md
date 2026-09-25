## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, section 9. `ContextAssembler` currently:

- loads all core memories and `workingTierLimit` working memories, for the user and the channel;
- lets `formatTieredMemoriesSection()` render "Core Memories (User)", "Recent Context (User)" and one merged, unverified "Channel Notes" block.

## Goals / Non-Goals

**Goals:**

- A hard bound on the fixed memory portion of every prompt.
- An `injectedIds` set for change 7.

**Non-Goals:**

- Fast Recall.
- Changing storage tiers or the demotion driven by `workingTierLimit`.

## Decisions

- **Pure helper** `selectFixedMemories({ userCore, channelCore, userWorking, channelWorking }, budgets)` in `src/core/memory-recall/fixed-selection.ts`. It returns `{ core, working, injectedIds }`. Being pure, it can be unit-tested and reused by both assembly paths.
- **Core**: user core before channel core, each by `createdAt` ascending. A memory is kept when its rendered line fits the remaining `coreMaxTokens`, and skipped otherwise.
- **Working**:
  - Fetch `workingMaxItems` from each source via the existing `limit` argument of `getRecentWorkingMemories` and `getChannelRecentWorkingMemories`.
  - Merge, sort by `createdAt` descending and take the first `workingMaxItems`.
  - Walk that list and keep the entries that fit `workingMaxTokens`.
  - Output in chronological order.

  Older candidates never replace skipped ones, which keeps the rule simple and bounded.
- **Measurement**: `estimateTokens()` on the exact line `formatTieredMemoriesSection()` emits. Channel lines include `[from <author>] `. Headings are not charged, because they are constant and small.
- **Rendering stays as today**: the user core, user working and channel sections are unchanged apart from their contents.

## Risks / Trade-offs

- [Operators with many core memories lose some from every prompt] → This is intended. The memories stay searchable now and are recallable after change 7, and the budget is configurable.
- [An `importance: "high"` archive memory is no longer guaranteed injection] → Documented as intended. Promote it to core to guarantee injection.

## Migration Plan

Deploy normally. Raise `coreMaxTokens`, `workingMaxItems` or `workingMaxTokens` in config if too much context is lost.
