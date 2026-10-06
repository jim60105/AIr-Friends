## ADDED Requirements

### Requirement: Controlled URL-Fetch Transport Adapter Decision Core

The restricted OMP deployment SHALL provide a URL-fetch transport adapter decision core that, for every model-supplied URL read and every scraper-derived secondary URL, decides `allow-direct`, `allow-via-proxy`, or `block` from the URL, the consumed egress posture, and an injectable DNS/transport boundary, reusing the existing SSRF rule set as the single classifier: scheme restricted to `http`/`https`, host must resolve to a public address, and loopback, private (RFC1918), link-local, unique-local, unspecified, multicast, reserved, and cloud-metadata addresses SHALL be rejected. The decision core SHALL NOT re-implement, fork, or soften that rule set, and SHALL treat `HTTP_PROXY` environment presence as non-enforcement.

#### Scenario: Public target admitted under either posture
- **GIVEN** a mocked DNS answer containing only public addresses for an `https` model-supplied URL
- **WHEN** the adapter decision core is consulted under the enforcing posture and again under the operator unrestricted-egress posture
- **THEN** both decisions SHALL permit the request
- **AND** the enforcing decision SHALL name the validating-proxy route

#### Scenario: Private and metadata targets blocked under enforcing posture
- **GIVEN** mocked DNS answers for loopback, RFC1918, link-local, unique-local, unspecified, multicast, and cloud-metadata addresses
- **WHEN** each is presented as a model-supplied URL read target under the enforcing posture
- **THEN** each decision SHALL be a block naming the rejected address class
- **AND** no transport request SHALL be issued for any of them

#### Scenario: Non-http scheme rejected at the decision
- **GIVEN** a URL read input with an internal or custom scheme (for example an internal device scheme)
- **WHEN** the adapter decision core is consulted
- **THEN** the decision SHALL be a block and the input SHALL NOT be proxied by the adapter

### Requirement: Manual Per-Hop Redirect and Secondary-URL Re-Validation

The adapter SHALL treat every redirect hop and every scraper secondary URL as a fresh decision input: redirect responses SHALL be handled manually (never by automatic native hop following), each hop target SHALL be re-validated through the same SSRF rules before the next request is issued, and the chain SHALL be bounded by the existing five-hop maximum, blocking with a distinct hop-limit reason when exceeded. A redirect or secondary URL from an initially public hop to a private, loopback, link-local, unique-local, or metadata target SHALL be blocked at that hop.

#### Scenario: Public-to-private redirect blocked at the hop
- **GIVEN** a synthetic redirect chain whose first hop is public and whose `Location` resolves, via mocked DNS, to a loopback address
- **WHEN** the adapter processes the chain
- **THEN** the request to the private hop SHALL NOT be issued
- **AND** the decision SHALL be a block naming the redirect-hop re-validation

#### Scenario: Six-hop chain blocked at the bound
- **GIVEN** a synthetic chain of six public redirect hops
- **WHEN** the adapter processes the chain
- **THEN** the decision SHALL be a block with the hop-limit reason after at most five followed hops

#### Scenario: Scraper secondary URL validated like the initial URL
- **GIVEN** a text fetch whose response advertises a secondary URL (for example a markdown or feed alternate) resolving to a private address under the enforcing posture
- **WHEN** the adapter decides the secondary request
- **THEN** the secondary request SHALL be blocked under the same rules as a model-supplied URL

### Requirement: Egress-Policy-Selected Proxy Routing with Operator Posture Preserved

When the consumed egress configuration is `egressProxy` enabled and `unrestrictedEgress` disabled, every adapter-allowed URL-read hop SHALL be routed through the running AIr validating egress proxy endpoint in addition to the adapter's own validation. When the operator has selected `unrestrictedEgress`, the adapter SHALL keep the operator's existing posture — validated model-supplied targets are fetched without a new proxy requirement, best-effort environment routing remains documented as not kernel-guaranteed, and the adapter SHALL introduce no additional denial beyond the shared SSRF rule set and no YOLO-only network denial. Configuration values SHALL be consumed unchanged.

#### Scenario: Enforcing posture selects the proxy route
- **GIVEN** the enforcing egress posture and a public validated target
- **WHEN** the adapter produces its transport plan
- **THEN** the plan SHALL route through the running validating-proxy endpoint
- **AND** the adapter SHALL still have performed its own SSRF validation for that hop

#### Scenario: Unrestricted posture adds no new denial
- **GIVEN** an operator-selected unrestricted-egress posture
- **WHEN** public targets (text or binary, within the hop bound) are fetched
- **THEN** the adapter SHALL allow them without proxy routing
- **AND** only the shared rule set (private/metadata targets, hop bound) may still block

### Requirement: Text and Binary Fetch Paths with Credential-Free Decision Records

