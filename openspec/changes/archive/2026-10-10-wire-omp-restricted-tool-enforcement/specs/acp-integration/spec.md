## ADDED Requirements

### Requirement: Trusted-Extension Tool-Call Enforcement Wiring

The AIr-owned trusted extension SHALL attach the restricted `tool_call` enforcement handler body to the handler slot registered synchronously during trusted-module loading; that body SHALL decide every restricted tool call solely by composing the restricted tool decision modules — inventory allow/default-deny, live-provenance admit/deny, alternate-route blocking, destructive-intent consumption, and advisory approval-record interpretation — with no decision logic of its own.

#### Scenario: Denied-tool fixture reaches the fail-closed block
- **GIVEN** a restricted handler fixture presenting a tool the inventory decision denies
- **WHEN** the handler body is consulted for that call
- **THEN** the call SHALL be blocked with the bounded inventory reason
- **AND** the underlying tool operation SHALL NOT proceed

#### Scenario: Wrong-origin same-name call blocked live
- **GIVEN** a call whose tool name is on the allow table but whose CURRENT recorded origin is host, workspace, or unowned discovery
- **WHEN** the handler body composes the provenance decision for that call
- **THEN** the call SHALL be blocked with the bounded provenance reason
- **AND** the same name recorded from an owning origin SHALL proceed to its completing authority

#### Scenario: Alternate-route pair blocked beneath an allowed ordinary route
- **GIVEN** a capability whose ordinary tool route would reach an allow-gated or sink-routed outcome
- **WHEN** the same capability-and-route pair is presented through an internal device scheme, configuration device, debug, AST, SSH, or LSP-adjacent route
- **THEN** the handler SHALL block the call with the bounded alternate-route reason naming the pair

#### Scenario: Advisory record never short-circuits a denial
- **GIVEN** an effective approval map containing a surviving lower-layer `allow` record for a tool the inventory or provenance decision denies
- **WHEN** the handler composition runs for that call
- **THEN** the denial SHALL stand and the record SHALL appear only as an advisory input in the decision trace
- **AND** no composition ordering SHALL consult records before inventory, provenance, and alternate-route decisions

#### Scenario: Wiring changes land in decision tables
- **GIVEN** a behavior change requiring new decision logic, call ordering, freshness rules, or error-vocabulary entries
- **WHEN** the wiring is implemented
- **THEN** the change SHALL be made in the decision tables, which along with call ordering, freshness rules, and error vocabulary are the only wiring-owned data
- **AND** the handler body SHALL acquire no decision logic of its own

#### Scenario: Composition cannot be short-circuited
- **GIVEN** a call carrying an advisory approval record, a pending-adapter outcome, or a completion-delegation marker
- **WHEN** the handler body composes the steps in order
- **THEN** no such record, outcome, or marker SHALL short-circuit an inventory, provenance, or alternate-route denial

#### Scenario: Allowed outcomes name the completing authority
- **GIVEN** an allow-gated, sink-routed, or admitted-MCP outcome
- **WHEN** the handler body completes the decision
- **THEN** it SHALL name the completing predecessor authority
- **AND** the handler itself SHALL NOT assert authorization

### Requirement: Per-Call Consultation With Live Origin Observation

The enforcement handler SHALL be consulted on EVERY restricted tool call, including tools that first appear mid-session through dynamic registration or recovery re-discovery, and SHALL read, fresh on each call, the tool's current recorded origin, the current registry epoch, and the current resource generation; no decision, origin record, or registry snapshot SHALL be memoized across calls or trusted from startup.

#### Scenario: Mid-session tool is in scope automatically
- **GIVEN** a tool registered after trusted-module load
- **WHEN** its first restricted call arrives
- **THEN** the handler SHALL consult the decisions against the live registry state of that call
- **AND** no startup-time filter or snapshot SHALL be consulted

#### Scenario: Provenance consumed live, not cached
- **GIVEN** a test fixture whose recorded origin for a tool changes between two otherwise identical calls
- **WHEN** both calls are handled
- **THEN** the two decisions SHALL differ consistently with the current observation
- **AND** any implementation that cached the first decision SHALL fail this scenario

#### Scenario: Stale epoch re-observes instead of admitting
- **GIVEN** a call whose recorded origin observation predates the current registry epoch
- **WHEN** the handler composes the provenance decision
- **THEN** the call SHALL be blocked with the bounded stale-observation reason
- **AND** admission SHALL be possible only on a fresh observation

#### Scenario: Handler failure fails closed
- **GIVEN** a handler composition that throws or exceeds its execution bound
- **WHEN** the call is dispatched
- **THEN** the tool call SHALL be blocked fail-closed
- **AND** no code path SHALL continue the call after the failure

#### Scenario: Stale resource generation denies until refreshed
- **GIVEN** a call whose current resource generation is stale relative to the live tool-metadata observation
- **WHEN** the handler composes the decision
- **THEN** the call SHALL be denied with the re-observe denial rather than admitted

