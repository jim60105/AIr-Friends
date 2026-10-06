## ADDED Requirements

### Requirement: Restricted Tool-Inventory Default-Deny Decision

The integration SHALL provide a pure restricted-mode tool decision surface over the complete pinned OMP tool inventory and its implicit side-effect surfaces — not only the tool names listed in historical handoffs — where every decision is a pure function of tool name, recorded live provenance, and decoded input shape. Allow rows SHALL delegate completion: read/list/glob/grep and search-class tools gated to the existing filesystem session boundaries plus authorized shared/read-only roots and the trusted-skills read root; bash gated to the existing common command policy with the extra native permission path kept active; ordinary write/edit routed to the restricted filesystem sinks with todo state kept in-session and never opening a filesystem mutation route; delete/move/multi-file patch routed to the shared destructive decision; operator client-owned MCP tools gated by the provenance decision. Every tool NOT on the table and every OMP-only execution surface outside the approved capability set — eval, task/subagent, computer, browser, async, launch, debug, AST mutation, the LSP tool and LSP-referenced configuration, SSH, internal device URI schemes, and configuration writes — SHALL default to deny with one bounded machine-readable reason, and an inventory omission SHALL land in default-deny structurally rather than by audit completeness. An allow decision SHALL never itself authorize execution; it SHALL only state which predecessor decision completes authorization. The decision modules SHALL be consulted only for OMP restricted sessions: native-YOLO OMP sessions SHALL receive none of these clamps and OpenCode flows SHALL be behaviorally unchanged.

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

### Requirement: Live-Provenance Admission Decision

The restricted decision SHALL admit a tool only from an authoritative recorded origin: allow-table names carried by the owned trusted extension under its exact contracted module ownership, and operator MCP tools whose recorded origin is the ACP client's MCP ownership together with a live registry observation no staler than the current registry epoch. A name match alone SHALL be structurally insufficient: a host, workspace, or otherwise unowned-discovered tool presenting an allow-table name SHALL deny even though the same name from the owning origin admits. A stale registry observation SHALL yield a re-observe denial rather than admission. Operator MCP tools registered or refreshed AFTER startup SHALL be admitted by this decision when their provenance and freshness hold — the live-origin check is satisfied by requiring the fresh provenance observation, and the registry-refresh plumbing that feeds the observation is owned by the enforcement-wiring change, not this decision.

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

### Requirement: Alternate-Execution-Entrypoint Blocking Decision

For every capability with an allowed ordinary-tool route, the restricted decision SHALL deny that capability when reached through a different route — an internal device URI scheme, a configuration-write device, a debug device, an AST-mutation device, an SSH device, or an LSP-adjacent mutation route — even though the capability's ordinary tool is allow-gated or sink-routed. The block SHALL key on the capability-and-route pair derived from the decoded input shape, not on the tool name alone, and SHALL deny with a bounded reason naming the capability and route pair. Configuration writes that would alter approval posture, hidden mutation or debug or device routes reached while read or write is otherwise allowed, and execution through an internal scheme while bash is separately gated SHALL each be fixture cases of this blocking.

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

### Requirement: Exact-Key Approval-Record Interpretation With No Inherited Grants

The restricted decision SHALL interpret native approval records by exact registered tool key only — never wildcard, prefix, or emulated default-deny — and SHALL treat every surviving lower-layer record as non-authoritative: a surviving lower-layer `allow` record SHALL never yield an execution-time grant, a surviving `prompt` record SHALL never convert a restricted deny into generic elicitation, and surviving records SHALL be reported as inputs only, with the restricted execution-time default-deny as the operative boundary. Because the compatibility contract records the authoritative record reset as incompatible at the pin — folded overlays let lower-layer grant, prompt, and deny records persist into an OMP process — this interpretation SHALL model the surviving-record behavior faithfully, SHALL consume the owned-settings change's record-authority verdict without softening it, and SHALL NOT assert or depend on a working settings-layer record reset anywhere.

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

### Requirement: Destructive-Intent Decision Consumed From The Shared Conformance Table

