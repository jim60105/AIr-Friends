# Spec Delta

## MODIFIED Requirements

### Requirement: Live-Provenance Admission Decision

The restricted decision SHALL admit allow-table tools only from authenticated native-builtin origin, exact canonical owned-extension origin, or operator client-owned MCP origin. Every admission SHALL use an authoritative live registry observation at the current epoch and resource generation. SDK/RPC-host, workspace and unknown origins SHALL NOT gain builtin trust. A name match alone SHALL be insufficient; stale observations SHALL deny pending re-observation.

#### Scenario: Same name from wrong origin denies
- **GIVEN** a workspace- or host-origin tool carrying the name of an allowed inventory entry
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL deny with the bounded provenance reason
- **AND** the same name recorded from the owned extension origin SHALL admit provenance only

#### Scenario: Post-start operator MCP refresh admitted
- **GIVEN** an operator MCP tool registered or refreshed after process startup with client MCP ownership and a current-epoch registry observation
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL admit the tool gated by client ownership
- **AND** no human elicitation or interactive approval SHALL be required for the admission decision

#### Scenario: Stale registry observation re-observes
- **GIVEN** a tool whose recorded provenance predates the current registry epoch
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL deny admission pending a fresh observation rather than admit on the stale record

#### Scenario: Registry-refresh plumbing owned by the enforcement-wiring change
- **GIVEN** an operator MCP tool whose provenance and freshness hold for the live-origin check
- **WHEN** the live-origin check is satisfied by requiring the fresh provenance observation
- **THEN** the registry-refresh plumbing that feeds that observation SHALL be owned by the enforcement-wiring change, not this decision

#### Scenario: Genuine native builtin reaches its authority
- **WHEN** the live runtime registry uniquely identifies an authentic allow-table native builtin at the current epoch and generation
- **THEN** provenance SHALL admit native-builtin origin without relabelling it as owned extension or host
- **AND** execution SHALL still follow its operation's declared completing authority

#### Scenario: SDK injection is not a builtin
- **WHEN** an SDK/RPC-host tool uses the name or claimed builtin identity of an allowed tool
- **THEN** provenance SHALL deny its host origin
- **AND** absent, ambiguous or inconsistent authoritative metadata SHALL also deny

#### Scenario: Foreign replacement loses native authority
- **GIVEN** a previously authentic builtin is replaced by a same-name extension or SDK registration
- **WHEN** the next call is observed
- **THEN** the current origin SHALL replace the old observation
- **AND** cached builtin metadata SHALL NOT authorize the replacement

### Requirement: Restricted Tool-Inventory Default-Deny Decision

The integration SHALL provide a pure restricted-mode tool decision from tool name, recorded live provenance and decoded input shape. Allow outcomes SHALL name the operation's completing authority rather than authorize execution. Approved local native read/search SHALL use native approval and ambient OS permissions, not asserted ACP filesystem confinement. Every absent table entry SHALL default to deny with a bounded machine-readable reason.

#### Scenario: Unknown tool defaults to deny
- **GIVEN** a restricted OMP session invoking a tool with no inventory table row
- **WHEN** the decision is evaluated for any provenance or input shape
- **THEN** the decision SHALL be deny with the bounded inventory reason
- **AND** no allow path SHALL exist for that name regardless of recorded origin

#### Scenario: OMP-only execution surfaces are denied
- **WHEN** eval, task/subagent, computer, browser, async, launch, debug, AST-mutation, LSP or LSP-referenced config, SSH, an internal device URI scheme, or a configuration write is presented to the restricted decision
- **THEN** each SHALL deny with its bounded inventory reason
- **AND** the table row SHALL cite the approved capability matrix rather than a handoff tool list

#### Scenario: Gated allows delegate completion
- **WHEN** ordinary local read/list/glob/grep/search/find, bash or ordinary write/edit is presented with compliant provenance and decoded input shape
- **THEN** the decision SHALL report its gated or sink-routed outcome naming the native-local or predecessor completing authority
- **AND** the decision module SHALL NOT execute paths, command arguments or record content

