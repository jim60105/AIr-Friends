# memory-recall Specification

## Purpose
Deterministic, CPU-only lexical retrieval over long-term memories and agent workspace notes. It powers automatic per-turn Fast Recall and the agent-invoked Deep Recall (`memory-search`) without embeddings, vector stores, extra LLM calls or extra services.

## Requirements

### Requirement: Text Normalization and Tokenization

Queries, memory contents and note chunks SHALL be processed by the same tokenization pipeline:

1. Apply Unicode NFKC normalization, then lowercase Latin letters.
2. Extract entity tokens (weight 1.5): maximal alphanumeric runs joined by `-`, `.` or `_` (for example `air-friends`, `v0.31.1`), and CamelCase or PascalCase words (for example `OpenClaw`). The component parts of an entity SHALL also be emitted as word tokens. Two adjacent short alphanumeric tokens where at least one contains a digit SHALL also form one entity (for example `a7c ii`, `air75 v3`).
3. Segment every run of CJK characters into words with a dictionary-based segmenter that supports Traditional Chinese, and emit each word as a word token (weight 1.0).
4. Emit every adjacent character pair of every CJK run as a bigram token (weight 0.25).
5. Drop punctuation, whitespace and a fixed list of single-character CJK stopwords.

The tokenizer SHALL NOT modify its input. It SHALL NOT convert between Simplified and Traditional forms. The same input SHALL always produce the same tokens in the same order.

#### Scenario: Traditional Chinese words are segmented as words
- **WHEN** `使用者喜歡喝無糖綠茶` is tokenized
- **THEN** the word tokens SHALL include `喜歡` and `綠茶`

#### Scenario: Mixed-script entities are preserved
- **WHEN** `我在 AIr-Friends 用 OpenClaw 搭配 Air75 V3` is tokenized
- **THEN** the entity tokens SHALL include `air-friends`, `openclaw` and `air75 v3`
- **AND** the word tokens SHALL include `air` and `friends`

#### Scenario: Bigram fallback recovers partial matches
- **GIVEN** a text whose segmented words include `記憶系統` but not `記憶`
- **WHEN** that text and a query containing `記憶` are tokenized
- **THEN** both SHALL contain the bigram `記憶`

#### Scenario: Stopwords removed
- **WHEN** `我的鍵盤` is tokenized
- **THEN** no token SHALL be `的` or `我`

### Requirement: Segmenter Degradation

If the word segmenter or its dictionary cannot be loaded, the tokenizer SHALL log one error and continue producing entity and bigram tokens only. It SHALL NOT throw to its caller because of the segmenter failure.

#### Scenario: Segmenter unavailable
- **GIVEN** the word segmenter fails to load
- **WHEN** `喜歡 Air75 V3` is tokenized
- **THEN** the result SHALL contain the entity `air75 v3` and the bigram `喜歡`
- **AND** no word tokens from segmentation SHALL be produced
- **AND** the error SHALL be logged once, not on every call

### Requirement: Query Hints

The system SHALL detect hints in the current user message by fixed string matching. Latin terms SHALL match on word boundaries.

| Hint | Terms |
|---|---|
| current | 現在、目前、最近、後來、最後、current、latest、recent、eventually |
| historical | 以前、之前、當時、最初、原本、previously、before、originally |
| preference | 喜歡、討厭、偏好、最愛、prefer、favorite、like、dislike |

#### Scenario: Preference hint detected
- **WHEN** the current message is `我最喜歡的飲料是什麼`
- **THEN** the preference hint SHALL be active

#### Scenario: Latin hint needs a word boundary
- **WHEN** the current message is `unlikely to matter`
- **THEN** the preference hint SHALL NOT be active

#### Scenario: Previous message does not set hints
- **GIVEN** the previous user message contains `以前` and the current message contains no hint term
- **WHEN** recall runs
- **THEN** no historical hint SHALL be active

### Requirement: Relevance Scoring

Each eligible memory SHALL be scored as `lexicalScore + exactEntityBonus + exactPhraseBonus + metadataBonus + temporalBonus + relationBonus`.

- **Query weighting**: tokens from the current user message SHALL carry source weight 1.0, and tokens from the previous user message SHALL carry 0.35. When a term appears in both, the larger weight SHALL be used. The previous message SHALL be used only for query tokens.
- **`lexicalScore`**: the sum over matched query terms of BM25 (k1 = 1.2, b = 0.75, IDF = `ln(1 + (N − df + 0.5) / (df + 0.5))`) multiplied by the token's kind weight and source weight. `N`, `df` and average document length SHALL be computed over the memories that pass the enabled, scope, visibility, filter and supersede rules of the current request.
- **`exactEntityBonus`**: +1.5, at most once, when an entity from the current message appears in the memory.
- **`exactPhraseBonus`**: +2.0, at most once, when a span of at least 2 adjacent non-stopword tokens and at least 4 characters from the current message appears verbatim in the normalized memory text.
- **`metadataBonus`**:
  - importance high: +0.20
  - working tier: +0.15
  - recency: `0.20 × max(0, 1 − ageDays / 365)`
  - decay: `0.20 × decay`
  - preference hint with `category = "preference"`: +0.30
