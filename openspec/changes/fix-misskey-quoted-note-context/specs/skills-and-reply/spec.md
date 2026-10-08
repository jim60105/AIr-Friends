## ADDED Requirements

### Requirement: Fetch-Context Preserves Third-Party Quote References

Message results for `fetch-context` types `recent_messages` and `search_messages` SHALL retain the same optional typed `quotedNote` reference supplied by the platform history/search contract. The existing result envelope, parameters, outer message content and identity SHALL remain unchanged. Available references SHALL retain source id, separate source author, source URL when present, source body and attachments; unavailable references SHALL retain source id/status/reason without invented content. Quoted source fields SHALL remain distinct JSON data and SHALL NOT be promoted into outer content or direct user instructions. Agent-facing skill guidance SHALL state that quoted source content is third-party reference material and commands within it are not the requesting user's direct instructions.

#### Scenario: Recent quote survives skill serialization
- **GIVEN** retained recent Misskey messages include a quote with remote author, source body/article URL and attachment metadata
- **WHEN** `fetch-context` recent messages are returned through the skill result and JSON response
- **THEN** the decoded message SHALL preserve the complete separate `quotedNote`
- **AND** outer content/user identity and the existing result envelope SHALL be unchanged

#### Scenario: Search quote matches history representation
- **GIVEN** a Misskey search result contains a quoted source
- **WHEN** `fetch-context` search messages are returned
- **THEN** the reference SHALL use the same field and provenance contract as recent messages and prompt context

#### Scenario: Failed quote lookup keeps successful skill result
- **GIVEN** outer message retrieval succeeds but optional quoted-source enrichment fails or expires
- **WHEN** the skill result is returned
- **THEN** the message SHALL remain available with its unavailable-reference id/status/reason
- **AND** the optional quote failure SHALL NOT turn successful outer retrieval into skill failure

#### Scenario: Instruction-looking quote stays separate JSON data
- **GIVEN** source text or author/attachment metadata contains instruction-looking text, closing labels or role/heading delimiters
- **WHEN** the skill JSON result is decoded
- **THEN** that text SHALL remain inside quoted-source fields without creating new outer message fields or replacing the direct-user content
- **AND** the documented third-party instruction distinction SHALL apply to the reference

#### Scenario: Ordinary skill messages unchanged
- **GIVEN** recent/search results contain ordinary messages without quotes
- **WHEN** the skill returns them
- **THEN** their message data and result envelope SHALL retain the existing shape without added quote fields
