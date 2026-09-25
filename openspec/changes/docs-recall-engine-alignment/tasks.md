# Tasks

## 1. docs/DESIGN.md

- [ ] 1.1 Rewrite the `importance` row of the memory field table (~line 424): `importance` is a retrieval ranking bonus; loading at session start is decided by tier within the `memory.recall` budgets. Do not touch the `searchLimit`/`maxChars` lines in the config example (~566-568).
- [ ] 1.2 Rewrite the "Memory Retrieval" section (~448-460): fixed loading is tier-based within the `memory.recall` core/working budgets; `memory-search` is served by the lexical recall engine (BM25 + entity/phrase/metadata bonuses, importance is a bonus only); drop the `rg` (ripgrep) full-text-search and hit-count/character-limit description. Wording condenses the canonical text in `AGENTS.md` ~279-281 and `docs/MEMORY_DESIGN.md`.
- [ ] 1.3 Fix the container-binary entries (~623 and ~1321): `rg` is for agent-side in-workspace file reading under the ACP permission gate, not memory search.

## 2. docs/SKILLS_IMPLEMENTATION.md

- [ ] 2.1 `memory-save` key features (~line 68): remove "High importance memories always loaded into context".
- [ ] 2.2 `memory-search` (~72-76): natural-language query via `query-file`; results from the recall engine in relevance order with `score` and `matchedTerms`, in `userMemories`/`agentNotes` sections. Matches `skills/memory-search/SKILL.md`.
- [ ] 2.3 Memory handler list (~line 228): `handleMemorySearch` searches via the `memory-recall` retriever (relevance-ranked), not "by keywords".

## 3. AGENTS.md

- [ ] 3.1 Fix the container-binary line (~1321) "rg - ripgrep 15.1.0 for memory search" the same way as task 1.3. Leave the `searchLimit`/`maxChars` example lines (~391-392) untouched.

## 4. Verification

- [ ] 4.1 Grep-verify no stale wording remains: `grep -rn "always loaded\|Automatically loaded\|full-text search\|search keywords\|for memory search\|by keywords" docs/DESIGN.md docs/SKILLS_IMPLEMENTATION.md AGENTS.md` returns no memory-engine matches.
- [ ] 4.2 Spot-check each rewritten passage against `openspec/specs/memory-recall/spec.md` (ranking bonuses, fixed-loading budgets, Fast Recall) and against `skills/memory-search/SKILL.md`.
- [ ] 4.3 Run the CI-equivalent gates (`deno task fmt:check`, `deno task lint`, `deno task check`, `deno task test:unit`) and verify they pass (docs-only change; they must not regress).