- **`temporalBonus`**: with a current hint, the recency term SHALL be added once more; with a historical hint, superseded memories SHALL receive +0.20.
- **Bonus gating**: bonuses SHALL apply only when `lexicalScore > 0`.
- **Ordering**: score descending, then `createdAt` descending, then id ascending.

#### Scenario: Lexical relevance outranks metadata
- **GIVEN** memory A strongly matches the query and has `decay: 0.3`
- **AND** memory B weakly matches the query and has `decay: 1.0`, `importance: "high"` and `tier: "working"`
- **WHEN** recall ranks them
- **THEN** memory A SHALL rank above memory B

#### Scenario: Metadata breaks near ties
- **GIVEN** two memories with equal lexical, entity and phrase scores
- **AND** one has `importance: "high"` and the other `importance: "normal"`, with equal other metadata
- **WHEN** recall ranks them
- **THEN** the high-importance memory SHALL rank first

#### Scenario: Preference query boosts preference memories
- **GIVEN** a `preference` memory and a `fact` memory with equal lexical scores and metadata for `我喜歡什麼茶`
- **WHEN** recall ranks them
- **THEN** the `preference` memory SHALL rank first
- **AND** the `fact` memory SHALL remain eligible

#### Scenario: Previous message has limited influence
- **GIVEN** memory A matches only the previous user message and memory B matches the current message with the same terms
- **WHEN** recall ranks them
- **THEN** memory B SHALL rank above memory A

### Requirement: Local Deterministic Execution

Recall SHALL run entirely in the application process using CPU and process memory. Recall SHALL NOT make network requests, SHALL NOT invoke any language model, and SHALL NOT persist a derived index to disk. For the same stored data, query, previous message, configuration and clock, recall SHALL return the same results in the same order with the same scores.

#### Scenario: No external calls during recall
- **GIVEN** network access is unavailable
- **WHEN** a recall request runs
- **THEN** it SHALL complete and return results without any network or LLM request

#### Scenario: Repeatable ordering
- **GIVEN** a fixed memory corpus, query and clock
- **WHEN** the same recall request is executed twice
- **THEN** both executions SHALL return identical items in identical order with identical scores

### Requirement: Memory Snapshot Freshness

Recall SHALL keep an in-process snapshot of indexed memories per memory JSONL file. Before each search the system SHALL compare each relevant file's size and modification time with its snapshot, and SHALL rebuild the snapshot of any file that changed, appeared or disappeared. A write that completes before a search starts SHALL be visible to that search.

#### Scenario: Newly saved memory is searchable immediately
- **GIVEN** a memory snapshot has already been built
- **WHEN** a new memory is appended and a search runs afterward
- **THEN** the new memory SHALL be eligible in that search

#### Scenario: Patch takes effect on the next search
- **GIVEN** a memory is returned by a search
- **WHEN** a patch disables that memory and the same search runs again
- **THEN** the memory SHALL NOT be returned

#### Scenario: Unchanged file is not re-read
- **GIVEN** a memory file has not changed since its snapshot was built
- **WHEN** a search runs
- **THEN** the file content SHALL NOT be read again

### Requirement: Memory Eligibility

A memory SHALL be eligible for recall only when all of the following hold:

