# Spec Delta

## ADDED Requirements

### Requirement: Controlled Replacements Have Native Parameter Contracts

Each registered controlled read or web-search replacement SHALL supply the pinned native runtime's mandatory parameter schema and execute contract. Accepted inputs SHALL agree with its parser. Invalid native input SHALL be rejected before transport dispatch. Ordinary non-network read inputs SHALL retain same-tool native delegation without a second filesystem implementation.

#### Scenario: Native registration can consume the definition
- **WHEN** a native-compatible consumer registers the read and web-search replacements and submits valid inputs
- **THEN** their schemas SHALL be accepted and their executors SHALL receive the declared input shapes
- **AND** malformed paths or queries SHALL be rejected before any transport request

#### Scenario: Local read retains native semantics
- **WHEN** an authorized ordinary local read reaches the replacement
- **THEN** the same-tool native delegate SHALL execute once and its result SHALL be preserved
- **AND** a missing delegate SHALL yield an explicit error, not an unguarded local read

### Requirement: Controlled Read Results Use Native Content Representations

Controlled results SHALL use native content arrays and honest result/error metadata. Text SHALL remain text, supported images SHALL use the native encoded-image representation, and other binary data SHALL retain an explicit native-compatible binary representation with its MIME and retrieved data. Arbitrary binary bytes SHALL NOT be labelled as an image. Attribution and cancellation/error semantics SHALL be preserved.

#### Scenario: Supported image and non-image binary remain distinct
- **WHEN** controlled read retrieves an image fixture and a non-image binary fixture
- **THEN** the native consumer SHALL receive a valid encoded image only for the supported image
- **AND** the non-image result SHALL retain its MIME and exact retrieved data without an image content label

#### Scenario: Text and failure are not fabricated successes
- **WHEN** controlled read retrieves attributed text or encounters a transport failure
- **THEN** the native consumer SHALL receive the attributed text or the explicit native error respectively
- **AND** failure SHALL NOT produce empty successful content, invented attribution, or native fallback traffic
