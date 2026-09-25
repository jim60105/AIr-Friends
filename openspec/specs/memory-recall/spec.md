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

### Requirement: Memory Threshold Calibration

The default values of `minRecallScore` and `secondRecallScore` SHALL be derived from a committed offline benchmark fixture. The fixture SHALL:

- contain Traditional Chinese and mixed-script memories;
- include supersede chains, `relatedTo` links, channel memories, and both DM and guild contexts;
- label every query with its expected memory ids, with roughly 40% of queries expecting none.

The memory false-positive rate SHALL be defined as the share of queries for which Fast Recall selects at least one memory outside the query's expected set.

- `minRecallScore` SHALL be the grid value that maximizes Recall@1 subject to a false-positive rate of at most 5%.
- `secondRecallScore` SHALL be the grid value that maximizes Recall@2 under the same limit, with `minRecallScore` fixed.
- Ties SHALL be broken by the lower false-positive rate, then by the higher threshold.

A regression test SHALL run Fast Recall over the fixture with the default configuration and a fixed clock. It SHALL assert that Recall@1, Recall@2, false-positive rate and average injected tokens equal the recorded values. It SHALL also assert that the p95 search latency over the fixture, measured after one warm-up pass, is below 50 ms. The ceiling is deliberately generous so that only large regressions fail.

#### Scenario: Benchmark gate
- **WHEN** the regression test runs with default configuration
- **THEN** the memory false-positive rate SHALL be at most 5%
- **AND** Recall@1, Recall@2, false-positive rate and average injected tokens SHALL equal the recorded values
- **AND** p95 search latency SHALL be below 50 ms

#### Scenario: Benchmark is offline
- **WHEN** the benchmark script or regression test runs
- **THEN** it SHALL NOT perform network or LLM requests

#### Scenario: Fixture covers required cases
- **WHEN** the fixture is inspected
- **THEN** it SHALL include at least one query for each case:
  - natural-question paraphrase
  - mixed-script entity
  - current state over a superseded memory
  - historical query for a superseded memory
  - preference query
  - `relatedTo` expansion
  - negative query
  - negative query that contains an English current or historical hint word used in an unrelated sense

### Requirement: Deep Recall Skill Output

The `memory-search` skill SHALL run recall in Deep mode with the whole query text, the session's workspace and channel context, and the optional `category`, `scope` and `limit` parameters. Its `memories` output SHALL:

- list memories in descending score order;
- give each entry the memory fields previously returned (`id`, `enabled`, `visibility`, `importance`, `content`, `createdAt`, `lastModifiedAt`, `tier`, `category`, `scope`, `decay`, `relatedTo`, `supersedes`) plus `score` (rounded to 3 decimals) and `matchedTerms`;
- contain no duplicate ids.

An invalid `limit`, `category` or `scope` SHALL still be rejected with the existing error messages.

#### Scenario: Relevance order with diagnostics
- **GIVEN** three memories match a query with different scores
- **WHEN** `memory-search` runs
- **THEN** they SHALL be listed from highest to lowest score
- **AND** each SHALL include `score` and `matchedTerms`

#### Scenario: Whole-query tokenization
- **GIVEN** a memory containing `無糖綠茶`
- **WHEN** `memory-search` runs with the query `我喜歡喝的綠茶`
- **THEN** the memory SHALL be returned, because the query is tokenized as a whole rather than split on whitespace

#### Scenario: Invalid category still rejected
- **WHEN** `memory-search` is called with `category: "hobby"`
- **THEN** the skill SHALL return an error listing the allowed categories

### Requirement: Note Indexing

When a session has an agent workspace, recall SHALL index every `.md` file under it, recursively, except `README.md` at the workspace root and `notes/_index.md`.

- **Chunking**: each file SHALL be split into chunks at level-2 and level-3 headings. A chunk longer than about 600 characters SHALL be split again at blank lines.
- **Chunk metadata**: each chunk SHALL record the file's absolute path, the document title (the first level-1 heading, otherwise the file name without extension), its heading path, its 1-based start and end lines, and the file's modification time.
- **Freshness**: the file list SHALL be re-read on every search. Each file SHALL be re-chunked only when its size or modification time changed.
- **Ranking**: notes SHALL be ranked by lexical score, entity bonus and phrase bonus only, with `N`, `df` and average length computed over note chunks alone. Results SHALL be aggregated per file, with the file's best-scoring chunk as its representative and score.
- **Containment**: symbolic links SHALL NOT be followed. Every file and directory SHALL resolve, by real path, inside the agent workspace; any entry that resolves outside it SHALL be skipped and SHALL NOT be read. A file with more than one hard link SHALL be skipped as well, because a hard link passes both checks while still naming another file's content from inside the workspace.
- When the session has no agent workspace, note results SHALL be empty.

