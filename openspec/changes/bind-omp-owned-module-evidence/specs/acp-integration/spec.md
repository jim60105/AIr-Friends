# Spec Delta

## MODIFIED Requirements

### Requirement: Exact Owned-Module Trust Scope

Only the exact selected generated module artifact at its deployment-declared canonical root, together with its pinned permitted dependency closure, SHALL be trusted. Module trust SHALL consume physical deployment-root and loaded-artifact evidence independent of mutable process state and session filesystem authority. Canonical source files SHALL remain build inputs, not alternative load entries.

#### Scenario: Identical module outside the owned root is untrusted
- **GIVEN** a workspace, home, or package-cache path holds a copy of the owned module content
- **WHEN** the ownership decision is evaluated
- **THEN** the copy SHALL be excluded with an untrusted-location reason
- **AND** no trusted-extension argument, read exception, or skill authority SHALL be granted to it

#### Scenario: Critical-name match alone confers nothing
- **GIVEN** a discovered candidate is named after a critical skill or critical tool
- **WHEN** trust and critical-name resolution are evaluated
- **THEN** the candidate SHALL remain untrusted and SHALL NOT resolve the critical name
- **AND** the decision SHALL record name-only trust as rejected

#### Scenario: Escaping link out of the owned root is untrusted
- **GIVEN** a symlink or linked package inside the owned root resolves outside its canonical identity
- **WHEN** the ownership decision is evaluated
- **THEN** the candidate SHALL be untrusted with the canonical symlink-escape or identity-mismatch reason
- **AND** ordinary skills and workspace content outside the owned root SHALL remain unaffected otherwise

#### Scenario: Owned-root trust reuses canonical root identity
- **GIVEN** an owned-root path is evaluated for trust
- **WHEN** the ownership decision is computed
- **THEN** trust SHALL reuse the canonical filesystem-root identity decisions
- **AND** SHALL NOT apply a second canonicalizer or a lexical prefix test

#### Scenario: Escape is untrusted despite a readable destination
- **GIVEN** a symlink or linked package inside the owned root leaves the owned canonical root
- **WHEN** the ownership decision is evaluated
- **THEN** the linked module SHALL be untrusted even when its destination is otherwise readable

#### Scenario: Permission mode is not part of owned-module identity
- **WHEN** owned-module identity is evaluated
- **THEN** identity SHALL NOT depend on permission mode

#### Scenario: Installed artifact is independent of launch state root
- **GIVEN** the declared image generated artifact is physically owned and unchanged
- **WHEN** a restricted per-spawn or pooled process observes it from its own distinct mutable state cwd
- **THEN** module ownership SHALL identify that exact artifact without requiring it under the process state root
- **AND** the state root SHALL gain no deployment-module authority

#### Scenario: Development generated artifact follows the same contract
- **WHEN** the declared generated development artifact has valid build-owned source identity and physical root/file identities
- **THEN** the exact generated artifact SHALL satisfy module ownership using that declaration
- **AND** a raw source file or arbitrary module-parent directory SHALL NOT satisfy it

#### Scenario: Development source ownership is not image immutability
- **WHEN** the real declared development artifact is developer-owned rather than root-owned
- **THEN** its exact build declaration and anchored physical identities SHALL govern source ownership without a new read-only mount prerequisite
- **AND** later substitution or metadata movement SHALL deny rather than silently reanchor

#### Scenario: Accepted module identity changes
- **WHEN** the declared root, loaded artifact, link-free component identity or replacement fingerprint changes after acceptance
- **THEN** module admission SHALL deny with a bounded ownership reason
- **AND** a fresh observation SHALL NOT silently replace the accepted trusted anchor

### Requirement: Native Events Use Trusted Session and Origin Context

Each native call SHALL obtain fresh tool origin metadata and the trusted context required by its operation. Owned replacements SHALL use independent physical deployment-module evidence, not invented session filesystem authority. Session-bound operations SHALL require acquired session context. Missing, ambiguous, foreign, stale or unrepresentable required evidence SHALL deny; model input SHALL NOT provide origin, ownership, approval or adapter completion.

