## MODIFIED Requirements

### Requirement: Search Scoring Formula

Memory search results SHALL be ranked primarily by lexical relevance as defined by the `memory-recall` capability. `decay` and recency SHALL contribute only bounded additive bonuses: `0.20 × decay` and `0.20 × max(0, 1 − ageDays / 365)`. These bonuses apply only to memories with a positive lexical score, so they reorder results of similar relevance and never make a non-matching memory eligible.

#### Scenario: High-decay memory ranks higher
- **GIVEN** two memories match a search query with equal lexical, entity and phrase scores
- **AND** memory A has `decay: 0.9` and memory B has `decay: 0.3`, with equal other metadata
- **WHEN** search results are ranked
- **THEN** memory A SHALL rank higher than memory B

#### Scenario: Recency bonus applied
- **GIVEN** two memories have the same `decay`, metadata and relevance scores
- **AND** memory A was created 1 day ago, memory B was created 30 days ago
- **WHEN** search results are ranked
- **THEN** memory A SHALL rank higher than memory B

#### Scenario: Decay does not override relevance
- **GIVEN** memory A has a lexical score at least 1.0 higher than memory B
- **AND** memory A has `decay: 0.1` and memory B has `decay: 1.0`, with equal other metadata
- **WHEN** search results are ranked
- **THEN** memory A SHALL rank higher than memory B