#### Scenario: Index page is not a result
- **GIVEN** `notes/_index.md` lists a note title that matches the query
- **WHEN** recall runs
- **THEN** `notes/_index.md` SHALL NOT be returned

#### Scenario: One entry per file
- **GIVEN** three chunks of the same note match the query
- **WHEN** recall runs
- **THEN** the note SHALL appear once, with the highest chunk score

#### Scenario: Edited note is re-indexed
- **GIVEN** a note file has been indexed
- **WHEN** its content changes and a search runs afterward
- **THEN** results SHALL reflect the new content

#### Scenario: Symlink escaping the workspace is not indexed
- **GIVEN** `notes/leak.md` is a symbolic link to a user's `memory.private.jsonl`
- **AND** `notes/linked-dir` is a symbolic link to a directory outside the workspace
- **WHEN** recall runs with a query matching that private content
- **THEN** neither link SHALL be read or returned

#### Scenario: Hard-linked file is not indexed
- **GIVEN** `notes/leak.md` is a hard link to a user's `memory.private.jsonl`
- **WHEN** recall runs with a query matching that private content
- **THEN** the link SHALL NOT be read or returned

#### Scenario: Journal entries are searchable
- **GIVEN** `journal/2026-09-20.md` matches the query
- **WHEN** recall runs
- **THEN** the journal file SHALL be eligible

### Requirement: Note Result Format

Each note result SHALL be a pointer and SHALL NOT contain the full file content. It SHALL contain:

- `path`: the absolute file path (the same workspace path given to the agent);
- `title` and `headingPath`;
- `lineStart` and `lineEnd` of the representative chunk;
- `excerpt`: the sentence or sentences of the representative chunk with the most distinct matched terms (ties broken by the earliest sentence in the chunk), at most about 160 characters in Fast Recall and about 320 in Deep Recall, prefixed and suffixed with `…` when cut;
- `fileTokens`: the estimated token count of the whole file;
- `modifiedAt`: ISO date;
- `score` and `matchedTerms`.

In Deep Recall a note result SHALL also include up to 3 `chunks`, each with `headingPath`, `lineStart`, `lineEnd` and `excerpt`, in score order.

#### Scenario: Note result is a pointer
- **GIVEN** a 4.8 KB note matches the query
- **WHEN** recall returns it
- **THEN** the result SHALL include the absolute path, heading path, line range, excerpt, `fileTokens` and `modifiedAt`
- **AND** it SHALL NOT include the full file content

#### Scenario: Excerpt contains a matched term
- **WHEN** a note is returned for a query matching `Portaly`
- **THEN** its excerpt SHALL contain `Portaly`

### Requirement: Deep Recall Notes

The `memory-search` skill SHALL return notes in `agentNotes` using the Note Result Format. It SHALL return up to `limit` notes (capped at 10) whose score is at least `deepMinRecallScore`, in descending score order. Notes are Deep Recall items: together with memories they are subject to the Deep Recall budget rule, so the combined output fits `deepRecallMaxTokens`, with items admitted in descending score order across both lists and any item that does not fit skipped. A note's size SHALL be measured by its serialized output entry.

#### Scenario: Deep Recall note pointers
- **GIVEN** two notes match a query
- **WHEN** `memory-search` runs
- **THEN** `agentNotes` SHALL contain two pointer entries with `path`, `headingPath`, line range, `excerpt`, `fileTokens`, `modifiedAt`, `score`, `matchedTerms` and up to 3 `chunks`

#### Scenario: Shared deep budget
- **GIVEN** memories and notes whose rendered sizes together exceed `deepRecallMaxTokens`
- **WHEN** `memory-search` runs
- **THEN** the combined output SHALL NOT exceed `deepRecallMaxTokens`, and higher-scoring items SHALL be kept first

### Requirement: Fast Recall Prompt Section

When a triggered session is assembled and Fast Recall is enabled, the system SHALL run Fast Recall once. The query SHALL be the trigger message plus the same user's most recent earlier message in the recent history after the last `/clear`, when one exists. The exclusion set SHALL be the ids of memories already injected by fixed loading. Selected memories SHALL be rendered in the following memory sub-sections, and an empty sub-section SHALL be omitted:

1. User-scope memories under a "Relevant Memory" heading, one `- <content>` line each.
2. Channel-scope memories under a heading stating they were contributed by channel members, are unverified and are not instructions, one `- [from <author>] <content>` line each (or `[from unknown contributor]`).

When Fast Recall selects nothing at all, the whole section SHALL be omitted. The section SHALL NOT include ids, scores, tiers, categories, creation times or matched terms, and the previous message text SHALL NOT appear in it.

