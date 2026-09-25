## ADDED Requirements

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
