## ADDED Requirements

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
