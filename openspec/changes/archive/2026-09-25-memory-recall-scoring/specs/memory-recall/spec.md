## ADDED Requirements

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