### Requirement: Bounded Fail-Closed Enforcement Errors

A blocked restricted call SHALL surface to the client as a fail-closed tool-call error carrying exactly one bounded machine-readable code from the finite union of the decision-module reason vocabulary and the wiring-level codes for seam blocks, stale observations, and pending-adapter blocks.

#### Scenario: Error shape is bounded and non-secret
- **WHEN** any block fixture's error is inspected
- **THEN** its fields SHALL all originate from the finite code/enumeration set
- **AND** no fixture error SHALL carry payload text, path content, secret material, or model-generated content

#### Scenario: Block is not an elicitation
- **GIVEN** a restricted call blocked by inventory, provenance, alternate-route, destructive, seam, or stale-observation reasons
- **WHEN** the block is surfaced
- **THEN** no permission request, form elicitation, or human-interaction surface SHALL be invoked
- **AND** the run SHALL observe an ordinary bounded failed-tool-call error

#### Scenario: Pending adapter blocks rather than silently allowing
- **GIVEN** a network-parity capability whose completing adapter has not landed
- **WHEN** the handler composes the inventory decision reporting the distinct pending-adapter outcome
- **THEN** the call SHALL be blocked with the bounded pending-adapter reason
- **AND** no unadapted native transport SHALL be reachable through that call

#### Scenario: Error names only enumerated fields
- **GIVEN** a blocked restricted call
- **WHEN** its fail-closed error is surfaced
- **THEN** the error SHALL name at most the capability identifier, route surface, origin category, and stale element, all from static enumerations
- **AND** the error SHALL NOT contain file or argument payloads, model or chat content, credentials, tokens, secrets, or raw tool output

#### Scenario: No retry-prompt echo of blocks
- **GIVEN** a restricted call blocked by any enforcement reason
- **WHEN** the failure is surfaced to the run
- **THEN** the block SHALL NOT be echoed into the retry prompt rejection buffer

### Requirement: Post-Start MCP Registry Refresh Re-Admission

When operator or client-owned MCP tools register or refresh AFTER startup, the wiring SHALL advance the registry epoch from the live tool-metadata observation, re-invoke the MCP admission decision for the fresh epoch, and decide each call from current data, with no generic human-elicitation or form UI anywhere in the path.

#### Scenario: Refreshed owned MCP tool re-admitted on fresh epoch
- **GIVEN** an operator MCP tool registered or refreshed after startup with client ownership and a current-epoch observation
- **WHEN** a restricted call to that tool is handled
- **THEN** the admission decision SHALL be re-invoked for the current epoch and the call SHALL proceed to its completing authority
- **AND** no human interaction SHALL occur in the admission path

#### Scenario: Refreshed untrusted tool stays denied
- **GIVEN** a post-start registration or refresh whose recorded origin is not client MCP ownership or which presents an alternate-route surface
- **WHEN** the refresh path and subsequent calls are handled
- **THEN** the tool SHALL remain denied with the bounded provenance or alternate-route reason
- **AND** the refresh event itself SHALL NOT grant or soften anything

#### Scenario: Refresh carries no one-shot acknowledgement
- **GIVEN** a refreshed MCP tool admitted on one call
- **WHEN** its origin observation or the epoch later goes stale
- **THEN** subsequent calls SHALL deny on staleness without honoring any earlier refresh-time admission

#### Scenario: Refresh freshness uses the registry epoch only
- **GIVEN** a registry refresh that advances the epoch during a session flow
- **WHEN** the next restricted tool call is evaluated
- **THEN** the current registry epoch SHALL be observed afresh and a stale observation SHALL deny
- **AND** no readiness signal, reset, channel or handshake SHALL be consumed

#### Scenario: Unowned-discovery refresh stays denied
- **GIVEN** a post-start MCP registration or refresh recorded under unowned discovery
- **WHEN** a restricted call to that tool is handled
- **THEN** the tool SHALL remain denied with its bounded reason

### Requirement: Restricted-Only Enforcement Registration

The enforcement handler SHALL be attached only in the restricted trusted-extension process, gated on the module's own restricted-mode launch identity, and the exemption SHALL be structural at the registration site — not a mode check inside the decision path.

#### Scenario: YOLO process registers no handler
- **GIVEN** a native-YOLO OMP process fixture built from the shared bootstrap's YOLO branch
- **WHEN** trusted-module loading completes
- **THEN** no restricted tool-call handler SHALL be registered
- **AND** no restricted decision, denial, or record load SHALL be reachable in that process

#### Scenario: OpenCode has no extension handler
- **GIVEN** an OpenCode session flow in either permission mode
- **WHEN** its flows are exercised
- **THEN** no OMP extension or enforcement handler SHALL be loaded
- **AND** behavior SHALL be unchanged from before this requirement

