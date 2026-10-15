# Spec Delta

## ADDED Requirements

### Requirement: Information Gathering Follows a Concrete Context Need

Bundled reply instructions SHALL permit a reply using adequate supplied context without additional information gathering. They SHALL require targeted retrieval when relevant history is missing or the user explicitly requests recall. They SHALL NOT require a memory search, workspace read or browser visit before every reply, and SHALL preserve the session's required delivery mechanism.

#### Scenario: Adequate context for a greeting
- **GIVEN** the supplied user context and recent messages suffice for a greeting
- **WHEN** normal or channel-lurk reply instructions are rendered
- **THEN** they SHALL permit an in-character reply without additional retrieval
- **AND** they SHALL still require the delivery skill for an external text reply
- **AND** this permission SHALL depend on context sufficiency rather than a hard-coded greeting string

#### Scenario: Missing history requires recall
- **GIVEN** the question needs history absent from supplied context, or explicitly requests recall
- **WHEN** reply instructions are rendered
- **THEN** they SHALL direct targeted memory search and permit the existing category/scope filters
- **AND** workspace or browser gathering SHALL be tied to information relevant to that request

#### Scenario: A single owning retrieval rule
- **WHEN** the bundled reply instructions are rendered for OpenCode or OMP in restricted or YOLO mode
- **THEN** the memory-retrieval section SHALL own the context-sufficiency rule once
- **AND** no later critical rule SHALL impose unconditional information gathering
- **AND** existing character, memory-correction and memory-saving guidance SHALL remain available

### Requirement: Conversational Templates Do Not Require Reasoning Narration

Bundled reply, spontaneous-post and dashboard-chat instructions SHALL NOT require think-out-loud narration or a narrated thought process before replies or tools. They SHALL preserve character voice and session-specific work. Dashboard chat SHALL retain direct text output and its skill prohibition.

#### Scenario: Reply review without compulsory narration
- **WHEN** the reply template is rendered
- **THEN** it SHALL retain an instruction to review the reply before delivery without requiring narration
- **AND** it SHALL NOT require a reasoning transcript before tool use

#### Scenario: Spontaneous posting retains its purpose
- **WHEN** the spontaneous-post template is rendered
- **THEN** it SHALL retain topic selection and character-authored posting instructions
- **AND** it SHALL NOT require narrating how the post was designed

#### Scenario: Dashboard chat remains skill-free
- **WHEN** dashboard-chat instructions are rendered
- **THEN** they SHALL require an in-character direct response without compulsory reasoning narration
- **AND** they SHALL NOT acquire memory-search, reply-skill or other external-delivery requirements
