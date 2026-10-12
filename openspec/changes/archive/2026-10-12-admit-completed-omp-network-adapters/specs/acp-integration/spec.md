# Spec Delta

## MODIFIED Requirements

### Requirement: Source-Cited Supported-Route Enumeration with Honest Blocked Residuals

The change SHALL enumerate, as machine-readable route data with pinned-source citations, which native URL-read routes are interceptable by supported mechanisms versus the recorded bypasses, marking the `read` URL-branch routes (text, binary, secondary hops, and their materialization consumers) as completed via the trusted extension's controlled replacement of the `read` tool, and keeping every route the replacement does not cover blocked under the enforcing posture.

#### Scenario: Completed routes are exactly the replaced read URL branch
- **WHEN** the route table is read
- **THEN** `completed-by-adapter` SHALL cover the controlled `read` URL-branch text, binary, and secondary-hop routes and their materialization consumers, plus controlled search-provider routes exactly when their backend contract holds
- **AND** every search-provider route without a supported backend or controlled replacement SHALL carry a bounded blocked disposition

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

#### Scenario: URL completion is consumed after provenance admission
- **GIVEN** a registered owned URL-read replacement and a completed controlled route
- **WHEN** restricted enforcement evaluates that URL call
- **THEN** it SHALL name the controlled replacement as the completing boundary and permit that replacement to execute
- **AND** it SHALL NOT block solely because the inventory verdict is network-adapter-gated

#### Scenario: A completion marker cannot admit another route
- **WHEN** a call uses foreign provenance, an unregistered replacement, or an uncovered native URL route
- **THEN** the marker SHALL NOT authorize execution and no network request SHALL be dispatched


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
- **AND** the URL-read route set completed by the URL-fetch transport change SHALL retain the same authorization behavior

#### Scenario: Supported search completion reaches controlled execution
- **GIVEN** an owned registered search replacement, a supported configured backend, and a completed controlled route
- **WHEN** the native restricted callback evaluates a search call
- **THEN** it SHALL permit only the controlled replacement to complete execution
- **AND** the result SHALL preserve attribution and the current egress posture

#### Scenario: Absent backend cannot be bypassed by unrestricted egress
- **GIVEN** no supported configured search backend and explicit unrestricted egress
- **WHEN** the native restricted callback evaluates a search call
- **THEN** it SHALL return a bounded capability error with zero endpoint requests
- **AND** it SHALL NOT retry through native transport or fabricate results

#### Scenario: A private secondary hop remains rejected
- **GIVEN** enforcing egress and an admitted controlled search call
- **WHEN** a redirect or secondary request targets a prohibited private address
- **THEN** the existing transport SHALL reject that hop before dispatch
- **AND** admission SHALL NOT override per-hop authorization

