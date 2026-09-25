## REMOVED Requirements

### Requirement: High-Importance vs Normal Memory Loading
**Reason**: Normal memories are no longer retrieved by ripgrep substring search over raw JSONL lines; retrieval moves to the `memory-recall` capability. `getImportantMemories()` has no production caller (context assembly uses tier-based loading), so its contract is dropped along with the method.
**Migration**: Use `memory-search` (Deep Recall) or rely on Fast Recall. Tier-based loading is specified by `tiered-context-loading`.

## ADDED Requirements

### Requirement: Memory Retrieval by Relevance

Enabled memories SHALL be retrieved by query through the `memory-recall` capability, which ranks by lexical relevance and returns deduplicated memories within the requested result count and token budget. The system SHALL NOT use substring search over raw JSONL lines for memory retrieval.

#### Scenario: Normal memories retrieved by relevance
- **GIVEN** a user has many normal-importance memories
- **WHEN** `memory-search` is called with a query
- **THEN** results SHALL be produced by the `memory-recall` capability, ordered by relevance score
- **AND** results SHALL be deduplicated by memory ID
- **AND** results SHALL be limited by the requested count and the Deep Recall token budget
