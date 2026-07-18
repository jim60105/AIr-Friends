## ADDED Requirements

### Requirement: Untrusted RSS Content Delimiting

The self-research prompt SHALL delimit each interpolated RSS/feed item with explicit untrusted-content markers and an instruction not to follow any directives contained within the delimited text, so that externally-sourced feed content is presented to the model as third-party data rather than as prompt instructions. Bare, undelimited interpolation of feed `title`/`source`/`url`/`description` into the prompt SHALL NOT be used.

#### Scenario: RSS items wrapped in untrusted-content markers
- **GIVEN** a self-research session with fetched RSS items
- **WHEN** `buildSelfResearchPrompt` assembles the Reference Materials block
- **THEN** each item's title/source/url/description SHALL be enclosed in explicit untrusted-content start/end markers
- **AND** the block SHALL include an instruction directing the model not to follow any instructions contained within the delimited feed content

#### Scenario: No bare interpolation
- **GIVEN** the assembled self-research prompt
- **WHEN** feed content is rendered into it
- **THEN** the feed content SHALL appear only inside the untrusted-content delimiters, not as an undelimited list
