## 1. Hints and query

- [x] 1.1 Implement `query-hints.ts` with the three fixed term lists, CJK substring matching and Latin word-boundary matching. Verify with tests for each hint, `unlikely` not triggering `like`, and hints read from the current message only.
- [x] 1.2 Implement `buildQuery(current, previous?)` with source weights of 1.0 and 0.35, max merge per key, and entities and phrase source from the current message only. Verify with unit tests.

## 2. Indexing and scoring

- [x] 2.1 Implement `indexed-memory.ts` (`indexMemory`, keyed `tf`, entity set, normalized text, length). Verify with a test on a mixed-script memory.
- [x] 2.2 Implement BM25 in `ranker.ts` with population-derived `N`, `df` and `avgdl`, k1 = 1.2 and b = 0.75. Verify with a hand-computed expected value for a 3-document corpus, to 1e-9.
- [x] 2.3 Implement the entity bonus, phrase bonus (window of 2 to 6, at least 4 characters), metadata bonus, temporal bonus and bonus gating. Verify with one test per bonus and a gating test (a memory with zero lexical score gets no bonus).
- [x] 2.4 Implement and export the deterministic comparator. Verify with tests for the Relevance Scoring scenarios (lexical over metadata, near-tie break, preference boost, previous-message influence) and a same-input-twice equality test.

## 3. Verification

- [x] 3.1 Run `deno task ci`. Verify that it passes, with at least 90% line coverage for `query-hints.ts`, `indexed-memory.ts` and `ranker.ts` in the coverage report.