The adapter SHALL expose distinct text and binary decision/transport paths mirroring the native URL-read shapes: a bounded text route for page and markdown bodies, and a binary route carrying content-length pre-check, streaming size cap, and content-disposition/extension hints. Adapter decision records and logs SHALL contain at most the target host, hop index, decision, and reason code; they SHALL NOT contain URL userinfo or query strings, request or response headers, credentials, or payload content.

#### Scenario: Binary route preserves native-shaped limits
- **GIVEN** a mocked binary response with a declared content length above the configured maximum
- **WHEN** the adapter's binary route processes it
- **THEN** the fetch SHALL be refused with the size-limit reason before the full body is read
- **AND** a within-limit binary SHALL return bytes plus disposition/extension hints

#### Scenario: Decision records carry no credentials or payload
- **GIVEN** any allow or deny fixture whose URL includes userinfo and a query string and whose response includes header values
- **WHEN** the resulting decision records and adapter log lines are inspected
- **THEN** neither SHALL contain the userinfo, query string, headers, credentials, or payload bytes

### Requirement: Source-Cited Supported-Route Enumeration with Honest Blocked Residuals

The change SHALL enumerate, as machine-readable route data with pinned-source citations, which native URL-read routes are interceptable by supported mechanisms versus the recorded bypasses. The URL branch of the model `read` tool (text route, binary route, and its secondary hops), including its file-materialization consumers, SHALL be marked completed by the trusted extension's controlled replacement of the `read` tool — the supported registration mechanism that overlays the registry for the same tool name while preserving delegation of non-URL inputs to the captured native implementation. The partial native fetch-override seam SHALL be recorded as existing but not selected, with its enrichment-only reach cited. Every route the replacement does not cover — including provider subrequests reached through web-search and code-search surfaces and any residual native consumer of the recorded automatic-redirect global-fetch paths — SHALL remain blocked under the enforcing posture with the existing pending-adapter decision and a `userDecisionRequired` marker; no route SHALL silently fall back to native transport for private-target risk.

#### Scenario: Completed routes are exactly the replaced read URL branch
- **WHEN** the route table is read
- **THEN** `completed-by-adapter` SHALL cover only the `read` URL-branch text, binary, and secondary-hop routes and their materialization consumers
- **AND** every search-provider or code-search subrequest route SHALL carry `blocked-pending-adapter` with `userDecisionRequired`

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

### Requirement: Pending-Adapter Seam Completion Is Additive and Route-Scoped

The restricted tool-inventory seam for network parity capabilities SHALL be updated additively: the web-fetch/URL-read row gains a completing-adapter marker naming this change and its completed-route table, while the web-search and public-code-search rows retain the distinct pending-adapter outcome. The completion marker SHALL be distinguishable from a plain allow, and completing a route SHALL change no table shape, composition order, or error vocabulary owned by the enforcement wiring.

#### Scenario: Only the URL-read row completes
- **WHEN** the updated seam data is inspected
- **THEN** the URL-read row SHALL name the completing adapter and route table
- **AND** the web-search and public-code-search rows SHALL still report the pending-adapter outcome
- **AND** a test SHALL assert the completing marker remains distinguishable from allow

### Requirement: Trusted Loopback and Provider Routing Remain Distinct from Model Fetch Targets

The adapter's target decision SHALL apply only to model-supplied or fetch-derived URLs. Trusted deployment transport facts — the Skill API loopback endpoint, operator-configured provider endpoints, and the validating-proxy endpoint itself — SHALL NOT participate in, widen, or bypass the model-target decision, and the presence of a trusted loopback call SHALL never authorize a model fetch to an arbitrary loopback or private target.

#### Scenario: Trusted loopback existence does not authorize model loopback fetch
- **GIVEN** an enforcing-posture deployment whose agent process legitimately reaches the Skill API over loopback
- **WHEN** a model-supplied URL read targets a loopback or private address
- **THEN** the adapter decision SHALL be a block
- **AND** the Skill API path SHALL remain reachable through its existing, separate transport

### Requirement: URL-Fetch Adapter Acceptance Is Deterministic Mock-Only

All adapter acceptance SHALL run against a mocked fetch transport, mocked DNS resolution, and synthetic redirect chains with zero network contact, certifying allow/deny decisions, proxy-route selection under both egress postures, per-hop re-validation, the hop bound, text/binary behavior, credential-free records, and the route-table verdicts. Native-side behavior — the compiled agent actually invoking the replacement and adapter — SHALL remain on the user-owned runtime verification checklist, and no mock SHALL be presented as proof of native hook coverage or as clearing the pinned transport-bypass record.

#### Scenario: Whole suite runs without network access
- **WHEN** the adapter test suites execute
- **THEN** every request SHALL be served by the mocked transport and every host resolution by the mocked resolver
- **AND** no test SHALL contact an external address or require a credential

#### Scenario: Native use stays user-owned
- **WHEN** the implementation handoff is assembled
- **THEN** the checklist SHALL carry the observation of real URL-read traffic through the adapter/proxy, including binary/text fetches, redirects, and private-target failures, marked unverified until user-observed
