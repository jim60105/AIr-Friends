## ADDED Requirements

### Requirement: Controlled Web-Search Transport Routing Through the URL-Fetch Decision Core

The restricted OMP deployment SHALL route every adapter-served web-search provider request and every provider result-enrichment subrequest through the controlled transport decision core established for URL reads — the same single SSRF rule set, the same enforcing-posture validating-proxy routing and operator unrestricted-egress posture preservation, and the same manual per-hop redirect revalidation with the existing hop bound. The web-search adapter SHALL NOT re-implement, fork, soften, or bypass that rule set, SHALL NOT issue a provider or enrichment request through an unguarded native transport retry path, and SHALL treat environment proxy presence as non-enforcement exactly as the URL-read adapter does.

#### Scenario: Provider endpoint request follows the consumed egress posture
- **GIVEN** a mocked provider endpoint whose host resolves, via mocked DNS, to public addresses only
- **WHEN** the search adapter plans the request under the enforcing posture and again under the operator unrestricted-egress posture
- **THEN** both decisions SHALL permit the request
- **AND** the enforcing decision SHALL name the validating-proxy route while the unrestricted decision SHALL add no new denial beyond the shared rule set

#### Scenario: Private-target provider or enrichment request blocked
- **GIVEN** mocked DNS answers placing a provider endpoint or an enrichment-redirect target in loopback, RFC1918, link-local, unique-local, or cloud-metadata space under the enforcing posture
- **WHEN** the search adapter decides that hop
- **THEN** the decision SHALL be a block naming the rejected address class
- **AND** no transport request SHALL be issued for it

#### Scenario: No unguarded native retry outside the controlled path
- **GIVEN** a mocked provider response that the native transport would retry with automatic backoff
- **WHEN** the restricted adapter serves the same request
- **THEN** every issued attempt SHALL carry a prior controlled-transport decision
- **AND** the test fixture SHALL show no request issued without one

### Requirement: Web-Search Backend Tiering Restricted to the Supported Credential Set

The change SHALL enumerate, as machine-readable route data with pinned-source citations, every pinned web-search provider surface tiered `supported`, `candidate-to-verify`, or `no-supported-mechanism` relative to the agent's supported credential set (the Gemini and OpenRouter provider credentials passed by the agent-configuration change). Gemini provider-grounded search and OpenRouter web-plugin-grounded search reachable with those credentials SHALL be the only backends selected as supported. Backends requiring a credential outside the supported set SHALL be recorded `no-supported-mechanism` with a user-decision marker, and keyless scraping or arbitrary-provider engines SHALL be recorded as not selected; the adapter SHALL NOT require, recommend, or accept configuration for an unrelated vendor secret and SHALL NOT add a general search-provider configuration surface.

#### Scenario: Supported tiering is credential-set-keyed with citations
- **WHEN** the search route table is read
- **THEN** exactly the grounded backends reachable through the two supported provider credentials SHALL carry the supported tier with source citations
- **AND** every backend needing a credential outside that set SHALL carry the no-supported-mechanism tier with a user-decision marker
- **AND** keyless scraping engines SHALL be marked candidate-to-verify and not selected

#### Scenario: No unrelated secret is ever required or configured
- **GIVEN** a deployment whose only search-relevant credentials are the two supported provider keys
- **WHEN** the adapter selects a backend
- **THEN** the selection SHALL come from the supported tier only
- **AND** no test, fixture, documentation page, or configuration surface introduced by this change SHALL require a credential outside the supported set

### Requirement: Web-Search Native Interface, Citation, and Error Honesty

The completed web-search route SHALL preserve the agent's native search-tool interface: the query parameter shape unchanged, the result envelope and formatted output layout carrying result excerpts with source attribution (title, URL, snippet/cited text and citation sections) matching the native formatter's structure, and the native distinction between an empty result and an error. Provider authentication, rate-limit, HTTP, malformed-response, and no-sources failures SHALL surface as honest tool errors in the native failure-message shape; the adapter SHALL NOT fabricate search results, SHALL NOT silently switch to a different backend beyond the availability semantics of the supported tier, and SHALL NOT switch agents. Decision records and logs SHALL carry at most host, hop index, decision, and reason code — never credentials, provider request headers, URL userinfo, query strings, or payload content.

#### Scenario: Grounded success keeps native citation layout
- **GIVEN** a mocked supported-provider response containing an answer with sources and citations
- **WHEN** the adapter renders the tool result
- **THEN** the output SHALL contain the native sources and citations sections with per-item title, URL, and excerpt attribution
- **AND** the result envelope SHALL match the native `{content, details.response}` shape

#### Scenario: Provider auth and rate failures are honest tool errors
- **GIVEN** mocked provider responses simulating an authentication rejection and a rate-limit rejection
- **WHEN** each is served to the restricted adapter
- **THEN** the tool result SHALL be an error in the native provider-failure message shape naming the provider
- **AND** no result content SHALL be fabricated and no agent switch or silent different-backend fallback SHALL occur

