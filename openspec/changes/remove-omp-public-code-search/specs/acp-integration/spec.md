# Spec Delta

## MODIFIED Requirements

### Requirement: OMP Native Transport Compatibility Contract

The transport contract SHALL identify supported adaptation reachability for native URL-read text/binary paths, web search, including redirects and secondary scraper/provider requests.

#### Scenario: Partial native transport override is rejected
- **WHEN** source-backed route fixtures cover enrichment fetches but binary, alternate-page, redirect or search routes bypass the controlled transport
- **THEN** the assessment SHALL report incomplete adaptation rather than a supported full-transport verdict

#### Scenario: Enforcing adapter decision preserves useful results
- **WHEN** established-route fixtures receive public text/binary/search results and enforcing-egress redirect or secondary requests to private targets
- **THEN** the adapter contract checks SHALL return the permitted public result with attribution while rejecting prohibited hops before their mocked dispatch
- **AND** proxy routing SHALL be explicit and provider failure SHALL remain a failure without fabricated results or unguarded retries

#### Scenario: Explicit unrestricted egress is not redefined
- **WHEN** the operator selects the existing unrestricted-egress posture
- **THEN** the fixture expectation SHALL follow that selected posture rather than impose a newly invented YOLO-only network denial

#### Scenario: Enforcing egress validates every hop
- **WHEN** enforcing egress is configured
- **THEN** every relevant hop SHALL be validated through existing egress rules and the explicitly controlled proxy or transport
- **AND** failures SHALL produce honest errors with no unguarded retry

#### Scenario: Selected egress postures stay distinct
- **WHEN** explicit unrestricted egress or approved provider routing is selected
- **THEN** it SHALL remain distinct from arbitrary tool targets

#### Scenario: Proxy presence is not coverage
- **WHEN** proxy environment variables are present or only a partial native fetch override exists
- **THEN** the contract SHALL NOT accept them as proof of complete native coverage

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
- **WHEN** web fetch/URL-read or web search is presented to the restricted decision before the transport/search changes land
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

### Requirement: Source-Cited Supported-Route Enumeration with Honest Blocked Residuals

The change SHALL enumerate, as machine-readable route data with pinned-source citations, which native URL-read routes are interceptable by supported mechanisms versus the recorded bypasses, marking the `read` URL-branch routes (text, binary, secondary hops, and their materialization consumers) as completed via the trusted extension's controlled replacement of the `read` tool, and keeping every route the replacement does not cover blocked under the enforcing posture.

#### Scenario: Completed routes are exactly the replaced read URL branch
- **WHEN** the route table is read
- **THEN** `completed-by-adapter` SHALL cover only the `read` URL-branch text, binary, and secondary-hop routes and their materialization consumers
- **AND** every search-provider subrequest route SHALL carry `blocked-pending-adapter` with `userDecisionRequired`

#### Scenario: Recorded bypass is not relabeled by mocks
- **GIVEN** the pinned-source record that the primary page load and binary fetch follow redirects automatically via global fetch
- **WHEN** this change's tests pass
- **THEN** the route table SHALL still mark those native functions' direct-use routes as blocked for any caller outside the replacement
- **AND** no mock result SHALL be cited as clearing that record or proving the native binary invokes the replacement

#### Scenario: Uncovered route keeps failing closed
- **GIVEN** a URL-reading call presented through a route absent from the completed set
- **WHEN** enforcement composes the decision under the enforcing posture
- **THEN** the call SHALL be blocked with the pending-adapter reason
- **AND** no unadapted native transport SHALL be reachable through it

#### Scenario: Replacement preserves non-URL delegation
- **GIVEN** the trusted extension's controlled replacement of the `read` tool overlaying the registry for the same tool name
- **WHEN** a non-URL input is routed to the tool
- **THEN** the input SHALL be delegated to the captured native implementation
- **AND** the replacement SHALL be the supported registration mechanism completing the URL branch

#### Scenario: Partial fetch-override seam recorded as not selected
- **GIVEN** the partial native fetch-override seam with enrichment-only reach
- **WHEN** the route data is compiled
- **THEN** the seam SHALL be recorded as existing but not selected
- **AND** its enrichment-only reach SHALL be cited

### Requirement: Pending-Adapter Seam Completion Is Additive and Route-Scoped

The restricted tool-inventory seam for network parity capabilities SHALL be updated additively: the web-fetch/URL-read row gains a completing-adapter marker naming this change and its completed-route table, while the web-search row retains its separate backend-gated completion contract. The completion marker SHALL be distinguishable from a plain allow, and completing a route SHALL change no table shape, composition order, or error vocabulary owned by the enforcement wiring.