#### Scenario: Network parity capabilities gated on pending adapters
- **WHEN** web fetch/URL-read or web search is presented before its completing adapter is available
- **THEN** the decision SHALL report a distinct allow-gated-pending-adapter outcome, never a plain allow and never a parity denial
- **AND** a test SHALL distinguish that outcome from completed adapter admission

#### Scenario: Decision modules are restricted-only
- **GIVEN** a native-YOLO OMP session and an OpenCode session in either permission mode
- **WHEN** their flows are exercised
- **THEN** no restricted tool decision SHALL be consulted for them and no decision denial SHALL be possible
- **AND** OpenCode behavior SHALL remain unchanged

#### Scenario: Allow-row gating inherits session, policy, and sink boundaries
- **GIVEN** an allow row for ordinary local read/list/glob/grep/search/find, bash or ordinary write/edit
- **WHEN** the declared completing authority executes the operation
- **THEN** authenticated local native read/search SHALL follow native activation/approval and the process's ambient OS permissions under the user's accepted native posture
- **AND** that native IO SHALL NOT be claimed confined to daemon session/shared/trusted-skills roots or protected by ACP read denial
- **AND** bash SHALL retain the common command policy and active native permission path
- **AND** ordinary local write/edit SHALL run under the pinned native approval path and the process's ambient OS permissions, with the restricted ACP sink retained as the route the pinned bridge applies where it routes the call, todo state in-session and no new pre-dispatch route gate

#### Scenario: Non-table capabilities route to completing decisions
- **WHEN** delete, move or multi-file patch is presented with compliant provenance
- **THEN** the row SHALL route to the shared complete destructive decision rather than gain a filesystem bypass
- **AND** operator client-owned MCP tools SHALL remain gated by provenance admission

#### Scenario: Inventory omission lands structurally in default-deny
- **GIVEN** a tool absent from the inventory table
- **WHEN** the decision is evaluated for any provenance or input shape
- **THEN** the omission SHALL land in default-deny structurally rather than by audit completeness
- **AND** denial SHALL carry one bounded machine-readable reason

#### Scenario: Surface covers the complete inventory, not handoff lists
- **GIVEN** the pinned OMP tool inventory and implicit side-effect surfaces
- **WHEN** the decision surface is constructed
- **THEN** it SHALL cover that complete inventory, not only historical handoff names
- **AND** nonexistent native list/search names SHALL NOT be synthesized as new tools

## ADDED Requirements

### Requirement: Native Local Read and Search Remain Usable Under Supported Approval

Authentic local native read and built-in search SHALL remain usable under the supported owned settings and native approval posture. Activation, ignore/hidden rules, cwd and output controls SHALL NOT be described as filesystem ACLs. The current runtime pin SHALL remain unchanged when latest official-source investigation supplies no required boundary fix.

#### Scenario: Local builtin search is available
- **WHEN** restricted owned settings are composed
- **THEN** native grep/glob SHALL remain enabled and read-tier calls SHALL retain supported approval without human elicitation
- **AND** find SHALL preserve its existing model-dependent auto activation without new judge/model/backend configuration

#### Scenario: Accepted ambient readability remains explicit
- **WHEN** native local read/search can access a path allowed by process OS permissions but outside daemon session roots
- **THEN** documentation and decision traces SHALL identify native-local IO, not claim protected ACP root confinement
- **AND** client callback protected-read guarantees SHALL remain scoped to callbacks that actually execute

#### Scenario: Newest official version lacks the seam fix
- **WHEN** source inspection of official v18.10.3 finds native direct IO and ACP-denial disk fallback still present
- **THEN** the decision record SHALL distinguish that investigated version from deployment v18.6.1
- **AND** no automatic runtime pin bump, fork or custom IO broker SHALL be introduced

### Requirement: Native Local Admission Does Not Admit Remote or Device Search Routes

Every native read/search root constituent SHALL be screened for alternate, remote and internal-device routes before local admission. A valid local constituent SHALL NOT authorize a mixed unsafe root list. URL reads SHALL remain owned-adapter operations; native fetch materialization SHALL be disabled as defense in depth without disabling controlled adapter transport.

