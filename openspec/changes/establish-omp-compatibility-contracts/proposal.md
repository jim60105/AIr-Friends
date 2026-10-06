## Why

The approved OMP integration depends on security boundaries that are not established merely by loading a trusted extension or passing mock tests. Establish a bounded, pinned-source compatibility contract before downstream runtime changes, including an explicit stop when the official interfaces cannot implement the approved behavior.

## What Changes

- Audit only the seven prerequisite boundaries against official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode `1.18.21` for restricted-only LSP, and ACP SDK `0.14.1`: pre-import executable discovery exclusion; authenticated process/session policy readiness; authoritative approval-record reset; complete destructive targets; explicit and implicit LSP disablement; native URL-read/search transport adaptation; critical-skill canonical ownership.
- Deliver a source-evidence decision ledger, concrete AIr-owned typed contract values and pure admission/fixture validators, and deterministic consumer-visible unit/mock fixtures. These are compatibility artifacts, not production extension, settings, filesystem, or network enforcement.
- Record each mechanism as supported, incompatible, or unresolved, with exact source symbols, CLI/extension reachability, limits, and downstream owners. A passing fixture never changes an unsupported native mechanism into a supported one.
- Preserve known counterexamples, notably first-destructive-operation-only ACP locations and the collapse of a reset overlay followed by a mode record into one deep-merged overlay. Do not assert the approved reset strategy already works.
- Block downstream application when any required boundary is incompatible or unresolved; request an explicit user design decision for a genuine incompatibility. No fork, production-pin change, compatibility shim, migration, or silently reduced capability set.

## Capabilities

### New Capabilities

None. Reuse the existing ACP capability rather than create a parallel agent-security specification.

### Modified Capabilities

- `acp-integration`: Add pinned compatibility evidence, contract-completeness and mock-evidence requirements for the seven boundaries. Existing runtime requirements and supported agent types remain unchanged in this change.

## Impact

Eventual implementation owns `src/acp/omp/compatibility-contracts.ts`, `tests/acp/omp-compatibility-contracts.test.ts`, `tests/fixtures/omp-compatibility/`, `docs/OMP_COMPATIBILITY.md`, and a focused `CHANGELOG.md` entry. Production factory/client/connector, extension loading, native tools, packaging, skill payloads, pool ownership and configuration examples are not modified here. Introduce no deployment config or environment fields; `config.example.yaml`, `.env.example`, and `helm/values.yaml` therefore remain intentionally unchanged.

Source inspection already confirms partial native interfaces and concrete gaps, not end-to-end compatibility. In particular, `Settings.#readConfigOverlays` aggregates CLI overlays before applying them over lower settings, so resetting a record with `null` and then supplying a mapping does not preserve the reset barrier. Detailed evidence and remaining decisions are in `design.md`; the runtime integration is not declared supported by this proposal.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Bounded source audit of seven boundaries and CLI/new/load reachability, including negative findings | 3.00 |
| Evidence ledger and concrete typed contracts/pure validators, no runtime wiring | 1.25 |
| Consumer-visible unit/mock fixtures, including native-shaped negative counterexamples | 1.50 |
| Compatibility documentation, decision report, changelog and manual-verification limits | 0.75 |
| Applicable local type/unit/mock checks and OpenSpec verification, no live agents | 0.50 |
| Contingency for evidence clarification or blocking review fixes | 1.00 |
| **Total hard ceiling** | **8.00** |

The deliverable is a complete compatibility decision, not seven security implementations. Limit audit depth to the named entry points and their directly relevant call chains. If no supported mechanism is established within the audit bound, publish `unresolved` with the exact evidence still missing and block consumption; if source disproves a mechanism, publish `incompatible`. Completing the bounded decision ledger with a blocker is a valid P0 outcome, not permission to start downstream implementation. Any further audit or alternative architecture exceeding this bound requires a separately approved split before expanding work.

## Batch:

depends-on: none

- Row 1 / P0; no predecessor changes. Proposal generation may continue, but dependency completion is not equivalent to a compatibility pass.
- Direct consumers from the batch: `canonicalize-acp-filesystem-roots`, `secure-acp-filesystem-access`, `modernize-acp-session-config`, `add-omp-agent-configuration`, `translate-omp-owned-settings`, `spawn-mode-scoped-omp-agents`, `guard-omp-executable-discovery`, `control-omp-url-fetch-transport`, `adapt-omp-web-search`, and `adapt-omp-public-code-search`. Transitive security, pool, LSP, packaging and mock-lifecycle slices inherit the application block.
- Code-conflict: Later consumers import the contract module but must not redefine its fields or certify unresolved mechanisms. `translate-omp-owned-settings` owns actual overlays; `normalize-acp-destructive-targets` owns production normalization; `gate-omp-policy-readiness` owns production handshake; discovery, restricted-tool, LSP and network slices own their runtime mechanisms.
- Shared-file conflict: `CHANGELOG.md` requires serial integration. P0 does not edit `src/acp/client.ts`, `src/acp/agent-factory.ts`, `src/acp/agent-connector.ts`, `agent-config/opencode.json`, or approved integration design.
- Spec-conflict: Adds uniquely named compatibility requirements to `acp-integration`, which downstream slices also change. Preserve these requirements and apply runtime deltas serially; no requirement replacement is authorized by P0.
