## ADDED Requirements

### Requirement: Public-Code-Search Surface Audit Frozen From Both Pins

The change SHALL enumerate every public code/documentation search surface at the OpenCode packaging pin and the pinned OMP revision as machine-readable route data with pinned-source citations, tiered `supported`, `candidate-to-verify`, or `no-supported-mechanism`, and SHALL record audit verdicts verbatim rather than assuming an equivalent backend exists.

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

#### Scenario: Audit records no skill or token shipped
- **GIVEN** the deployment's shipped skills and both agent credential paths
- **WHEN** the code-search audit data is inspected
- **THEN** the audit SHALL record that no code-search skill and no code-search token exist in either agent credential path

#### Scenario: Removed tool's permission binds to no shipped tool id
- **WHEN** the packaging pin's tool-removal finding is recorded
- **THEN** the audit SHALL record that the tool was removed upstream before that pin and that its permission rule binds to no shipped tool id

#### Scenario: Keyless handlers tiered but never selected
- **GIVEN** keyless scraping code-search handlers present only as secondary handlers inside the completed URL-read route
- **WHEN** the tiering data is read
- **THEN** they SHALL be marked `candidate-to-verify`
- **AND** none SHALL be selected as a dedicated search backend

### Requirement: Public-Code-Search Adapter Hops Delegate to the Controlled Transport

The public-code-search adapter contract SHALL route every search-endpoint request and every result-enrichment subrequest through the controlled transport decision core established for URL reads, reusing the same SSRF rule set, egress-posture handling, and manual per-hop redirect revalidation without re-implementing, forking, softening, or bypassing it.

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

#### Scenario: No second stack, posture value, or unguarded retry
- **WHEN** the contract issues search and enrichment hops under the shared rule set
- **THEN** no request SHALL traverse a second network stack, rely on a new posture value, or pass through an unguarded transport retry path

#### Scenario: Environment proxy presence is non-enforcement
- **GIVEN** an environment proxy configured for the process
- **WHEN** the adapter contract plans search and enrichment hops
- **THEN** the proxy's presence SHALL be treated as non-enforcement exactly as the URL-read and web-search adapters treat it

### Requirement: Public-Code-Search Interface Parity Contract

The completed public-code-search route contract SHALL preserve a useful-search interface: query parameters passed through, results carrying code or documentation excerpts with source attribution, repository/path metadata, and language information, a query echo, and documented result-size bounds mirroring the pinned search limits and per-item preview bounds.

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

#### Scenario: Decision records bounded to routing fields
- **WHEN** any decision record or log line is written for a public-code-search hop
- **THEN** it SHALL carry at most the host, hop index, decision, and reason code

#### Scenario: HTTP errors stay within the honesty rules
- **GIVEN** a mocked HTTP error response from the search provider
- **WHEN** the contract serves it
- **THEN** the outcome SHALL be an honest tool error in the native failure-message shape naming the provider
- **AND** no fabricated result, unguarded transport retry outside the controlled path, or silent backend switch beyond availability semantics SHALL occur

### Requirement: Unsupported Public-Code-Search Backend Fails Closed Without Secret Promotion

When no supported public-code-search backend exists for the restricted process under the approved credential path, the route SHALL remain blocked with the pending-adapter outcome and a user-decision marker, SHALL NOT invent a mechanism, select a keyless scraping backend, require a new credential field, or pass a never-pass credential name into an agent subprocess, and the reserved completion mechanism SHALL be recorded as unconsumed.

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

#### Scenario: Capability gap and user decisions documented
- **WHEN** the blocked public-code-search outcome is presented
- **THEN** the capability gap and the available user decisions SHALL be documented

### Requirement: Public-Code-Search Seam Completion Additive and Cross-Table Consistent

The restricted tool-inventory seam SHALL be updated additively: the public code/docs search row gains a completing-adapter marker naming this change and its route table, activated exactly where the route table's supported-backend predicate holds, and while that predicate never holds the effective outcome SHALL remain the pending-adapter decision distinguishable from a plain allow.

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
- **THEN** they SHALL pass unchanged for every outcome they pin (row kinds, pending-versus-allow decisions, and the 14b completed-versus-pending block); the two predecessor assertions that freeze the code-search row's PRE-marker bytes are superseded for that one row by this change's additive marker — recorded with the marker's own gate-off pin — exactly as the web-search row's supersession was, and every other row's byte-identity assertion SHALL keep passing verbatim

#### Scenario: Marker leaves enforcement wiring untouched
- **WHEN** the updated seam and the enforcement wiring are compared
- **THEN** the marker SHALL complete no table shape, composition order, or error vocabulary owned by the enforcement wiring

#### Scenario: Registry consumed read-only with conflict pinned
- **GIVEN** the URL-fetch route registry as the shared route source
- **WHEN** the code-search seam update is applied to the tables
- **THEN** the URL-fetch route registry SHALL be consumed read-only
- **AND** a test SHALL pin that no route is recorded pending by one table while another claims adapter completion for the same contract state

### Requirement: Public-Code-Search Acceptance Is Deterministic Mock-Only

All public-code-search acceptance SHALL run against mocked search endpoints, mocked DNS resolution, and synthetic redirect chains with zero network contact and no live or paid search, certifying the allow/deny/routing decisions, revalidation behavior, credential-presence decisions, result and error shapes, fail-closed gap, and route-table verdicts.

#### Scenario: Whole suite runs without network access
- **WHEN** the public-code-search test suites execute
- **THEN** every endpoint request SHALL be served by the mocked transport and every host resolution by the mocked resolver
- **AND** no test SHALL contact an external address, require a real credential, or incur provider cost

#### Scenario: Native behavior claims stay user-owned
- **WHEN** the implementation handoff is assembled
- **THEN** the checklist SHALL carry the observation of real code-search traffic through the reserved mechanism and the confirmation that the external-CLI native surface is unreachable in restricted mode, both marked unverified until user-observed

#### Scenario: Mocks certify the full decision matrix
- **WHEN** the mocked public-code-search acceptance executes
- **THEN** the assertions SHALL certify allow/deny/routing decisions under both egress postures, hop-bound and per-hop revalidation behavior, credential-presence decisions including the never-pass case, excerpt/attribution/error/empty result shapes, the fail-closed documented gap with zero issued requests, unrestricted-egress posture preservation, and the route-table and seam-data verdicts

#### Scenario: Mocks never prove native behavior
- **WHEN** the mock-only results are reported
- **THEN** no mock SHALL be presented as proof of native hook coverage or as clearing the pinned transport-bypass record