#### Scenario: Registry changes after the first call
- **GIVEN** an initially owned tool is replaced by a foreign same-name registration
- **WHEN** the next native call is evaluated
- **THEN** the new source observation SHALL be used and the call SHALL be denied
- **AND** a cached startup origin SHALL NOT authorize it

#### Scenario: Model input cannot forge admission
- **WHEN** input supplies an owned-origin claim, shared-write permission, or adapter-complete flag absent from trusted context
- **THEN** those claims SHALL NOT grant authority
- **AND** missing required trusted context SHALL produce a bounded denial

#### Scenario: All execution targets are decoded
- **WHEN** a native destructive or command call contains an incomplete or escaping target set
- **THEN** its real decoded inputs SHALL reach the shared completing policy
- **AND** the operation SHALL be denied before any target is mutated

#### Scenario: Valid owned replacement retains its identity
- **WHEN** fresh native metadata identifies a replacement under the declared canonical owned extension root
- **THEN** its actual owned-extension origin SHALL reach provenance admission
- **AND** admission SHALL still require the operation's separate completing boundary

#### Scenario: Controlled network needs no invented session roots
- **GIVEN** the default factory has valid physical module evidence but no session filesystem context
- **WHEN** an owned controlled URL read or web search is invoked
- **THEN** provenance SHALL use that module evidence and reach its separate network/backend admission
- **AND** no ACP id, skill-session id, canonical target or shared-write grant SHALL be fabricated

#### Scenario: Missing destructive context stays closed
- **GIVEN** the module identity is valid but acquired destructive-session context is missing or incomplete
- **WHEN** a destructive call is evaluated
- **THEN** module admission SHALL NOT grant destructive authority and the operation SHALL deny before mutation

## ADDED Requirements

### Requirement: Owned Replacement Admission Preserves Separate Completion

Genuine owned replacement admission SHALL precede and retain the existing operation-specific controlled transport, search backend or trusted instruction-root policy. Module ownership SHALL NOT imply adapter completion, credential availability, skill ownership or filesystem authority. Denied completion SHALL NOT use native network or untrusted source fallback.

#### Scenario: Owned URL read reaches per-hop controlled transport
- **WHEN** a physically owned current-generation URL-read replacement is called for an authorized HTTP(S) destination
- **THEN** it SHALL reach the existing classified per-hop controlled transport
- **AND** denied addresses, redirects and alternate/device schemes SHALL remain denied without native fallback

#### Scenario: Owned search reaches the existing configured backend
- **WHEN** a physically owned current-generation web_search replacement is invoked
- **THEN** it SHALL reach existing backend selection and credential/host admission
- **AND** absent credentials or denied completion SHALL NOT fall back to a native provider

#### Scenario: Owned skill URI reaches its independent exact-root check
- **WHEN** a physically owned read replacement receives an owned skill instruction URI
- **THEN** the existing image-only OMP_IMAGE_SKILLS_ROOT and current skill identity SHALL be checked separately
- **AND** only successful skill authorization SHALL delegate the original URI unchanged

#### Scenario: Development module ownership does not add skill URI authority
- **WHEN** an owned development module receives a skill URI without the existing declared image skill source
- **THEN** skill authorization SHALL retain its off-image denial with no development/workspace fallback root
- **AND** native script-root selection for delivered prompts SHALL NOT expand that URI grant

#### Scenario: Module observation missing or stale
- **WHEN** physical module metadata is missing, violates its declared image/development ownership posture, is linked, outside the declaration or stale at the current epoch/generation
- **THEN** owned replacement admission SHALL deny before transport, backend execution or skill delegation
- **AND** no source-name or process-state-root fallback SHALL admit it

#### Scenario: Owned local read uses the accepted native posture
- **WHEN** the physically owned read replacement receives an ordinary screened local path
- **THEN** it SHALL delegate unchanged through the supported captured native reader under native approval and ambient OS permissions
- **AND** it SHALL NOT invent daemon session-root evidence or claim protected descriptor confinement
