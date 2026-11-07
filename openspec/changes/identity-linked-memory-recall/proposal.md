# Proposal

## Why

With identity groups declared (`identity-linked-memory-config`), the bot still recalls only the current account's memories, so a person talking from a second account is a stranger. Every memory read path must treat the accounts of one group as one memory population while storage stays per account (source design `docs/superpowers/specs/2026-11-07-identity-linked-memory-design.md`, sections 1, 4.3–4.5, 6, 7).

## What Changes

- Retrieval (`MemoryRetriever`) accepts linked workspaces and adds their public files, plus their private files only in a DM, to the single BM25 population. Results stay unattributed; a duplicate id from a linked source is dropped; an unreadable linked source is logged and skipped.
- Fixed loading at session start (normal/lurk and spontaneous assembly) merges core and working candidates from every linked workspace under the existing shared budgets. Channel memory is untouched.
- Fast Recall and the `memory-search` skill (Deep Recall) pass the linked workspaces to retrieval.
- `AgentCore` builds one `IdentityRegistry` from `config.identities` and hands it to `ContextAssembler` and, through `SkillRegistry`, to `MemoryHandler`.
- `memory-save`, `memory-stats`, `memory-export`, maintenance, summaries and the dashboard stay per account. `memory-patch` is handled by `identity-linked-memory-patch`.
- Architecture and user-guide documentation updates.

## Capabilities

### New Capabilities

- `identity-linked-recall`: how memory read paths (fixed loading, Fast Recall, Deep Recall) combine the memories of every account in the current account's identity group, and the privacy boundary for linked private memories.

### Modified Capabilities

None. Existing `memory-recall`, `tiered-context-loading` and `context-assembly` behavior is unchanged for an account in no group; the linked behavior is specified in the new capability.

## Impact

- Code: `src/core/memory-recall/retriever.ts`, `src/core/context-assembler.ts`, `src/skills/memory-handler.ts`, `src/skills/registry.ts`, `src/core/agent-core.ts`.
- Tests: `tests/core/memory-recall/retriever.test.ts`, `tests/core/context-assembler.test.ts`, `tests/skills/memory-handler.test.ts`, `tests/core/agent-core.test.ts`, new `tests/integration/identity-linked-memory.integration.test.ts`.
- Docs: `docs/architecture/memory-recall.md`, `docs/guide/memory-experience.md`. Wording is human-reviewed (design.md, "Review document"), not a test requirement.
- Privacy: an operator-linked account's memories become readable by the other accounts of its group; private ones only in DM sessions.

## Batch:

depends-on: identity-linked-memory-config

Needs `IdentityRegistry` and `Config.identities` from `identity-linked-memory-config`. `identity-linked-memory-patch` depends on this change and edits `src/skills/memory-handler.ts` and `tests/skills/memory-handler.test.ts` after it; apply serially.
