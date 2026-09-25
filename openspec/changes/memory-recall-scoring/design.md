## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, section 5. This change uses the tokenizer from `memory-recall-tokenizer`. Filtering, file access and selection belong to `memory-recall-retriever`. This change covers only pure functions.

## Goals / Non-Goals

**Goals:**

- Pure, synchronous, fully unit-tested scoring that takes a population of indexed memories and query tokens and returns scored, ordered items.

**Non-Goals:**

- Eligibility filtering (scope, visibility, supersede, exclusion), `relatedTo` expansion and selection. These belong to change 3.

## Decisions

- **`IndexedMemory`** (built by `indexMemory(memory, tokenizer)`) holds:
  - the resolved memory;
  - `tf: Map<string, number>`, keyed `kind:term`, so a word and a bigram with the same characters stay distinct;
  - the set of entity terms;
  - the normalized text (NFKC and lowercase) for the phrase check;
  - `length`, the token count.
- **`scoreMemories(population, query, hints, now)`** computes `N`, `df` (for the query keys only) and `avgdl` from the given population in one pass, then scores every document with at least one matched key. The caller decides what the population is, which is how change 3 keeps private memories out of guild statistics.
- **Query tokens** come from `buildQuery(current, previous?)`: the tokenizer runs on both messages, and each key keeps the maximum of `kindWeight × sourceWeight`. Entities and the phrase-window source come from the current message only.
- **Phrase check**: take the non-stopword word and entity tokens of the current message in order, and slide windows of 2 to 6 adjacent tokens. Join CJK terms without separators and Latin terms with a single space. Test each window as a substring of the normalized text, and stop at the first hit whose joined length is at least 4 characters.
- **Hints**: CJK terms use substring matching. Latin terms use `\b` regex on the lowercased message.
- **Ordering comparator**: score descending, then `createdAt` descending, then id ascending. It is exported for reuse.
- **Numeric stability**: scores stay full-precision internally. Rounding happens only at output (change 5).

## Risks / Trade-offs

- [Short English hint words (`before`, `recent`) appear in unrelated chat] → A hint only adds at most +0.20 to memories that already match lexically. Calibration includes adversarial negatives.
- [BM25 on very short documents is spiky] → The phrase and entity bonuses, and the threshold calibration in change 4, account for it.

## Migration Plan

None. The modules are unused until change 3.
