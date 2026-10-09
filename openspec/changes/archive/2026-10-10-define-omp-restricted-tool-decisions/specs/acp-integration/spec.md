## ADDED Requirements

### Requirement: Restricted Tool-Inventory Default-Deny Decision

The integration SHALL provide a pure restricted-mode tool decision surface where every decision is a pure function of tool name, recorded live provenance, and decoded input shape. An allow decision SHALL only state which predecessor decision completes authorization, never authorizing execution itself, while every tool absent from the table SHALL default to deny with one bounded machine-readable reason.

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
- **WHEN** read, list, glob, grep, bash, or an ordinary write/edit is presented with compliant provenance
- **THEN** the decision SHALL report an allow-gated or sink-routed outcome naming the completing predecessor decision
- **AND** the decision module SHALL NOT itself evaluate paths, command arguments, or record content

#### Scenario: Network parity capabilities gated on pending adapters
- **WHEN** web fetch/URL-read, web search, or public code/docs search is presented to the restricted decision before the transport/search changes land
- **THEN** the decision SHALL report a distinct allow-gated-pending-adapter outcome, never a plain allow and never a parity denial
- **AND** a test SHALL assert the pending-adapter outcome is distinguishable from allow

#### Scenario: Decision modules are restricted-only
- **GIVEN** a native-YOLO OMP session and an OpenCode session in either permission mode
- **WHEN** their flows are exercised
- **THEN** no restricted tool decision SHALL be consulted for them and no decision denial SHALL be possible
- **AND** OpenCode behavior SHALL be unchanged from before this requirement

#### Scenario: Allow-row gating inherits session, policy, and sink boundaries
- **GIVEN** an allow row for read/list/glob/grep, search-class tools, bash, or ordinary write/edit
- **WHEN** the completing predecessor decision executes the delegated tool
- **THEN** read, list, glob, grep, and search-class SHALL gate to the existing filesystem session boundaries plus authorized shared/read-only roots and the trusted-skills read root
- **AND** bash SHALL gate to the existing common command policy with the extra native permission path kept active
- **AND** ordinary write/edit SHALL route to the restricted filesystem sinks with todo state kept in-session and never open a filesystem mutation route

#### Scenario: Non-table capabilities route to completing decisions
- **WHEN** delete, move, or multi-file patch is presented with compliant provenance
- **THEN** the row SHALL route to the shared destructive decision rather than a filesystem route
- **AND** operator client-owned MCP tools SHALL gate by the provenance decision

#### Scenario: Inventory omission lands structurally in default-deny
- **GIVEN** a tool absent from the inventory table
- **WHEN** the decision is evaluated for any provenance or input shape
- **THEN** the omission SHALL land in default-deny structurally rather than by audit completeness
- **AND** the denial SHALL carry one bounded machine-readable reason

#### Scenario: Surface covers the complete inventory, not handoff lists
- **GIVEN** the pinned OMP tool inventory and its implicit side-effect surfaces
- **WHEN** the tool decision surface is constructed
- **THEN** it SHALL cover the complete inventory, not only the tool names listed in historical handoffs

### Requirement: Live-Provenance Admission Decision

The restricted decision SHALL admit a tool only from an authoritative recorded origin: allow-table names carried by the owned trusted extension under its exact contracted module ownership, and operator MCP tools whose recorded origin is the ACP client's MCP ownership together with a live registry observation no staler than the current registry epoch. A name match alone SHALL be structurally insufficient, and a stale observation SHALL deny pending re-observation rather than admit.

#### Scenario: Same name from wrong origin denies
- **GIVEN** a workspace- or host-origin tool carrying the name of an allowed inventory entry
- **WHEN** the provenance decision is evaluated
- **THEN** the decision SHALL deny with the bounded provenance reason
- **AND** the same name recorded from the owned extension origin SHALL admit

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

### Requirement: Alternate-Execution-Entrypoint Blocking Decision

For every capability with an allowed ordinary-tool route, the restricted decision SHALL deny that capability when reached through any different route — an internal device URI scheme, a configuration-write device, a debug device, an AST-mutation device, an SSH device, or an LSP-adjacent mutation route — keying the block on the capability-and-route pair from the decoded input shape, not the tool name alone, and SHALL deny with a bounded reason naming the capability and route pair.