#### Scenario: Empty result stays distinct from error
- **GIVEN** a mocked provider response with a renderable answer but zero sources and no citations
- **WHEN** the adapter processes it
- **THEN** the outcome SHALL be the honest native no-sources failure, not a fabricated success
- **AND** a separately mocked genuinely empty candidate chain SHALL produce the native no-configured-search-model-shaped message distinct from provider errors

#### Scenario: Search decision records carry no credentials
- **GIVEN** a completed-search fixture whose request headers carry a provider key and whose enrichment URL carries a query string
- **WHEN** the resulting decision records and adapter log lines are inspected
- **THEN** neither SHALL contain the credential, header, userinfo, query string, or payload bytes

### Requirement: Credential-Absent Web Search Fails Closed With a Documented Capability Gap

When neither supported backend's credential exists for the restricted process, the web-search route SHALL remain blocked with the pending-adapter outcome and a user-decision marker rather than inventing a mechanism, selecting a scraping engine, or requesting a new secret; the capability gap SHALL be documented, and the block SHALL be observable without any network request.

#### Scenario: No supported credential yields a fail-closed block
- **GIVEN** a restricted-process fixture whose credential inputs contain neither supported provider key
- **WHEN** the web-search decision is consulted
- **THEN** the result SHALL be the blocked pending-adapter decision with the user-decision marker
- **AND** no mocked transport SHALL record any issued request

### Requirement: Web-Search Seam Completion Is Additive, Route-Scoped, and Backend-Gated

The restricted tool-inventory seam SHALL be updated additively: the web-search row gains a completing-adapter marker naming this change and its search route table, active exactly where a supported-tier backend is available under the supported credential set and a controlled-transport contract is satisfied; the public-code-search row and every credential-absent or unsupported-backend state SHALL retain the distinct pending-adapter outcome. The completion marker SHALL remain distinguishable from a plain allow, SHALL complete no table shape, composition order, or error vocabulary owned by the enforcement wiring, and the URL-read route set completed by the URL-fetch transport change SHALL remain byte-identical; the search route table and the URL-fetch route registry SHALL agree that a completed search route is never simultaneously reported pending by their data.

#### Scenario: Only the web-search row completes where its contract holds
- **WHEN** the updated seam data is inspected with a supported credential present
- **THEN** the web-search row SHALL name the completing adapter and the search route table
- **AND** the public-code-search row SHALL still report the pending-adapter outcome
- **AND** a test SHALL assert the completing marker remains distinguishable from allow

#### Scenario: Credential-absent keeps the seam pending
- **WHEN** the same seam data is evaluated with no supported search credential
- **THEN** the web-search outcome SHALL be the pending-adapter block, not an allow

#### Scenario: Route tables agree
- **WHEN** both the search route table and the URL-fetch route registry are read
- **THEN** the URL-read completed routes SHALL be unchanged by this change
- **AND** the search-provider subrequest route SHALL never be recorded pending by one table while the other claims adapter completion for the same satisfied contract

### Requirement: Native YOLO Web Search Keeps Native Behavior

The web-search replacement SHALL register and apply in restricted sessions only; a native-YOLO OMP session SHALL execute the captured native `web_search` tool with no adapter clamp, no added denial, and no routing change introduced by this change, preserving the approved native-YOLO posture and the existing deployment egress configuration semantics.

#### Scenario: YOLO delegates to the captured native tool
- **GIVEN** a native-YOLO fixture invoking `web_search`
- **WHEN** the trusted-extension replacement handles the call
- **THEN** the call SHALL delegate verbatim to the captured native tool
- **AND** no restricted-mode decision SHALL appear in the delegation path

### Requirement: Web-Search Adapter Acceptance Is Deterministic Mock-Only

All web-search adapter acceptance SHALL run against mocked provider endpoints, mocked DNS resolution, and synthetic redirect/enrichment chains with zero network contact and no live or paid search, certifying backend-selection and credential-scope decisions, allow/deny/routing outcomes under both egress postures, enrichment-subrequest revalidation, error-shape honesty, interface/citation layout stability, the credential-absent fail-closed path, and the route-table and seam-data verdicts. Native-side behavior — the compiled agent actually invoking the replacement and adapter — SHALL remain on the user-owned runtime verification checklist, and no mock SHALL be presented as proof of native hook coverage or as clearing the pinned transport-bypass record.

#### Scenario: Whole suite runs without network access or paid providers
- **WHEN** the web-search adapter test suites execute
- **THEN** every provider request SHALL be served by the mocked transport and every host resolution by the mocked resolver
- **AND** no test SHALL contact an external address, require a real credential, or incur provider cost

#### Scenario: Native search-tool use stays user-owned
- **WHEN** the implementation handoff is assembled
- **THEN** the checklist SHALL carry the observation of real web-search traffic through the adapter/proxy — including enrichment redirects and private-target failures — marked unverified until user-observed
