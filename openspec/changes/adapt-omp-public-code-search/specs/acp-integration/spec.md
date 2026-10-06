## ADDED Requirements

### Requirement: Public-Code-Search Surface Audit Frozen From Both Pins

The change SHALL enumerate, as machine-readable route data with pinned-source citations, every public code/documentation search surface at the OpenCode packaging pin and the pinned OMP revision, tiered `supported`, `candidate-to-verify`, or `no-supported-mechanism`, and SHALL record the audit verdicts verbatim rather than assuming an equivalent backend exists. The audit SHALL record that the packaging pin's own public-code-search tool was removed upstream before that pin and that its permission rule therefore binds to no shipped tool id, that the deployment ships no code-search skill and no code-search token in either agent credential path, and that the pinned agent's only public-code-search surface is a search operation that shells out to an external CLI whose authentication store and subprocess transport are outside the controlled boundary. Keyless scraping code-search handlers that exist only as secondary handlers inside the completed URL-read route SHALL be marked `candidate-to-verify` and NOT selected as a dedicated search backend.

#### Scenario: Tiering carries citations and the removal verdict
- **WHEN** the code-search route table is read
- **THEN** each row SHALL carry its pinned-source citation and one of the three tiers
- **AND** the packaging-pin tool-removal finding SHALL be recorded as the parity baseline rather than a claimed existing capability
- **AND** the external-CLI-only native surface SHALL be recorded as no-supported-mechanism with its transport and authentication reasons named

#### Scenario: No skill or credential is invented
- **GIVEN** the deployment's shipped skills and both agent credential sets
- **WHEN** the audit data is checked against them
- **THEN** no route, fixture, or documentation page introduced by this change SHALL claim a code-search skill or code-search token that the audit cannot cite
- **AND** keyless scraping handlers SHALL remain not-selected while their existence inside the completed URL-read route is recorded as unchanged

### Requirement: Public-Code-Search Adapter Hops Delegate to the Controlled Transport

The public-code-search adapter contract SHALL route every search-endpoint request and every result-enrichment subrequest through the controlled transport decision core established for URL reads — the same single SSRF rule set, the same enforcing-posture validating-proxy routing and operator unrestricted-egress posture preservation, and the same manual per-hop redirect revalidation with the existing hop bound. The contract SHALL NOT re-implement, fork, soften, or bypass that rule set, SHALL NOT introduce a second network stack or a new posture value, SHALL NOT issue any request through an unguarded transport retry path, and SHALL treat environment proxy presence as non-enforcement exactly as the URL-read and web-search adapters do.

#### Scenario: Search endpoint decision follows the consumed egress posture
- **GIVEN** a mocked public code-search endpoint whose host resolves, via mocked DNS, to public addresses only
- **WHEN** the adapter contract plans the request under the enforcing posture and again under the operator unrestricted-egress posture
- **THEN** both decisions SHALL permit the request
- **AND** the enforcing decision SHALL name the validating-proxy route while the unrestricted decision SHALL add no new denial beyond the shared rule set

#### Scenario: Private-target search or enrichment request blocked
- **GIVEN** mocked DNS answers placing a search endpoint or an enrichment target in loopback, RFC1918, link-local, unique-local, or cloud-metadata space under the enforcing posture
- **WHEN** the adapter contract decides that hop
- **THEN** the decision SHALL be a block naming the rejected address class
- **AND** no transport request SHALL be issued for it

#### Scenario: Redirect chain revalidated hop by hop
- **GIVEN** a synthetic redirect chain from a mocked search endpoint, including one hop whose `Location` resolves into private space and one chain exceeding the hop bound
- **WHEN** the adapter contract walks the chain
- **THEN** the private-`Location` hop SHALL block at that hop and the over-bound chain SHALL block with the hop-limit reason
- **AND** every issued attempt SHALL carry a prior controlled-transport decision

### Requirement: Public-Code-Search Interface Parity Contract

The completed public-code-search route contract SHALL preserve a useful-search interface: the query parameters passed through, results carrying code or documentation excerpts with source attribution and repository/path metadata plus language information, documented result-size bounds mirroring the pinned search limits and per-item preview bounds, and a query echo. Provider authentication, rate-limit, HTTP, malformed-response, and no-results handling SHALL follow the web-search adapter's honesty rules verbatim: honest tool errors in the native failure-message shape, no fabricated results, no unguarded transport retry outside the controlled path, no silent backend switch beyond availability semantics, and an empty result distinguished from an error. Decision records and logs SHALL carry at most host, hop index, decision, and reason code.

#### Scenario: Excerpt and attribution shape pinned
- **GIVEN** a mocked code-search response containing text matches with repository and path metadata
- **WHEN** the contract renders the result
- **THEN** the output SHALL carry the per-item excerpt, source attribution, repository identity, and file path fields with the documented per-item and total size bounds applied
- **AND** the result envelope SHALL match the native-shaped result structure with a details payload

#### Scenario: Provider failures stay honest
- **GIVEN** mocked responses simulating an authentication rejection, a rate-limit rejection, and a malformed payload
- **WHEN** each is served through the contract
- **THEN** the outcome SHALL be an honest error in the native failure-message shape naming the provider
- **AND** no result content SHALL be fabricated, no unguarded retry SHALL be issued, and no backend or agent switch SHALL occur