#### Scenario: Allowed capability denied via internal scheme
- **GIVEN** an execution capability whose ordinary tool is allow-gated
- **WHEN** the same capability is presented through an internal device URI scheme route
- **THEN** the decision SHALL deny with the alternate-route reason naming the capability and route

#### Scenario: Config-write posture flip denied while writes are sink-routed
- **GIVEN** ordinary write/edit routed to the filesystem sinks
- **WHEN** an input shape classified as a configuration write targets approval posture or security-relevant settings
- **THEN** the decision SHALL deny the config-device route regardless of the write route's outcome

#### Scenario: Route block survives tool rename
- **WHEN** an alternate-route denial is presented under a different tool name carrying the same capability-and-route pair
- **THEN** the decision SHALL deny with the same capability-and-route pair reason

#### Scenario: Gate or sink status does not excuse an alternate route
- **GIVEN** a capability whose ordinary tool is allow-gated or sink-routed
- **WHEN** the capability is reached through a different route
- **THEN** the decision SHALL deny regardless of the ordinary route's gated or sink-routed status

#### Scenario: Hidden and device routes are fixture cases of the blocking
- **GIVEN** read or write otherwise allowed, or bash separately gated
- **WHEN** a hidden mutation, debug, or device route is reached, or execution proceeds through an internal scheme while bash is separately gated
- **THEN** each SHALL be a fixture case of this blocking, denied with the capability-and-route reason

### Requirement: Exact-Key Approval-Record Interpretation With No Inherited Grants

The restricted decision SHALL interpret native approval records by exact registered tool key only — never wildcard, prefix, or emulated default-deny — and SHALL treat every surviving lower-layer record as non-authoritative: a surviving `allow` record SHALL never yield an execution-time grant, a surviving `prompt` record SHALL never convert a restricted deny into generic elicitation.

#### Scenario: Surviving lower-layer grant does not grant
- **GIVEN** an effective approval map containing a lower-layer `allow` record that survived the folded overlay merge for a tool the restricted decision denies
- **WHEN** the record interpretation is evaluated
- **THEN** the decision SHALL deny and name the surviving-record reason
- **AND** no code path SHALL convert a record-layer `allow` into execution-time admission

#### Scenario: Surviving prompt record does not elicit
- **GIVEN** a lower-layer `prompt` record surviving for a tool the restricted decision denies
- **WHEN** the decision is evaluated
- **THEN** the outcome SHALL remain deny with its bounded reason
- **AND** no generic elicitation, form, or interactive approval SHALL be requested

#### Scenario: Exact-key lookup only
- **WHEN** an approval record exists only under a key that is not the exact registered tool key of the presented call
- **THEN** the interpretation SHALL find no record and the default-deny decision SHALL stand
- **AND** no wildcard or prefix match SHALL be consulted

#### Scenario: Surviving-record behavior modeled without relying on record reset
- **GIVEN** folded overlays letting lower-layer grant, prompt, and deny records persist into an OMP process, with the authoritative record reset recorded as incompatible at the pin
- **WHEN** the record interpretation is evaluated
- **THEN** it SHALL model the surviving-record behavior faithfully and consume the owned-settings change's record-authority verdict without softening it
- **AND** it SHALL NOT assert or depend on a working settings-layer record reset anywhere

#### Scenario: Surviving records are inputs only; default-deny is operative
- **GIVEN** a restricted execution-time decision with surviving lower-layer records
- **WHEN** the record interpretation is evaluated
- **THEN** surviving records SHALL be reported as inputs only
- **AND** the restricted execution-time default-deny SHALL remain the operative boundary

### Requirement: Destructive-Intent Decision Consumed From The Shared Conformance Table

The restricted decision SHALL expose a destructive-intent decision that, given a decoded complete destructive intent in the compatibility contract's shape, returns the shared destructive module's all-target verdict verbatim — normalization, per-target authorization, and completeness verdict delegated, with no second normalizer, no re-derived target logic, and zero side effect on the deny path.

