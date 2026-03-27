## Context

The memory index was added as part of the memory-management-redesign change to provide O(1) ID lookups. Production analysis revealed that workspace JSONL files are tiny (1-60 lines), making the optimization unnecessary. The index code is mostly dead code and adds maintenance burden.

## Goals / Non-Goals

**Goals:**
- Remove all index-related code, types, and files
- Simplify the memory subsystem
- Keep all other memory v2 features intact (tiers, channels, decay, summaries)

**Non-Goals:**
- Re-architecting memory search (ripgrep-based search remains)
- Changing the JSONL file format
- Removing any non-index features

## Decisions

### Decision 1: Full removal vs partial cleanup

**Choice**: Full removal of `src/core/memory-index.ts` and all references.

**Alternatives considered**: Keep the index class but remove dead methods. Rejected because the entire index provides negligible value and the remaining `lookupById` still requires a full file load afterward.

### Decision 2: findMemoryById fallback behavior

**Choice**: `findMemoryById` reverts to its pre-index behavior — scan public memories first, then private if DM. This was already the fallback path when index was missing.

## Risks / Trade-offs

- [Risk] Future growth makes full scans slow → Mitigation: Can re-add index if any workspace exceeds ~10,000 entries. Current max is ~60.
- [Risk] Removing optimization that was just added → Mitigation: Removing premature optimization is the right engineering decision. YAGNI.