#### Scenario: Empty result stays distinct from error
- **GIVEN** a mocked successful response containing zero matches
- **WHEN** the contract processes it
- **THEN** the outcome SHALL be an honest empty result naming the query, distinct from every error shape
- **AND** no placeholder content SHALL be produced

#### Scenario: Decision records carry no credentials or payload
- **GIVEN** a fixture whose request carries an authorization header and whose response carries code content
- **WHEN** the resulting decision records and log lines are inspected
- **THEN** neither SHALL contain the credential, header, query string, response payload, or excerpt bytes

### Requirement: Unsupported Public-Code-Search Backend Fails Closed Without Secret Promotion

When no supported public-code-search backend exists for the restricted process under the approved credential path, the route SHALL remain blocked with the pending-adapter outcome and a user-decision marker rather than inventing a mechanism, selecting a keyless scraping backend, or requiring a new credential field; the capability gap and the available user decisions SHALL be documented. The contract SHALL NOT re-point a credential whose registered purpose is unrelated to search — a deployment that configures such a credential for another subsystem SHALL still receive the blocked decision — and SHALL NOT pass any never-pass credential name into an agent subprocess as a consequence of this contract. No trusted-extension search tool SHALL be registered while no supported backend exists; the reserved completion mechanism SHALL be recorded as unconsumed.

#### Scenario: Absent supported credential yields fail-closed block
- **GIVEN** a restricted-process fixture whose credential inputs contain no supported code-search credential
- **WHEN** the public-code-search decision is consulted
- **THEN** the result SHALL be the blocked pending-adapter decision with the user-decision marker
- **AND** no mocked transport SHALL record any issued request

#### Scenario: Unrelated configured credential does not unlock the route
- **GIVEN** a fixture whose environment carries only a credential whose registered purpose is another subsystem
- **WHEN** the public-code-search decision is consulted
- **THEN** the decision SHALL remain blocked
- **AND** no route-table row or test fixture SHALL name that credential as this route's input

#### Scenario: No tool registered while unsupported
- **WHEN** the trusted-extension surface is inspected in the current state
- **THEN** no public-code-search tool SHALL be registered
- **AND** the route table SHALL record the reserved replacement mechanism as the future completion path with its observation owned by the user runtime checklist

### Requirement: Public-Code-Search Seam Completion Additive and Cross-Table Consistent

The restricted tool-inventory seam SHALL be updated additively: the public code/docs search row gains a completing-adapter marker naming this change and its route table, activated exactly where the route table's supported-backend predicate holds, and while that predicate never holds the effective outcome SHALL remain the pending-adapter decision distinguishable from a plain allow. The marker SHALL complete no table shape, composition order, or error vocabulary owned by the enforcement wiring; the URL-read and web-search route sets SHALL remain byte-identical; and the URL-fetch route registry SHALL be consumed read-only, with a test pinning that a route is never recorded pending by one table while another claims adapter completion for the same contract state.

#### Scenario: Unsupported state keeps the seam pending
- **WHEN** the updated seam data is evaluated with the current credential state
- **THEN** the public code/docs search outcome SHALL be the pending-adapter block, not an allow
- **AND** the completing-adapter marker SHALL remain distinguishable from a plain allow and inactive

#### Scenario: Predecessor route tables unchanged
- **WHEN** the code-search route table, the web-search route table, and the URL-fetch route registry are read together
- **THEN** the URL-read and web-search completed routes SHALL be byte-identical to their state before this change
- **AND** no route SHALL be pending in one table while completed in another for the same contract state

#### Scenario: Predecessor seam tests stay green
- **WHEN** the pending-versus-allow and completed-versus-pending assertions from the predecessor decisions and wiring are re-run against the updated data
- **THEN** they SHALL pass unchanged

### Requirement: Public-Code-Search Acceptance Is Deterministic Mock-Only

All public-code-search acceptance SHALL run against mocked search endpoints, mocked DNS resolution, and synthetic redirect chains with zero network contact and no live or paid search, certifying allow/deny/routing decisions under both egress postures, hop-bound and per-hop revalidation behavior, credential-presence decisions including the never-pass case, excerpt/attribution/error/empty result shapes, the fail-closed documented gap with zero issued requests, unrestricted-egress posture preservation, and the route-table and seam-data verdicts. Native-side behavior — what the compiled agent actually exposes and whether a future reserved mechanism is honored — SHALL remain on the user-owned runtime verification checklist, and no mock SHALL be presented as proof of native hook coverage or as clearing the pinned transport-bypass record.

#### Scenario: Whole suite runs without network access
- **WHEN** the public-code-search test suites execute
- **THEN** every endpoint request SHALL be served by the mocked transport and every host resolution by the mocked resolver
- **AND** no test SHALL contact an external address, require a real credential, or incur provider cost

#### Scenario: Native behavior claims stay user-owned
- **WHEN** the implementation handoff is assembled
- **THEN** the checklist SHALL carry the observation of real code-search traffic through the reserved mechanism and the confirmation that the external-CLI native surface is unreachable in restricted mode, both marked unverified until user-observed
