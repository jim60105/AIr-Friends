# Spec Delta

## ADDED Requirements

### Requirement: Consumer Skill Handoff Regression Suite

The combined skill-handoff suite SHALL drive real orchestration, Skill API, session registry and reply/file/reaction handlers with the shared mock ACP fixture and mock platform. Both spawn shapes SHALL preserve authored native skill discovery, shared root/script inventory and current-session JWT/staging isolation.

#### Scenario: Both spawn shapes
- **WHEN** per-spawn and pooled OMP stage a payload and invoke a delivered absolute skill script path
- **THEN** the current session SHALL deliver its expected reply/file/reaction through the real handler chain with its own JWT and staging location.

#### Scenario: Isolation and retry
- **WHEN** a sibling JWT/staging path is presented or a session finishes without a response
- **THEN** the existing shared denial/retry rules SHALL remain and no sibling delivery or duplicate response SHALL occur.

#### Scenario: OpenCode consumer path
- **WHEN** OpenCode performs the same existing skill handoff
- **THEN** its current discovery, callback, script-entry and delivery outcomes SHALL remain unchanged.

#### Scenario: File and reaction responses retain summary behavior
- **WHEN** a turn delivers a file-only or reaction-only response
- **THEN** it SHALL satisfy the existing response gate without becoming a text-reply summary trigger, and retry SHALL remain suppressed.

#### Scenario: Literal instructions and one retry
- **WHEN** a turn has no recorded response in either spawn shape
- **THEN** the existing retry SHALL run once with the active literal session ID, script root and staging path; a second missing response SHALL follow the current failure path.

#### Scenario: Consumer coverage stays cross-component
- **WHEN** the combined suite asserts a delivery, rejection or retry
- **THEN** it SHALL exercise the real orchestration and Skill API/handler chain rather than duplicate a single-component wiring or schema assertion.

### Requirement: Skill Handoff Evidence And Deterministic Native Fixtures

Skill-handoff acceptance SHALL assert consumer-visible authorization, side effects and session transitions, label mocked ACP/model/platform evidence honestly, and preserve deterministic fixtures. Removed OMP governance assertions SHALL not be replaced by inverse requirements on upstream behavior.

#### Scenario: Behavior evidence
- **WHEN** handoff tests report successful delivery or a permission denial
- **THEN** results SHALL identify the exercised real components and mocks without claiming native/image/platform acceptance.

#### Scenario: Native evidence distinct
- **WHEN** a pinned official executable exercises native skill discovery/tool dispatch with a scripted loopback model
- **THEN** the report SHALL record its version and actual tool/result boundary separately from model reasoning and public network search success.

## REMOVED Requirements

### Requirement: Combined Mocked Skill-Handoff Regression Suite

**Reason**: The old suite contract mandates governance provenance and synthetic-positive assumptions.

**Migration**: Use Consumer Skill Handoff Regression Suite; retain real-component delivery, response/retry and session isolation behavior.

### Requirement: Skill-Handoff Suite Honest Posture and Determinism

**Reason**: The old requirements mandate cancelled governance assertions and prohibit the now-required native smoke evidence.

**Migration**: Use Skill Handoff Evidence And Deterministic Native Fixtures, labeling mocks, native executable and image/platform evidence separately.

