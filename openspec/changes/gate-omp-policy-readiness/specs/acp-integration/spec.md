## ADDED Requirements

### Requirement: Trusted-Module Restricted Readiness Signal

The AIr-owned trusted extension module SHALL install its restricted `tool_call` enforcement-handler slot synchronously during trusted-module loading and SHALL emit, for the exact current process instance and ACP session, a bounded readiness signal carrying handler-installation status, lifecycle-initialization status, policy revision, live tool-registry epoch, and the discovery guard's resource generation. The signal SHALL carry no restricted tool policy content: tool inventory, provenance default-deny, alternate-entry blocking, and destructive-action admission belong to the restricted tool policy change. Every restricted session's readiness state SHALL initialize to false, and a signal reporting the handler slot uninstalled SHALL be structurally unable to yield readiness in any consumer. The integration SHALL derive the registry epoch from live tool-identity/provenance observations — including operator MCP registration and refresh occurring after startup — and SHALL NOT derive any readiness value from chat content, prompt text, tool titles, or session-update payloads.

#### Scenario: Signal is emitted at module load with false default
- **GIVEN** a restricted OMP process whose trusted module loaded successfully
- **WHEN** the module finishes synchronous handler-slot installation
- **THEN** the emitted signal SHALL report the handler-installation and lifecycle-initialization statuses with the current policy revision, registry epoch, and resource generation
- **AND** the affected session's readiness state SHALL remain false until an authenticated establishment succeeds

#### Scenario: Signal carries no policy
- **WHEN** the emitted signal is inspected
- **THEN** it SHALL NOT contain a tool inventory, allow/deny records, provenance decisions, or destructive-action admissions
- **AND** any consumer requiring policy content SHALL obtain it from the restricted tool policy boundary

#### Scenario: Post-start MCP registration advances the epoch
- **GIVEN** a ready restricted session on a live process
- **WHEN** an operator MCP server registers or refreshes tools after startup
- **THEN** the signal's registry epoch SHALL advance
- **AND** the previous readiness assertion SHALL no longer match the current epoch

### Requirement: Authenticated Readiness Establishment Contract

Readiness for a restricted OMP session SHALL be established only by a result validated against the compatibility contract's readiness tuple — current process instance, current ACP session identity, restricted mode, fresh challenge, policy revision, and registry epoch — together with control-channel evidence and an independently verified identity binding. Authentication SHALL use process/session-scoped material only: the raw platform token and the raw Skill API server secret SHALL NOT be used as or embedded in the authenticator, and shared-secret material SHALL NOT be placed where model-visible files, workspaces, or native tooling can read it. Chat content SHALL NOT be able to set, advance, or renew readiness through any code path. Each mechanism element SHALL carry the pinned contract's status label — the synchronous registration and lifecycle-failure signal as supported, the native-to-ACP session-identity binding as candidate-to-verify, and the narrow authenticated control channel as recorded by the pinned contract — and the integration SHALL NOT define, rename, or invent an ACP method or notification to carry readiness.

#### Scenario: Forbidden authenticators reject
- **WHEN** establishment evidence cites the platform token, the Skill API server secret, or any secret readable by the model or native tooling
- **THEN** the validator SHALL reject the establishment and leave readiness false
- **AND** the rejection diagnostic SHALL name the rejected authenticator category without reproducing secret material

#### Scenario: Chat-asserted readiness is unrepresentable
- **GIVEN** prompt text, tool titles, or session-update content asserting that policy is ready
- **WHEN** the readiness state is evaluated
- **THEN** readiness SHALL remain unchanged
- **AND** no code path SHALL accept content-derived fields as establishment evidence

#### Scenario: Tuple mismatch rejects
- **GIVEN** an establishment result whose process instance, ACP session, mode, challenge, policy revision, or registry epoch does not match the current values
- **WHEN** validation runs
- **THEN** the establishment SHALL be rejected with a bounded reason naming the mismatched element
- **AND** readiness SHALL remain false

#### Scenario: Identity binding remains candidate-to-verify
- **WHEN** the identity-binding element is exercised by fixtures
- **THEN** the fixture SHALL be labeled adapter evidence at the candidate-to-verify status
- **AND** no result SHALL mark the native-to-ACP identity binding supported without a pinned-contract revision

### Requirement: Restricted Session First-Prompt Readiness Gate

For agent type `omp` with resolved permission mode restricted, the connector SHALL verify, before the first normal prompt of that ACP session — after gate-context registration and model/reasoning application complete — that readiness is established for that exact session and current process instance. When readiness is not established, the session SHALL be denied: the run SHALL end through the affected session's existing error handling with a bounded machine-readable readiness rejection reason, and the integration SHALL NOT spawn or reuse an unguarded or extensionless process, SHALL NOT substitute another agent type, SHALL NOT promote the session to a permissive mode, and SHALL NOT retry the prompt against the readiness gate. A lifecycle-handler failure, timeout, or partial initialization SHALL leave restricted execution blocked. Successful session creation or session load alone SHALL NOT establish readiness, and readiness SHALL NOT be requested or enforced for native-YOLO OMP sessions or for any OpenCode session. A readiness verification failure SHALL NOT be recorded into the permission-rejection buffer consumed by retry-prompt enrichment.

#### Scenario: Not-ready restricted session is denied before prompting
- **GIVEN** a restricted OMP session with no established readiness
- **WHEN** its first normal prompt is requested
- **THEN** the prompt SHALL NOT be sent and the session SHALL end with the bounded readiness-rejection reason
- **AND** no process spawn, agent-type substitution, mode promotion, or readiness retry SHALL occur