#### Scenario: Conformance fixtures replay identically
- **WHEN** each shared destructive conformance fixture is replayed through the restricted destructive decision
- **THEN** the returned verdict SHALL equal the shared table's verdict for that fixture
- **AND** the module SHALL contain no independent path-authorization logic

#### Scenario: Incomplete intent fails closed with zero side effect
- **GIVEN** a destructive-shaped input whose decoded target set is incomplete or unparseable
- **WHEN** the restricted destructive decision is evaluated
- **THEN** the shared fail-closed reason SHALL be returned with zero mutation attempted

#### Scenario: Fixture families replay through the entry
- **WHEN** complete multi-target authorization, first-target-allowed-with-later-escape denial, incomplete-intent fail-closed, and binding-mismatch rejection fixtures are replayed through the restricted destructive decision
- **THEN** each SHALL return the shared table's verdict for that fixture

#### Scenario: No speculative decoder when native decoding is unavailable
- **GIVEN** the compatibility contract records complete native decoding as unavailable
- **WHEN** a destructive intent is presented to the restricted destructive decision
- **THEN** the honest outcome SHALL be the shared module's fail-closed reason
- **AND** no speculative decoder SHALL be introduced in this entry

### Requirement: MCP Admission Decision With Honest Mechanism Tiers

The restricted decision SHALL admit client-owned operator MCP tools purely on ownership plus registry freshness plus alternate-route screening, and SHALL export the mechanism status of the MCP admission basis as named data tiered from the pinned compatibility ledger: with no MCP boundary row present, the native-side MCP admission mechanism basis SHALL be labeled as needing a mechanism audit, candidate identity paths labeled candidate-to-verify, and no element labeled supported.

#### Scenario: Ledger gap is labeled, never inflated
- **WHEN** the MCP admission mechanism status is exported or inspected
- **THEN** it SHALL record the absence of an MCP boundary row in the pinned ledger
- **AND** no fixture, test pass, or local suite SHALL relabel the basis as supported

#### Scenario: Client-owned MCP tool admitted by decision
- **GIVEN** an operator MCP tool with client ownership, current-epoch observation, and no alternate-route surface
- **WHEN** the MCP admission decision is evaluated
- **THEN** the decision SHALL admit gated by client ownership without any human interaction

#### Scenario: Export cites the ledger gap for downstream consumers
- **GIVEN** the MCP admission mechanism status exported as named data tiered from the pinned compatibility ledger
- **WHEN** the ledger contains no MCP boundary row
- **THEN** the exported status table SHALL cite the ledger gap explicitly so downstream wiring and combined-regression consumers inherit the label
- **AND** the admission decision SHALL require no generic human elicitation

### Requirement: Restricted Tool Decision Verdicts Retain Decided Dispositions

The restricted tool decision modules SHALL preserve the inherited authoritative record-reset incompatible-as-stated and complete destructive-intent unresolved verdicts verbatim, independently from their DECIDED user dispositions. Settings-discovery-path control SHALL replace reset reliance, and the complete ACP-mediated destructive path SHALL remain the boundary with incomplete native shapes denied. No readiness gate or further pending decision SHALL be required.

#### Scenario: Passing decision tests cannot clear the gates
- **WHEN** every decision-table, provenance, record-interpretation, and destructive-consumption test passes
- **THEN** the exported gate SHALL still report record-reset incompatible and destructive-intent unresolved with pinned verdict text and their DECIDED dispositions
- **AND** no synthetic allow-fixture SHALL be citable as native support

#### Scenario: Decided dispositions do not assert native support
- **WHEN** an implementer proposes to treat the record reset or destructive decoding as solved
- **THEN** the DECIDED deployment dispositions SHALL govern application while the native verdicts remain unchanged; any new native-support claim SHALL require source-backed evidence
- **AND** these specifications SHALL NOT be rewritten to claim support in advance of that decision

#### Scenario: Unit and mock evidence validates decision logic only
- **GIVEN** automated unit and mock evidence for these decision modules
- **WHEN** the restricted decision logic is validated — deny-when-unlisted, deny-on-wrong-provenance, deny-on-alternate-route, deny-despite-surviving-grant, and destructive verdicts via the shared table
- **THEN** the evidence SHALL NOT demonstrate that the official binary enforces, resets records, or decodes complete destructive intent
