## Context

The recall engine reads its budgets from `memory.recall.*` (`DEFAULT_RECALL_CONFIG`) and the `memory-search` skill clamps per-call `limit` (`params.limit ?? 10` in `src/skills/memory-handler.ts`). Verified dead since `memory-deep-recall`: `MemoryStore` reads only `config.workingTierLimit` from its config object; `ContextAssembler` never reads `memoryMaxChars`; `agent-core.ts`'s startup log emits `memorySearchLimit` with no downstream consumer; `applyEnvOverrides`/`ENV_MAPPINGS` has no entry for either field (`MEMORY_SEARCH_LIMIT`/`MEMORY_MAX_CHARS` exist only in `docs/MEMORY_DESIGN.md`). This is a pre-release project: no compat layer, no migration.

## Goals / Non-Goals

**Goals:**
- Delete both fields from the config type, loader defaults, `MemoryStoreConfig`, `ContextAssemblyConfig`, wiring, and startup log — one coherent removal, no renames or repurposing.
- Keep loading of existing `config.yaml` files that still carry `memory.searchLimit` / `memory.maxChars` working by ignoring them (the loader's deep-merge already tolerates unknown keys; nothing must newly trip over them).
- Mechanical fixture cleanup with zero behavior change: `deno check` catches every missed site.

**Non-Goals:**
- No new `ENV_MAPPINGS` entries, no deprecation warnings, no config-versioning.
- No changes to `workingTierLimit`, `recentMessageLimit`, `memory.recall.*`, or the `memory-search` `limit` parameter semantics.
- No touching `note-chunker.ts`'s local `maxChars` parameter (excerpt window size, unrelated).

## Decisions

- **Remove, not reword.** The knobs have no consumer and the recall series deliberately replaced them; rewording (e.g. documenting them as ignored) would keep dead surface alive. Pre-release policy bans compat shims.
- **`MemoryStoreConfig` shrinks to `{ workingTierLimit?: number }`** rather than being replaced by a bare optional number argument: every test constructs it as an object literal, so an object-shaped config keeps call sites honest and keeps `workingTierLimit` an optional field read with `?? 20`. Alternative (constructor takes `workingTierLimit?: number` directly) rejected: churns ~30 call sites for no gain and drops the extensibility seam `MemoryStore` already uses.
- **`ContextAssemblyConfig.memoryMaxChars` is deleted, not defaulted to optional** — the assembler never reads it; a required-but-unused field is exactly the drift trap this change removes. Tests that build the config drop the key.
- **Legacy-key tolerance is asserted by one regression test** loading a YAML fixture with both keys, rather than by code: the loader already merges unknown keys and casts, so the test guards against someone later adding strict unknown-key validation that would silently break deployments.

## Risks / Trade-offs

- ~35 test-fixture call sites are mechanical edits; `deno check src/main.ts` plus the full test suite catch omissions — the risk is noise in review, not correctness.
- Downstream `config.yaml` files keep the keys harmlessly; if a future operator expects them to do something, `config.example.yaml` and `docs/MEMORY_DESIGN.md` no longer advertise them, which is the point of the removal.