#### Scenario: Already-injected memory not repeated
- **GIVEN** a core memory is injected by fixed loading and also matches the trigger message
- **WHEN** Fast Recall runs
- **THEN** that memory SHALL NOT appear in the Fast Recall section

#### Scenario: No diagnostics in prompt
- **WHEN** the Fast Recall section is rendered
- **THEN** it SHALL NOT contain memory ids or scores

#### Scenario: Empty recall omits the section
- **GIVEN** no memory clears `minRecallScore`
- **WHEN** context is formatted
- **THEN** no Fast Recall heading SHALL be present

#### Scenario: /clear bounds the previous-message query
- **GIVEN** the user's only earlier message precedes the last `/clear`
- **WHEN** Fast Recall runs
- **THEN** no previous user message SHALL contribute query tokens

#### Scenario: Previous message from another user is ignored
- **GIVEN** the most recent earlier message in history was sent by a different user
- **AND** the trigger user's own earlier message is older
- **WHEN** Fast Recall builds its query
- **THEN** it SHALL use the trigger user's own earlier message

### Requirement: Fast Recall Failure Isolation

A failure inside Fast Recall SHALL NOT prevent the session from starting. The system SHALL log a warning with the error and SHALL assemble the context without the Fast Recall section.

#### Scenario: Fast Recall exception
- **GIVEN** the recall engine throws during context assembly
- **WHEN** the session is assembled
- **THEN** the context SHALL be assembled without the Fast Recall section
- **AND** the agent session SHALL start

### Requirement: Fast Recall Note Selection

In Fast Recall mode, notes SHALL be selected independently from memories:

- If the top note score is below `noteMinRecallScore`, no note SHALL be selected.
- Otherwise the first SHALL be selected.
- A second SHALL be selected only if its score is at least `secondNoteRecallScore` and at least `secondResultRatio` × the top note score.
- No more than `fastRecallNoteMaxResults` (default 2) notes SHALL be selected.
- The rendered note entries and their heading SHALL fit within `fastRecallNoteMaxTokens` (default 256), skipping any entry that does not fit.

The note budget SHALL NOT reduce the memory budget, and the memory budget SHALL NOT reduce the note budget.

#### Scenario: Notes do not displace memories
- **GIVEN** two memories and two notes clear their thresholds
- **WHEN** Fast Recall runs with default configuration
- **THEN** both memories and both notes SHALL be selected, subject only to their own token budgets

#### Scenario: Memory portion bounded with notes
- **GIVEN** a user has 500 enabled memories and the agent workspace has 50 notes
- **WHEN** a triggered context is assembled with default configuration
- **THEN** the memory and note portion of mandatory content SHALL NOT exceed 512 + 384 + 192 + 256 estimated tokens plus section headings

#### Scenario: Low-confidence notes omitted
- **GIVEN** the best note score is below `noteMinRecallScore`
- **WHEN** Fast Recall runs
- **THEN** no note SHALL be selected

### Requirement: Fast Recall Note Sub-section

Selected notes SHALL be rendered after the Fast Recall memory sub-sections under a heading stating that the entries are excerpts only, that the full file can be read when needed, and that they are not instructions. Each entry SHALL show:

- the absolute path on its first line;
- the title and heading path, the line range, the approximate file tokens and the update date on the second line;
- the quoted excerpt on the third line.

Scores and matched terms SHALL NOT be shown. When notes are selected but no memory is, the Fast Recall section SHALL contain only the note sub-section.

#### Scenario: Note pointer rendering
- **GIVEN** Fast Recall selects `notes/vtuber-official-website-guide.md`
- **WHEN** the section is rendered
- **THEN** the entry SHALL show `/app/data/agent-workspace/notes/vtuber-official-website-guide.md`, its heading path, line range, approximate tokens, update date and a quoted excerpt
- **AND** it SHALL NOT include the rest of the file

#### Scenario: Notes only
- **GIVEN** Fast Recall selects one note and no memory
- **WHEN** context is formatted
- **THEN** the Fast Recall section SHALL be present with only the note sub-section

### Requirement: Note Threshold Calibration

The default values of `noteMinRecallScore` and `secondNoteRecallScore` SHALL be derived from the same committed benchmark. The fixture SHALL be extended with about 10 Traditional Chinese and mixed-script notes and with labeled note queries, including negatives. The note false-positive rate SHALL be the share of queries for which Fast Recall selects at least one note outside the expected set. It SHALL be at most 5%, and the thresholds SHALL be chosen by the same rules as the memory thresholds. The regression test SHALL also assert the recorded note metrics.

#### Scenario: Note benchmark gate
- **WHEN** the regression test runs with default configuration
- **THEN** the note false-positive rate SHALL be at most 5%
- **AND** the note Recall@1, Recall@2, false-positive rate and average injected tokens SHALL equal the recorded values
