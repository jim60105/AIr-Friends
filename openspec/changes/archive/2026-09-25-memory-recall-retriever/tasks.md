## 1. Configuration

- [x] 1.1 Add `MemoryRecallConfig` to `src/types/config.ts` (the keys in "Memory Recall Configuration") and defaults and validation to `src/core/config-loader.ts`, with provisional thresholds of 3.0. Document the keys in `config.example.yaml`. Verify with config-loader tests for the defaults, a partial override and an invalid ratio.

## 2. Snapshot cache

- [x] 2.1 Add the public path helpers `getMemoryFilePathFor` and `getChannelMemoryFilePathFor` to `MemoryStore`. Verify with a unit test that they return the same paths the store writes to.

- [x] 2.2 Implement `snapshot-cache.ts` (stat-based reuse, a missing file yields empty, a shared in-flight rebuild). Verify with tests: an append is visible, a disabling patch hides the memory, an unchanged file is not re-read (loader spy), and two concurrent searches trigger one rebuild.

## 3. Retriever

- [x] 3.1 Implement source-file mapping and filtering (enabled, visibility, scope, `category`, `scope` filter, exclusion, supersede with the historical and Deep overrides) and the overlap rule. Verify with tests for private-in-guild, excluded id, single bigram, supersede (current and historical) and omitted scope.
- [x] 3.2 Implement `relatedTo` expansion (top 5, at most 2 each, overlap required, max merge, no second hop). Verify with the three expansion scenario tests.
- [x] 3.3 Implement Fast and Deep selection with token accounting. Verify with tests for every selection scenario, including a second memory skipped for size and a Deep limit of 50 capped to 10.
- [x] 3.4 Add execution tests: an identical request twice gives deep-equal results with an injected clock, and a stubbed `globalThis.fetch` that throws is never called.

## 4. Verification

- [x] 4.1 Run `deno task ci`. Verify that it passes, with at least 90% line coverage for `snapshot-cache.ts` and `retriever.ts`.
