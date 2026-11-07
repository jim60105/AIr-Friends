# Proposal

## Why

After `identity-linked-memory-recall`, the agent sees a linked account's memories but `memory-patch` only looks in the current account's files, so correcting, disabling or relating a recalled linked memory fails with "Memory not found". The patch must reach the workspace that owns the memory without copying it (source design `docs/superpowers/specs/2026-11-07-identity-linked-memory-design.md`, §1 and §4.6).

## What Changes

- User-scope `memory-patch` resolves the target id in the current workspace first, then in each linked workspace in configuration order, and appends the patch event to the owning workspace's file.
- Two or more linked owners of the same id (none in the current workspace) return an explicit ambiguity error naming the id; no owner returns the existing not-found error.
- Linked private memories are patchable only in a DM session.
- `MemoryStore.findMemoryById()` becomes public (no behavior change).
- Channel-scope patching is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None in `openspec/specs/`. This change adds one requirement to the `identity-linked-recall` capability introduced by `identity-linked-memory-recall` (an ADDED delta for that capability).

## Impact

- Code: `src/core/memory-store.ts` (visibility of `findMemoryById`), `src/skills/memory-handler.ts` (user-scope branch of `handleMemoryPatch`).
- Tests: `tests/skills/memory-handler.test.ts`.
- No documentation beyond what `identity-linked-memory-recall` updates; no human review document.

## Batch:

depends-on: identity-linked-memory-recall
depends-on: identity-linked-memory-config

Uses the `identityRegistry` field that `identity-linked-memory-recall` adds to `MemoryHandler`, and its `identity-linked-recall` capability must be archived first. Conflict note: both changes edit `src/skills/memory-handler.ts` and `tests/skills/memory-handler.test.ts`; apply strictly after `identity-linked-memory-recall`.