#### Scenario: All roots in a native search request are screened
- **WHEN** a local search contains multiple path/glob roots or selectors with any HTTP(S), SSH, internal/xd/device or alternate-execution target
- **THEN** the whole call SHALL deny before native scanning or materialization
- **AND** checking only its first root SHALL NOT suffice

#### Scenario: Ordinary local path and pattern are not shell execution
- **WHEN** native grep/glob/available-find receives a valid local path/root list and literal search pattern
- **THEN** the native local operation SHALL remain usable
- **AND** pattern text alone SHALL NOT be confused with a path URI or shell command

#### Scenario: Controlled URL adapter remains available
- **WHEN** restricted settings disable native fetch materialization and a genuine owned read adapter receives an authorized HTTP(S) URL
- **THEN** its existing controlled per-hop transport SHALL remain available
- **AND** native grep URL materialization or native read transport fallback SHALL remain blocked

#### Scenario: Mutation authority remains unchanged
- **WHEN** authentic native bash, ordinary write/edit or destructive input is evaluated
- **THEN** the common-command authority, the pinned native approval path and the complete-destructive fail-closed decision SHALL remain in force
- **AND** ordinary write/edit SHALL run under that native approval and the process's ambient OS permissions without a pre-dispatch sink-route evidence gate
- **AND** uncertain targets, device/config writes or alternate bypass shapes SHALL remain fail-closed

### Requirement: Authorized Ambient Native Mutation

Ordinary local native write/edit SHALL run under the pinned native approval path and the process's ambient OS permissions, with no pre-dispatch sink-route evidence gate. Where the pinned bridge routes a call, the ACP sink decision and denial propagation stay in force; absolute native sandbox/plan targets and an unavailable client bridge do not reach it and SHALL be documented as the authorized residual risk. Destructive mutation SHALL keep the shared complete fail-closed decision.

#### Scenario: Ordinary native write and edit are authorized ambient mutation
- **WHEN** an ordinary local native write/edit is evaluated under the pinned native approval path
- **THEN** it SHALL execute under the process's ambient OS permissions exactly as the accepted native local read/search posture does, with the ACP sink retained for the calls the pinned bridge actually routes
- **AND** the artifacts SHALL record the user's explicit authorization of the ambient native mutation risk without a fabricated sink guarantee or a still-pending prerequisite

#### Scenario: Absolute sandbox and plan targets take the authorized ambient path
- **WHEN** an ordinary-looking absolute path resolves to a native session sandbox/plan exemption, or the native client bridge/capability is unavailable
- **THEN** the pinned native dispatch path SHALL execute the write/edit under the user's authorized ambient native posture instead of denying it behind a pre-dispatch route gate
- **AND** documentation and decision traces SHALL record that this path does not reach the ACP sink rather than claiming sink protection for it

### Requirement: Native Registry Observation Uses the Supported Runtime Surface

Native enforcement SHALL obtain live configured-tool metadata from the pinned extension API's supported direct registry method after runtime initialization. It SHALL NOT depend on an undeclared nested context API, evaluate unavailable action methods during load or treat model-provided source metadata as authority.

#### Scenario: Factory registers before runtime actions are available
- **WHEN** the factory loads before runtime action methods can be called
- **THEN** handlers and replacements SHALL register without reading the live roster
- **AND** later calls SHALL obtain the initialized direct runtime roster

#### Scenario: Runtime roster cannot be observed
- **WHEN** the direct registry method is absent, throws or returns ambiguous invoked-name metadata
- **THEN** restricted dispatch SHALL deny with a bounded observation reason
- **AND** model claims or startup-name caches SHALL NOT substitute

#### Scenario: Unrestricted registration remains empty
- **WHEN** the factory observes native-YOLO
- **THEN** it SHALL register no restricted handler or controlled replacement
- **AND** OpenCode, both-agent/both-mode LSP, sandbox/egress and cancelled readiness SHALL remain unchanged