#### Scenario: Established readiness allows the prompt
- **GIVEN** a restricted OMP session whose readiness is established for the current process instance and session identity
- **WHEN** its first normal prompt is requested
- **THEN** the prompt SHALL proceed on that session
- **AND** later prompts on the same verified tuple SHALL NOT depend on prompt success as a readiness source

#### Scenario: Lifecycle failure and timeout block
- **GIVEN** a restricted session whose trusted-module lifecycle reported failure, timeout, or partial initialization
- **WHEN** readiness is evaluated for its prompt
- **THEN** the session SHALL be denied with the lifecycle-failure reason
- **AND** the block SHALL persist until a fresh authenticated establishment on the same process instance succeeds

#### Scenario: Session creation success is not a readiness certificate
- **GIVEN** a restricted session whose `session/new` (or `session/load`) completed successfully
- **WHEN** readiness is evaluated without an independent establishment
- **THEN** the evaluation SHALL report not-ready and the prompt SHALL be denied

#### Scenario: Native-YOLO exemption
- **GIVEN** an OMP session whose recorded resolved mode is native-YOLO
- **WHEN** its first prompt is requested
- **THEN** no readiness verification SHALL be performed and no readiness denial SHALL be possible
- **AND** the session's flow SHALL be unchanged from before this requirement

#### Scenario: OpenCode flows unaffected
- **GIVEN** an OpenCode deployment session in either permission mode
- **WHEN** prompts are issued through the same orchestrator paths
- **THEN** no readiness state SHALL be created and no readiness decision SHALL occur
- **AND** the flow SHALL be behaviorally unchanged

### Requirement: Readiness Reset And Re-Verification Across Transitions

Restricted readiness SHALL be reset and re-verified on new session creation, session load, crash-reconnect recovery, connection re-establishment or process respawn, pool reclaim, post-start operator MCP registration or tool-registry refresh, and any change of the trusted module's resource generation. Re-verification SHALL re-check the current process instance, session identity, challenge freshness, policy revision, registry epoch, and resource generation on every evaluation, and SHALL NOT be satisfied by a one-time startup acknowledgement. An acknowledgement established for a prior process instance SHALL NOT be reused after a respawn, and process identity SHALL NOT rely on a process id alone. Recovery re-verification SHALL attach to the recovery change's named post-restore hook without relocating or altering gate-context restoration, and a rejected re-verification SHALL fail only the affected session's recovery.

#### Scenario: Recovery re-verifies on the new process instance
- **GIVEN** a restricted session recovered after process death, with an acknowledgement established on the dead process instance
- **WHEN** recovery reaches the post-restore hook
- **THEN** readiness SHALL be false until an establishment bound to the NEW process instance succeeds
- **AND** the prior instance's acknowledgement SHALL be rejected with a cross-process-instance reason

#### Scenario: Registry refresh revokes readiness
- **GIVEN** a restricted session whose readiness is established
- **WHEN** an operator MCP tool-registry refresh advances the registry epoch before the next prompt
- **THEN** readiness SHALL be reset to false
- **AND** the next prompt SHALL require re-verification

#### Scenario: Re-verification is freshness-checked, not acknowledged-once
- **GIVEN** a session that was ready earlier on the same process instance
- **WHEN** its readiness is re-evaluated with a stale challenge, stale policy revision, stale registry epoch, or stale resource generation
- **THEN** the evaluation SHALL report not-ready with the stale element named in the bounded diagnostic

#### Scenario: Hook rejection stays isolated
- **GIVEN** a recovery whose readiness re-verification rejects while a sibling session runs on the same process
- **WHEN** recovery completes
- **THEN** only the affected session's recovery SHALL fail, with the recovery change's bounded readiness reason
- **AND** the sibling session's readiness state, gate context, process, and lease SHALL be unaffected

### Requirement: Readiness Compatibility Gate Remains Blocking

The integration SHALL record a named application gate carrying the pinned policy-readiness verdict verbatim — partial support, overall unresolved, with the narrow authenticated control channel and the native-to-ACP identity binding unresolved at the pin — together with a required user decision. While that gate stands, the establishment channel SHALL remain unimplemented so that every real restricted-session evaluation resolves to not-ready and the prompt gate denies, and resolution SHALL require a source-backed supported mechanism recorded in the compatibility contract plus an explicit user design decision. Automated unit and mock evidence SHALL validate the client decision logic and the module's readiness-signal contract only — deny-when-not-ready, allow-when-a-labeled-synthetic-fixture-establishes-readiness, reset-on-refresh, cross-process-instance non-reuse, native-YOLO exemption, OpenCode non-regression — and SHALL NOT be presented as evidence that the official binary emits, verifies, or enforces readiness.

#### Scenario: Passing mocks cannot clear the gate
- **WHEN** every readiness decision, signal, and gate test passes
- **THEN** the gate SHALL still report unresolved with its pinned verdict text and a required user decision
- **AND** no fixture, including a synthetic ready-fixture, SHALL be cited as native support or clear the gate

#### Scenario: Gate resolution requires a user decision
- **WHEN** an implementer proposes to close the gate
- **THEN** the change SHALL be blocked until the compatibility contract records a source-backed supported control channel and identity binding at the pin and an explicit user decision adopts them
- **AND** the specification SHALL NOT be rewritten to claim support in advance of that decision

#### Scenario: Fail-closed while gated
- **GIVEN** the gate stands open with the channel unimplemented
- **WHEN** a restricted OMP session requests its first prompt
- **THEN** the session SHALL be denied rather than executed on an unguarded process
- **AND** the documentation SHALL present the user decision options instead of a workaround

#### Scenario: Not a human approval surface
- **WHEN** readiness verification runs or fails
- **THEN** no form elicitation, interactive approval prompt, or human-confirmation UI SHALL be invoked
- **AND** an already authorized capability SHALL NOT require a human interaction to execute