#### Scenario: Only the URL-read row completes
- **WHEN** the updated seam data is inspected
- **THEN** the URL-read row SHALL name the completing adapter and route table
- **AND** the web-search row SHALL retain its separate backend-gated completion contract
- **AND** a test SHALL assert the completing marker remains distinguishable from allow

### Requirement: Web-Search Seam Completion Is Additive, Route-Scoped, and Backend-Gated

The restricted tool-inventory seam SHALL be updated additively and backend-gated: the web-search row gains a completing-adapter marker, active exactly where a supported-tier backend exists under the supported credential set and a controlled-transport contract is satisfied, while every credential-absent or unsupported-backend state retains the distinct pending-adapter outcome; the completion marker SHALL remain distinguishable from a plain allow.

#### Scenario: Only the web-search row completes where its contract holds
- **WHEN** the updated seam data is inspected with a supported credential present
- **THEN** the web-search row SHALL name the completing adapter and the search route table
- **AND** credential-absent and unsupported-backend states SHALL still report the pending-adapter outcome
- **AND** a test SHALL assert the completing marker remains distinguishable from allow

#### Scenario: Credential-absent keeps the seam pending
- **WHEN** the same seam data is evaluated with no supported search credential
- **THEN** the web-search outcome SHALL be the pending-adapter block, not an allow

#### Scenario: Route tables agree
- **WHEN** both the search route table and the URL-fetch route registry are read
- **THEN** the URL-read completed routes SHALL be unchanged by this change
- **AND** the search-provider subrequest route SHALL never be recorded pending by one table while the other claims adapter completion for the same satisfied contract

#### Scenario: Completion never alters enforcement-owned wiring
- **WHEN** the completing-adapter seam update is applied
- **THEN** the update SHALL complete no table shape, composition order, or error vocabulary owned by the enforcement wiring
- **AND** the URL-read route set completed by the URL-fetch transport change SHALL remain byte-identical

## ADDED Requirements

### Requirement: Dedicated Public Code Search Is Outside OpenCode Parity

The integration SHALL preserve local text search, public URL reading, and general web search as the pinned OpenCode parity target. It SHALL NOT require or advertise a dedicated public-code-search adapter, credential gap, or completion slot. Unlisted dedicated search tools SHALL remain default-denied in restricted mode.

#### Scenario: Dedicated search is not an admission prerequisite
- **WHEN** restricted session capabilities are evaluated without a dedicated public-code-search adapter
- **THEN** URL read and web search SHALL be evaluated under their own retained contracts
- **AND** an unlisted dedicated search invocation SHALL be denied without executing a backend

## REMOVED Requirements

### Requirement: Public-Code-Search Surface Audit Frozen From Both Pins

**Reason**: Dedicated public code search is outside the user-approved pinned OpenCode parity target.

**Migration**: Remove the executor, route, marker, current documentation/checklist prerequisite, and obsolete tests. Retain local text search, URL read, and general web search; archived evidence remains unchanged.

### Requirement: Public-Code-Search Adapter Hops Delegate to the Controlled Transport

**Reason**: Dedicated public code search is outside the user-approved pinned OpenCode parity target.

**Migration**: Remove the executor, route, marker, current documentation/checklist prerequisite, and obsolete tests. Retain local text search, URL read, and general web search; archived evidence remains unchanged.

### Requirement: Public-Code-Search Interface Parity Contract

**Reason**: Dedicated public code search is outside the user-approved pinned OpenCode parity target.

**Migration**: Remove the executor, route, marker, current documentation/checklist prerequisite, and obsolete tests. Retain local text search, URL read, and general web search; archived evidence remains unchanged.

### Requirement: Unsupported Public-Code-Search Backend Fails Closed Without Secret Promotion

**Reason**: Dedicated public code search is outside the user-approved pinned OpenCode parity target.

**Migration**: Remove the executor, route, marker, current documentation/checklist prerequisite, and obsolete tests. Retain local text search, URL read, and general web search; archived evidence remains unchanged.

### Requirement: Public-Code-Search Seam Completion Additive and Cross-Table Consistent

**Reason**: Dedicated public code search is outside the user-approved pinned OpenCode parity target.

**Migration**: Remove the executor, route, marker, current documentation/checklist prerequisite, and obsolete tests. Retain local text search, URL read, and general web search; archived evidence remains unchanged.

### Requirement: Public-Code-Search Acceptance Is Deterministic Mock-Only

**Reason**: Dedicated public code search is outside the user-approved pinned OpenCode parity target.

**Migration**: Remove the executor, route, marker, current documentation/checklist prerequisite, and obsolete tests. Retain local text search, URL read, and general web search; archived evidence remains unchanged.
