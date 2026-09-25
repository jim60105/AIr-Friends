# Tasks

## 1. Source removal

- [x] 1.1 Delete `searchLimit` and `maxChars` from `MemoryConfig` in `src/types/config.ts`, and `memoryMaxChars` from `ContextAssemblyConfig` in `src/types/context.ts`.
- [x] 1.2 Delete the `searchLimit: 10` / `maxChars: 2000` defaults from `DEFAULT_CONFIG.memory` in `src/core/config-loader.ts`.
- [x] 1.3 Shrink `MemoryStoreConfig` in `src/core/memory-store.ts` to `{ workingTierLimit?: number }`; verify the only surviving read (`this.config.workingTierLimit ?? 20`) is untouched.
- [x] 1.4 In `src/core/agent-core.ts`: drop the two keys from the `MemoryStore` construction, drop `memoryMaxChars` from the `ContextAssembler` config, and remove the `memorySearchLimit` field from the startup log.

## 2. Fixture and script cleanup

- [x] 2.1 Remove `searchLimit` / `maxChars` / `memoryMaxChars` from every construction site in `tests/` (`tests/acp/*`, `tests/core/*` incl. `memory-store.test.ts` and `session-orchestrator*.test.ts`, `tests/dashboard/server.test.ts`, `tests/integration/*`, `tests/skill-api/*`, `tests/skills/*`, `tests/spontaneous-*.test.ts`) and from `scripts/memory-recall-benchmark.ts`.
- [x] 2.2 Remove the `assertEquals(result.memory.searchLimit, 10)` assertion from `tests/core/config-loader.test.ts`; keep the `recentMessageLimit` assertion.
- [x] 2.3 Run `deno task check` and the full `deno task test:unit` + `deno task test:integration`; every missed construction site must surface as a type error and be fixed.

## 3. Legacy-key regression test

- [x] 3.1 Add a `tests/core/config-loader.test.ts` case: a YAML config that sets `memory.searchLimit: 5` and `memory.maxChars: 1000` loads without error; the loaded `memory` section has no `searchLimit`/`maxChars` defaults injected. The `memory.recall` budgets and `workingTierLimit` are unaffected.

## 4. Documentation surfaces

- [x] 4.1 Remove the `searchLimit` / `maxChars` lines (and their comments) from `config.example.yaml` (~219-220).
- [x] 4.2 Remove them from the config examples in `AGENTS.md` (~391-392) and `docs/DESIGN.md` (~566-568).
- [x] 4.3 In `docs/MEMORY_DESIGN.md`: remove the `search_limit` / `max_chars` lines from the config example (~510-511) and the `MEMORY_SEARCH_LIMIT` / `MEMORY_MAX_CHARS` rows from the environment-variable table (~535-536); state there that `memory-search`'s per-call `limit` (default 10) is the result-count knob if the surrounding text needs a subject for the row it loses.

## 5. Verification

- [x] 5.1 `grep -rn "searchLimit\|maxChars\|memoryMaxChars\|MEMORY_SEARCH_LIMIT\|MEMORY_MAX_CHARS" src/ tests/ scripts/ config.example.yaml AGENTS.md docs/DESIGN.md docs/MEMORY_DESIGN.md` matches only the unrelated `note-chunker.ts`/`note-chunker.test.ts` local `maxChars` excerpt-window parameter.
- [x] 5.2 Run the CI-equivalent gates (`deno task fmt:check`, `deno task lint`, `deno task check`, `deno task test:unit`, `deno task test:integration`) and verify they pass.