- It is enabled.
- It belongs to the scopes and visibilities allowed for the conversation (DM: the user's public and private memories; guild channel: the user's public memories and the channel's memories).
- It is not in the request's exclusion set.
- It matches at least one word or entity token of the query, or at least two distinct bigram tokens.
- It is not superseded, unless the query contains a historical hint or the request is Deep Recall. A memory is superseded when its id appears in the `supersedes` list of any enabled memory within the same allowed scopes.

A request SHALL accept an optional `category` filter and an optional `scope` filter (`user` or `channel`) that further restrict eligibility. An omitted `scope` SHALL include every scope allowed for the conversation.

#### Scenario: Private memory never recalled outside DM
- **GIVEN** a user has a private memory matching the query
- **WHEN** recall runs for a message in a guild channel
- **THEN** the private memory SHALL NOT be returned

#### Scenario: Single weak bigram does not qualify
- **GIVEN** a memory shares exactly one bigram and no word or entity with the query
- **WHEN** recall runs
- **THEN** the memory SHALL NOT be returned

#### Scenario: Excluded memory not returned
- **GIVEN** a memory matches the query and its id is in the exclusion set
- **WHEN** recall runs
- **THEN** the memory SHALL NOT be returned

#### Scenario: Latest state excludes superseded memory
- **GIVEN** memory B supersedes memory A and both match `我現在用什麼鍵盤`
- **WHEN** Fast Recall runs for that query
- **THEN** memory A SHALL NOT be returned

#### Scenario: Historical query reaches superseded memory
- **GIVEN** memory B supersedes memory A
- **WHEN** Fast Recall runs for `我原本用什麼鍵盤`
- **THEN** memory A SHALL be eligible

#### Scenario: Omitted scope searches every allowed scope
- **GIVEN** a guild-channel conversation where the user and the channel each have a matching memory
- **WHEN** Deep Recall runs without a `scope` filter
- **THEN** both memories SHALL be eligible

### Requirement: Related Memory Expansion

After direct ranking, the system SHALL expand one hop along `relatedTo` from the top 5 direct memory candidates, adding at most 2 related memories per candidate. A related memory SHALL be added only if it satisfies Memory Eligibility and has `lexicalScore > 0`. Its score SHALL be its own score plus `0.20 × parentScore`. If it is already a direct candidate, the larger score SHALL be used. Expansion SHALL NOT continue past one hop.

#### Scenario: Related memory with overlap is surfaced
- **GIVEN** memory A is the top candidate, lists memory C in `relatedTo`, and memory C shares a word with the query
- **WHEN** recall runs
- **THEN** memory C SHALL receive a relation bonus of `0.20 × score(A)`

#### Scenario: Related memory without overlap is dropped
- **GIVEN** memory A lists memory D in `relatedTo` and memory D shares no token with the query
- **WHEN** recall runs
- **THEN** memory D SHALL NOT be returned

#### Scenario: No second hop
- **GIVEN** A relates to C and C relates to E, and only A is a direct candidate
- **WHEN** recall runs
- **THEN** E SHALL NOT be added through C

### Requirement: Memory Result Format

Each memory result SHALL contain the complete resolved memory (all fields, including full content), its final score and the list of matched query terms. No further lookup SHALL be needed to use the memory.

#### Scenario: Memory result is complete
- **WHEN** recall returns a memory
- **THEN** the result SHALL include the memory's full content, id, tier, category, scope and author when present
- **AND** it SHALL include `score` and `matchedTerms`

### Requirement: Fast Recall Memory Selection

In Fast Recall mode the system SHALL select memories with a precision-first rule:

- If the top score is below `minRecallScore`, no memory SHALL be selected.
- Otherwise the first SHALL be selected.
- A second SHALL be selected only if its score is at least `secondRecallScore` and at least `secondResultRatio` × the top score.
- No more than `fastRecallMaxResults` memories SHALL be selected.
- The selected memories' rendered lines SHALL fit within `fastRecallMaxTokens`, including section headings. Memories SHALL be added in rank order, and one that does not fit the remaining budget SHALL be skipped.
- Lower-scoring memories SHALL NOT be added to fill unused slots.

#### Scenario: Low confidence yields nothing
- **GIVEN** the best memory score is below `minRecallScore`
- **WHEN** Fast Recall runs
- **THEN** no memory SHALL be selected

#### Scenario: Second result requires both conditions
- **GIVEN** the top memory scores 10.0 and the second scores at least `secondRecallScore` but below `secondResultRatio × 10.0`
- **WHEN** Fast Recall runs
- **THEN** only the top memory SHALL be selected

#### Scenario: Hard limits hold
- **WHEN** Fast Recall runs on any corpus with default configuration
- **THEN** at most 2 memories SHALL be selected and their rendered lines SHALL total at most 192 estimated tokens

### Requirement: Deep Recall Memory Selection

In Deep Recall mode the system SHALL return up to `limit` memories, with `limit` capped at 10. It SHALL keep memories whose score is at least `deepMinRecallScore` (default 0, meaning eligibility alone qualifies), and SHALL allow superseded memories. The whole Deep Recall output, meaning every returned item of any kind, SHALL fit within `deepRecallMaxTokens`. Items SHALL be admitted in descending score order, and any item that does not fit the remaining budget SHALL be skipped.

#### Scenario: Deep Recall returns more than Fast Recall
- **GIVEN** five memories are eligible for a query and only one clears `minRecallScore`
- **WHEN** Deep Recall runs with `limit: 10`
- **THEN** all five memories SHALL be returned in score order

#### Scenario: Limit is capped
- **WHEN** Deep Recall runs with `limit: 50`
- **THEN** at most 10 memories SHALL be returned
