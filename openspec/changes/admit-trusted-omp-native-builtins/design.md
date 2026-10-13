# Design

## Context

Issue 1 owns ordinary builtin availability: local read, native grep/glob/find and other read-class names only if actually present in the pinned roster, bash and ordinary write/edit. `native-registration.ts` converts builtin and SDK sources to `host`, which provenance rejects before route completion. Registration also reads nonexistent `api.ctx.getAllTools`.

The user explicitly selected upstream interface investigation and, regardless of its result, accepted native read/search status and required built-in search. The latest official v18.10.3, commit `81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b`, still performs direct local IO and catches ACP read failures with disk fallback. It provides approval/activation controls, not filesystem root ACLs. This decision permits local native read/search, not a new protected-IO broker, fork, blanket host admission or unadapted remote/device routes. Deployment remains OMP18.6.1, commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`; no version bump is justified by a missing fix.

## Goals / Non-Goals

Restore authentic native capabilities and govern them through source-supported settings and route admission. State the accepted native local-IO boundary truthfully. Keep common-command, ACP write sink, destructive completeness and controlled network authorities unchanged.

Do not claim root/descriptor confinement for direct native reads, manufacture acquired session context, build a custom search broker or disable native local search. No new credentials/config/env fields, readiness, model/backend, sandbox mount or egress behavior. YOLO still registers no restricted handlers or controlled replacements; both agents/modes keep LSP disabled.

## Decisions

### Authenticate the real native source producer

Pinned [extension API types][pinned-api] expose direct `getAllTools()`. The [extension loader][pinned-loader] supplies runtime action stubs that throw until initialized, so capture the direct method and defer invocation until live calls, not factory load. Register through native `on(event, handler)` and `registerTool` without an invented ctx roster.

[Session tool registry][pinned-registry] produces builtin from its builtin membership, SDK from RPC-host membership, and extension from registered module metadata. Builtin metadata carries `<builtin:name>`, temporary scope and top-level origin. Require unique runtime-produced source metadata consistent with those fields before creating `native-builtin` provenance. SDK remains untrusted host, including same-name injected tools. Missing, inconsistent, duplicate, stale or unavailable metadata denies.

Extend the existing provenance union and observation key in place, carrying current epoch/resource generation; never convert builtin to owned extension or admit by name alone. Registry replacement must invalidate old captured origin. Owned read/web_search replacements retain their actual module origin; the following change supplies their physical evidence.

### Approved completion map

| Actual route | Completing boundary and limits |
| --- | --- |
| Native local read/grep/glob/find | Fresh authenticated origin, supported native activation/approval, then the process's ambient OS permissions. Native scans/content IO are not daemon descriptor-bound. |
| Owned read replacement, ordinary local path | After actual owned module admission, delegate unchanged via supported same-tool `ctx.invokeTool` to the captured native reader under the same accepted native-local posture. Do not require invented session-role evidence. |
| Owned skill URI | Exact separately owned instruction-root policy before original-URI delegation; module ownership does not imply skill trust. |
| Owned HTTP(S) read / web_search | Existing controlled transport or configured backend admission; native fallback stays forbidden. |
| Native bash | Existing ACP permission wrapper sends full raw command input and content, not merely its truncated title; common command policy and native permission stay active. |
| Ordinary native write/edit | Existing ACP filesystem sink only after its actual mutation route is established before dispatch; absolute native sandbox/plan exemptions, missing bridge or unrepresentable targets deny without native mutation. |
| Delete/move/multi-file mutation | Existing complete shared destructive decision, denied where pinned event/context cannot represent all intents. |

Update inventory/composition's read-class authority to an explicit `native-local-read-approval` outcome instead of claiming row-4 filesystem completion. Do not change the daemon callback authority or its protected IO implementation. All dispatched local native calls remain subject to native tool approval, resource freshness and existing process sandbox when enabled. The user accepts that an ambient-readable path outside the daemon session roots may be read; do not write an escape-rejection test that the accepted native mechanism cannot satisfy.

### Ordinary mutation requires actual sink routing

Pinned [ACP mutation bridge][pinned-mutation-bridge] rejects internal URI targets and canonical native session-sandbox targets, including absolute spellings, and can exclude the active plan artifact. It returns undefined when the client bridge or write capability is absent. Pinned [native write implementation][pinned-write] then performs direct writethrough; read/search's accepted ambient posture does not authorize that mutation.

The real trusted producer is the native ToolSession's bridge/capability, internal-router sandbox roots, plan state and resolved target, as consumed by shouldRouteWriteThroughBridge and routeWriteThroughBridge. ExtensionContext's localProtocolOptions and read-only sessionManager do not expose that complete route or an enforced no-fallback mutation dispatch. Process cwd, a matching tool name, daemon client capability advertisement or a separately guessed root does not prove the native sink will execute.

Before dispatch, require authoritative complete resolved-target and sink-required route evidence for the actual call/current resource generation. Reject missing bridge, every native sandbox/plan exemption including canonical aliases and absolute paths, uncertain tag-recovery targets, and stale/unavailable evidence. A native dispatch admitted through this evidence must preserve sink-denial propagation and cannot fall back to direct mutation if the route changes. Do not register an invented ctx getter, query ToolSession internals through casts, or implement a custom IO broker.

**Application gate:** the pinned supported extension surface cannot currently produce this evidence. Full ordinary write/edit restoration stays BLOCKED pending a user-selected supported upstream interface/version providing the trusted route and no-fallback guarantee, or a separate explicit user approval of native ambient mutation. No inspected version/interface is claimed to meet that prerequisite. Read/search remains accepted and source-supported, with no former protected-IO prerequisite. Until the mutation prerequisite is supplied, missing evidence denies; this safe denial is not advertised as completed ordinary mutation capability or as a scope reduction.

### Supported settings, not invented ACLs

Use the existing deployment-owned restricted overlay and registered-key catalog. Keep `tools.approvalMode: write`, which autoapproves read tier without human elicitation while exec retains permission. Add exact-name `tools.approval` read/grep/glob/find `allow` entries for existing native read/search; provenance still denies SDK/foreign same-name calls before native approval. Extend the internal catalog's record validation for this supported key, not public configuration. Pin `grep.enabled: true`, `glob.enabled: true`, and preserve `find.enabled: auto` so native/model-dependent find availability stays the same; never add a judge/model/backend to force it on. Pin `fetch.enabled: false` in restricted mode only as defense in depth against native URL materialization.

Pinned [tool settings][pinned-settings] register approvalMode and exact-name approval; grep/glob are booleans, find is auto/on/off and fetch is boolean. Pinned [fetch helper][pinned-fetch] checks fetch.enabled before `materializeReadUrlToFile`, including native grep URL roots. The owned URL replacement performs its own controlled transport and does not consult this native setting, so adapter URL functionality remains available. Do not treat fetch.enabled as sufficient blocking for every URI route.

No `allowedPaths`, exclusion ACL or settings claim of per-user path confinement is supported. cwd, .gitignore, hidden-file filters, candidate credentials/binary filtering and output limits are behavior controls, not a filesystem boundary. Native read-tier allow is already supported; replacement definitions already declare `approval: read`, so this change does not invent a missing approval bug.

### Screen the real multi-root native input

Read/grep/glob/find parsing supports path and root lists, selectors, collapsed URI spelling and special/internal schemes. Decode every path/root constituent using the pinned native parameter vocabulary before admitting a local route. A mixed local plus HTTP(S), SSH, internal/xd/device or alternate-execution root denies the whole call before native scanning/materialization, never just the first component. URL reads belong only to the owned read adapter; no native search URL materialization is admitted. Preserve allowed exact owned skill-URI handling separately, with unknown/unrepresentable forms fail-closed. Paths and globs are not interpreted as shell commands; do not block a valid local search merely because its text happens to contain a URI token inside a literal pattern.

Cover implicit defaults to trusted native cwd, semicolon root lists, local selectors, case-insensitive/collapsed schemes, archive/member and database/internal aliases, and alternative path fields from each actually present native tool. Preserve the existing inventory and alternate-route decision order; authentic origin cannot bypass pair screening. No broad precheck/delegate claim of filesystem containment is made.

## Versioned Investigation and Decision Evidence

| Inspected interface | Source-backed result |
| --- | --- |
| [v18.10.3 native reader][latest-read], lines 1506-1529 and 2270-2292 | ACP read failure logs fallback to disk; buffering can read native bytes before later bridge handling and directories are enumerated directly. No confined-IO fix. |
| [v18.10.3 settings documentation][latest-settings-doc] | Exact tool approval and activation are supported; path-scoped model/provider selection arrays are not filesystem ACLs. |
| [v18.10.3 registered tool settings][latest-settings] | grep/glob booleans, find enum and approval records match the relevant existing-pin controls. Credential redaction does not govern filesystem access. |
| [v18.10.3 grep documentation][latest-grep-doc] | Native Rust search, explicit paths and gitignore switches are search behavior, not root confinement. |

The approved decision is native builtin local search/read, with ambient OS access and truthful residual risk. The earlier complete-protected-IO prerequisite is not retained as an application blocker or deferred task. There is no plan to migrate to v18.10.3 solely because it was investigated.

## Risks / Trade-offs

Local native reads/search may expose other ambient-readable paths beyond daemon roots, including cross-user paths that ignores/cwd do not protect. This is explicitly accepted native status, not a fixed confinement claim. Keep write/destructive/network restrictions separate. Native extension errors can leave handlers unavailable with no authenticated readiness; preserve the approved residual risk and user-owned runtime verification. Static source/mock coverage does not prove the official binary loaded or invoked the extension.

## Migration Plan

Clean cutover all native source/provenance/route consumers and fixtures, without host compatibility aliases. Update restricted overlay/catalog plus generated manifest inputs through existing packaging workflow at future apply; pin stays18.6.1. Update OMP_ENFORCEMENT, OMP_TOOL_POLICY, OMP_SETTINGS, current compatibility decision wording and CHANGELOG to distinguish native local IO from protected ACP callback-only IO. Budget: source/roster 2h, completion/route decoding 2h, settings 1h, focused mocks 2h, docs/package-input consistency 1h.

## Verification Plan

Use factory-shaped direct-roster mocks with load-time action methods unavailable, and real pinned sourceInfo fields. Assert authentic native bash and grep/glob/available-find reach unchanged or native-local authorities; host/SDK/foreign replacements, stale metadata and alternate roots deny. Include absolute native-sandbox/plan targets and missing bridge: without authoritative mutation-route evidence, native dispatch and mutation counts must stay zero. Successful ordinary ACP write and sink-denial cases require the actual supported upstream producer supplied at the application gate; do not synthesize an unavailable ctx API or count safe denial as write capability. Capture local owned-read same-tool delegation once the module-evidence successor supplies actual owned admission. Test all root-list shapes, no native network materialization and controlled adapter URL success under fetch.enabled:false. Validate actual owned setting assets and exact-name approval records; do not invent read confinement. Preserve destructive incompleteness, YOLO no registration, OpenCode, LSP and sandbox/egress assertions. All real runtime acceptance stays UNVERIFIED.

[pinned-api]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/extensions/types.ts#L1617-L1618
[pinned-loader]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/extensions/loader.ts
[pinned-registry]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/session-tools.ts#L732-L747
[pinned-settings]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/settings.ts#L298-L348
[pinned-fetch]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/fetch.ts#L1666-L1675
[pinned-mutation-bridge]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/acp-bridge.ts
[pinned-write]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/write.ts#L920-L948
[latest-read]: https://github.com/can1357/oh-my-pi/blob/81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b/packages/coding-agent/src/tools/read.ts#L1506-L1529
[latest-settings-doc]: https://github.com/can1357/oh-my-pi/blob/81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b/docs/settings.md
[latest-settings]: https://github.com/can1357/oh-my-pi/blob/81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b/packages/coding-agent/src/tools/settings.ts
[latest-grep-doc]: https://github.com/can1357/oh-my-pi/blob/81e1d8927a3c16cfaff2e9456baa8c060e1e0e9b/docs/tools/grep.md
