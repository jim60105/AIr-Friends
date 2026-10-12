# Spec Delta

## ADDED Requirements

### Requirement: Restricted Enforcement Registers Through the Native Extension Contract

The restricted extension SHALL install its tool-call handler and controlled replacement tools through the pinned native extension API during factory evaluation. Native runtime callbacks SHALL execute the existing enforcement decisions before tool execution. Returning a factory value or attaching a private handler slot SHALL NOT substitute for native registration. Native-YOLO sessions SHALL remain outside this registration.

#### Scenario: Native callback reaches the enforcing boundary
- **WHEN** the default factory is evaluated with the pinned API contract and a restricted native tool-call event is delivered
- **THEN** the registered callback SHALL evaluate the existing inventory and completing policy before execution
- **AND** a denied call SHALL produce the native bounded block response with zero dispatch

#### Scenario: Native YOLO remains independent
- **WHEN** the factory observes native-YOLO mode
- **THEN** it SHALL NOT register the restricted enforcement or controlled replacement tools
- **AND** the existing both-mode LSP decision SHALL remain unchanged

### Requirement: Native Events Use Trusted Session and Origin Context

Each native call SHALL obtain fresh configured-tool source metadata and trusted acquired-session context. Origin, ownership, approvals, and adapter completion SHALL NOT be accepted from model input. Missing, ambiguous, foreign, stale, or unrepresentable required context SHALL deny before execution. Owned replacement tools SHALL be admitted by their actual extension provenance, not relabelled as builtins.

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
