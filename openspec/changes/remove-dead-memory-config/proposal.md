## Batch:
- id: remove-dead-memory-config
- depends-on: docs-recall-engine-alignment
- conflicts: `docs/DESIGN.md` (~566-568 config example), `AGENTS.md` (~391-392 config example), and `docs/MEMORY_DESIGN.md` are prose files the earlier change `docs-recall-engine-alignment` also edits (different lines: retrieval prose vs. config examples) — queue after it. No code conflicts with `scope-ci-fmt-check` (different files).

## Why

`memory.searchLimit` and `memory.maxChars` stopped being read by any retrieval code when `memory-deep-recall` replaced the keyword search with the recall engine, but they are still declared in `MemoryStoreConfig` and `MemoryConfig`, defaulted in `config-loader.ts`, documented in `config.example.yaml` (lines 219-220), `AGENTS.md`, `docs/DESIGN.md`, `docs/MEMORY_DESIGN.md`, passed through `agent-core.ts` (including a `memorySearchLimit` startup-log field at ~line 164 with no consumer), and threaded through ~35 test fixtures. `ContextAssemblyConfig.memoryMaxChars` is likewise never read by `ContextAssembler`. Dead knobs that look live are a configuration-drift trap.

## What Changes

- **BREAKING (config surface)**: Remove `memory.searchLimit` and `memory.maxChars` from `MemoryConfig` (`src/types/config.ts`), the loader defaults (`src/core/config-loader.ts`), `MemoryStoreConfig` (`src/core/memory-store.ts` — it keeps only `workingTierLimit`), and the startup log field `memorySearchLimit` (`src/core/agent-core.ts`). Old `config.yaml` files that still set these keys load unchanged: unknown keys are merged and ignored, there is no unknown-key validation, and no `ENV_MAPPINGS` entry exists for them.
- Remove `memoryMaxChars` from `ContextAssemblyConfig` (`src/types/context.ts`) and its wiring in `agent-core.ts`; the assembler reads only `recentMessageLimit`, `tokenLimit`, `systemPromptPath`, `agentType`, `recall`.
- The `memory-search` skill's per-call `limit` parameter (default 10, `src/skills/memory-handler.ts` `params.limit ?? 10`) is the surviving result-count knob and is unchanged; the `memory.recall` budgets remain the injection knobs.
- Remove the two keys from `config.example.yaml` (~219-220) and from the config examples in `AGENTS.md` (~391-392) and `docs/DESIGN.md` (~566-568); remove the `MEMORY_SEARCH_LIMIT` / `MEMORY_MAX_CHARS` rows and the `search_limit` / `max_chars` example lines from `docs/MEMORY_DESIGN.md` (~510-511, 535-536). These env vars were documentation-only in `MEMORY_DESIGN.md`; `src/utils/env.ts` never mapped them (verified).
- Update every construction site: `agent-core.ts`, `scripts/memory-recall-benchmark.ts`, and all `tests/` fixtures that pass `searchLimit: 10, maxChars: 2000` (295 occurrences across 33 test files — mechanical, `deno check` catches misses); drop the `assertEquals(result.memory.searchLimit, 10)` assertion in `tests/core/config-loader.test.ts` (~line 78).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: "Configuration Validation" memory defaults drop `searchLimit`/`maxChars`; a new requirement pins that the fields are gone from the config model, defaults, example file, and startup log, while legacy config keys are ignored without error.

## Impact

- **Code**: `src/types/config.ts`, `src/types/context.ts`, `src/core/config-loader.ts`, `src/core/memory-store.ts`, `src/core/agent-core.ts`.
- **Tests**: 295 field occurrences across 33 `tests/` files (mechanical removal), `tests/core/config-loader.test.ts` assertion, plus a new regression test that a legacy config containing the removed keys loads without error and without the fields.
- **Docs**: `config.example.yaml`, `AGENTS.md`, `docs/DESIGN.md`, `docs/MEMORY_DESIGN.md`.
- **Unaffected**: `memory.workingTierLimit` (still read by `MemoryStore`), `memory.recall.*`, the `memory-search` `limit` parameter, `note-chunker.ts`'s unrelated local `maxChars` parameter.