The restricted decision SHALL expose a destructive-intent decision that, given a decoded complete destructive intent in the compatibility contract's shape, returns the shared destructive module's all-target verdict verbatim — normalization, per-target authorization, and completeness verdict delegated, with no second normalizer, no re-derived target logic, and zero side effect on the deny path. The shared module's exported conformance fixtures SHALL replay through this entry with identical verdicts, including complete multi-target authorization, first-target-allowed-with-later-escape denial, incomplete-intent fail-closed, and binding-mismatch rejection. Where the compatibility contract records complete native decoding as unavailable, the honest outcome SHALL be the shared module's fail-closed reason, and no speculative decoder SHALL be introduced here.

#### Scenario: Conformance fixtures replay identically
- **WHEN** each shared destructive conformance fixture is replayed through the restricted destructive decision
- **THEN** the returned verdict SHALL equal the shared table's verdict for that fixture
- **AND** the module SHALL contain no independent path-authorization logic

#### Scenario: Incomplete intent fails closed with zero side effect
- **GIVEN** a destructive-shaped input whose decoded target set is incomplete or unparseable
- **WHEN** the restricted destructive decision is evaluated
- **THEN** the shared fail-closed reason SHALL be returned with zero mutation attempted

### Requirement: MCP Admission Decision With Honest Mechanism Tiers

The restricted decision SHALL admit client-owned operator MCP tools purely on ownership plus registry freshness plus alternate-route screening, and SHALL export the mechanism status of its MCP admission basis as named data tiered from the pinned compatibility ledger: with no MCP boundary row present in that ledger, the native-side MCP admission mechanism basis SHALL be labeled as needing a mechanism audit, candidate identity paths labeled candidate-to-verify, and no element labeled supported. The exported status table SHALL cite the ledger gap explicitly so downstream wiring and combined-regression consumers inherit the label, and the admission decision SHALL require no generic human elicitation.

#### Scenario: Ledger gap is labeled, never inflated
- **WHEN** the MCP admission mechanism status is exported or inspected
- **THEN** it SHALL record the absence of an MCP boundary row in the pinned ledger
- **AND** no fixture, test pass, or local suite SHALL relabel the basis as supported

#### Scenario: Client-owned MCP tool admitted by decision
- **GIVEN** an operator MCP tool with client ownership, current-epoch observation, and no alternate-route surface
- **WHEN** the MCP admission decision is evaluated
- **THEN** the decision SHALL admit gated by client ownership without any human interaction

### Requirement: Restricted Tool Decision Compatibility Gates Remain Blocking

The restricted tool decision modules SHALL export a named compatibility gate carrying, verbatim from the pinned ledger, the authoritative record-reset verdict as incompatible-as-stated and the complete destructive-intent verdict as unresolved, each with a required user decision, mirroring the owned-settings and readiness gates. While those gates stand, these decision modules SHALL ship and be locally testable as the restricted execution-time default-deny that holds the boundary, and resolution SHALL require a source-backed supported mechanism recorded in the compatibility contract plus an explicit user design decision. Automated unit and mock evidence SHALL validate the decision logic only — deny-when-unlisted, deny-on-wrong-provenance, deny-on-alternate-route, deny-despite-surviving-grant, destructive verdicts via the shared table — and SHALL NOT demonstrate that the official binary enforces, resets records, or decodes complete destructive intent.

#### Scenario: Passing decision tests cannot clear the gates
- **WHEN** every decision-table, provenance, record-interpretation, and destructive-consumption test passes
- **THEN** the exported gate SHALL still report record-reset incompatible and destructive-intent unresolved with pinned verdict text and required user decisions
- **AND** no synthetic allow-fixture SHALL be citable as native support

#### Scenario: Gate resolution requires a user decision
- **WHEN** an implementer proposes to treat the record reset or destructive decoding as solved
- **THEN** the change SHALL be blocked until the compatibility contract records a source-backed supported mechanism at the pin and an explicit user decision adopts it
- **AND** these specifications SHALL NOT be rewritten to claim support in advance of that decision