#### Scenario: Non-restricted identity fails closed at the entry
- **GIVEN** a handler entry invoked with an observed process identity that is not the restricted one
- **WHEN** the entry runs
- **THEN** it SHALL fail closed rather than dispatch any composition

### Requirement: Fail-Closed Behavior At Unresolved Inherited Seams

The wiring SHALL export a named enforcement-wiring gate enumerating every inherited unresolved seam with its source verdict reproduced verbatim and its DECIDED user disposition, together with the handler's fail-closed behavior at each seam.

#### Scenario: Seam fixtures fail closed carrying markers
- **WHEN** a fixture exercises each unresolved seam — record survival, destructive undecodability, pending adapter
- **THEN** the call SHALL be blocked fail-closed with its bounded code and the named seam marker
- **AND** no seam fixture SHALL produce an allow or grant contrary to policy

#### Scenario: Passing wiring tests cannot clear the gates
- **WHEN** every wiring, refresh, error-shape, and exemption test passes
- **THEN** the exported gate SHALL still report each inherited verdict verbatim with its DECIDED disposition where recorded
- **AND** no synthetic allow-fixture SHALL be citable as native support for any seam

#### Scenario: Gate resolution requires the source decision
- **WHEN** an implementer proposes to treat any listed seam as resolved
- **THEN** the recorded user dispositions SHALL govern application without changing the inherited verdict; only source-backed evidence may support a new native-mechanism claim
- **AND** these specifications SHALL NOT be rewritten to claim support in advance

#### Scenario: The gate enumerates every inherited seam's verdict
- **GIVEN** the inherited unresolved seams — MCP admission mechanism basis needing a mechanism audit with no boundary row in the pinned compatibility ledger, authoritative approval-record reset incompatible, complete destructive-intent decoding unresolved, network-parity adapters pending, and discovery-side gates consumed as shipped
- **WHEN** the named enforcement-wiring gate is read
- **THEN** each seam SHALL appear with its source verdict reproduced verbatim and its DECIDED user disposition

#### Scenario: No manufactured status completes a fixture or flow
- **GIVEN** any fixture or flow requiring an allow, grant, decoding, or mechanism status
- **WHEN** it runs against the wiring
- **THEN** the wiring SHALL NOT manufacture a passing admission, grant, decoding, or mechanism status to complete it
- **AND** allow-path fixtures SHALL be labeled synthetic, and no fixture or passing test SHALL relabel a status or clear a gate

#### Scenario: Docs state the absence-of-handler residual risk
- **GIVEN** the unresolved seams still standing
- **WHEN** documentation describes the wiring's runtime limits
- **THEN** it SHALL state that no readiness handshake is required and, when handler installation fails, the pinned non-YOLO native approval mode plus client ACP policy remain the ACP-mediated boundary, with fail-closed client policy denials
- **AND** the wiring's evidence SHALL be described as covering wiring decisions only

### Requirement: Enforcement Wiring Evidence Limited To Wiring Decisions

Automated unit and mock evidence SHALL validate the wiring decisions and shapes only — denied fixtures reaching fail-closed bounded errors, provenance consumed live rather than cached, refresh re-admission and rejection on epoch, restricted-only registration with YOLO and OpenCode exemption, seam fail-closed markers, and composition ordering.

#### Scenario: No native-enforcement claim in fixtures
- **WHEN** the wiring suites are reviewed and run
- **THEN** no assertion SHALL claim the native binary dispatched, honored, or enforced anything
- **AND** user-facing documentation SHALL keep the runtime checklist items explicitly unverified

#### Scenario: Predecessor suites prove read-only consumption
- **GIVEN** the decision-module, sink-policy, destructive-policy and discovery suites
- **WHEN** they run unchanged alongside this change
- **THEN** they SHALL pass without modification
- **AND** the wiring SHALL have imported their modules without editing them

#### Scenario: No fixture asserts native enforcement
- **GIVEN** the wiring unit and mock suites
- **WHEN** they assert, imply, or describe what the official OMP binary does
- **THEN** they SHALL NOT claim the binary invokes the enforcement handler, honors a block, enforces an inventory decision, performs an approval-record reset, decodes destructive intent, or otherwise enforces any boundary

#### Scenario: Real invocation stays user-owned runtime verification
- **WHEN** real handler invocation and block enforcement by the official OMP binary are considered
- **THEN** they SHALL remain user-owned runtime verification marked unverified until observed

#### Scenario: Lifecycle errors do not prove handler installation
- **GIVEN** an extension that fails to load
- **WHEN** pinned `runner.emit` logs a lifecycle-hook error without failing startup
- **THEN** the session may lack the restricted capability set and no client-observable readiness assertion SHALL be made
- **AND** the native approval/client ACP fallback SHALL NOT be described as equivalent execution-time default-deny or proof of native callback coverage
