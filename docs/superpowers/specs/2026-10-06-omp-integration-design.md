# Oh My Pi Integration Design

- Date: 2026-10-06
- Status: Design sections approved in brainstorming; written specification pending user review.
- AIr-Friends baseline: `0f3c4e06dd6b56056d6eeeb21c2664f4edc70452`.
- OMP production baseline: official `v18.6.1`, source commit
  `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.
- OpenCode packaging baseline: `1.18.21`; its existing minimum-version health check is a
  separate compatibility contract.
- Inputs: `tmp/WORKER_HANDOFF_OMP_AIrfriends.md` and
  `tmp/AIr-Friends_OMP_Integration_Spec_and_Implementation_Guide.md`.
- Delivery: one overarching design, implemented through dependent OpenSpec changes.
- Automated acceptance: unit tests and mock integration tests only. Real-runtime acceptance
  belongs to the user and is not a prerequisite for declaring those automated checks passed.

## 1. Goal

Add native OMP as a second officially configured ACP Agent while OpenCode remains the default.
Restricted deployments must provide equivalent allowed capabilities and authorization boundaries,
with LSP removed from both agents' restricted modes. YOLO uses each agent's native permissive mode,
without inheriting restricted tool-denial rules.

Use the official pinned OMP executable plus an explicitly loaded AIr-owned trusted extension.
Do not maintain an OMP fork, use `pi-acp`, or introduce a general MCP compatibility facade.
Keep ACP SDK `0.14.1`; upgrading the SDK is a separate change unless a concrete compatibility
blocker is established.

This specification describes required implementation behavior, not an implemented integration.
Source inspection and mock tests do not establish that the official executable enforces every
required boundary. Section 15 assigns real-runtime verification to the user explicitly.

## 2. Approved decisions and deviations from the handoffs

| Decision | Approved behavior                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1       | One overall specification; split implementation into dependent OpenSpec changes.                                                                                                              |
| D2       | Pin official OMP `v18.6.1` and per-architecture SHA-256, following OpenCode packaging. Do not track moving main or install latest implicitly.                                                 |
| D3       | Use approach B: an official OMP binary with an explicitly loaded, image-owned trusted extension. Keep ambient extension discovery disabled.                                                   |
| D4       | Preserve web fetching, web searching, and code-search capability parity. The handoff's first-release native-network disablement is superseded.                                                |
| D5       | Remove LSP from both restricted modes, including implicit language-server startup. Do not implement a replacement LSP service.                                                                |
| D6       | YOLO is native and maximally permissive. Do not add an explicit LSP denial or copy restricted tool policies into YOLO.                                                                        |
| D7       | Separate OMP restricted and YOLO processes, pools, and persistent state. The handoff's prohibition on native OMP YOLO is superseded for the isolated YOLO process only.                       |
| D8       | OpenCode retains ACP per-session mode switching; it does not need OMP's mode-split pool architecture.                                                                                         |
| D9       | Strengthen the agent-generic ACP filesystem write sink. Ordinary OMP writes must not depend on a preceding permission request.                                                                |
| D10      | Use absolute session staging paths in structured file tools, with literal skill session IDs. Preserve legacy token expansion.                                                                 |
| D11      | Translate relevant non-permission OpenCode settings, including providers, prompt override, update posture, and automatic compaction. Document native pruning differences.                     |
| D12      | Automated acceptance uses unit and mock integration tests. Do not run real agents, paid-provider workflows, platform delivery, container execution, or bwrap acceptance on the user's behalf. |

These decisions supersede conflicting instructions in the input handoffs. In particular, D6 and D7
must not be replaced with client-only emulated YOLO in a mixed-mode OMP process.

## 3. Scope and non-goals

### In scope

- Accept `opencode` and `omp` as deployment-level agent types; omitted type remains `opencode`.
- OMP factory, filtered environment, owned configuration, and scoped mutable state.
- Mode-specific OMP pooling, per-spawn operation, and existing crash recovery/session loading.
- Restricted tool-policy parity, trusted-extension enforcement, and discovery hardening.
- Restricted-only LSP removal for OpenCode and OMP.
- Stable-first model selection and advertised reasoning-value normalization.
- Independent ACP filesystem authorization, physical path containment, and trusted skill reads.
- Absolute staging instructions in normal, scheduled, maintenance, and retry prompt paths.
- Network and code-search compatibility through controlled trusted-extension adaptation.
- Client-owned MCP, critical skill-source ownership, and bounded rejection diagnostics.
- Official executable/checksum/notices packaging and warning-only runtime version health checks.
- Unit/mock integration coverage and complete documentation/configuration synchronization.

### Out of scope

- Per-route or per-session selection of a different agent type.
- ACP client terminal execution; continue advertising `terminal: false`.
- A human form-elicitation UI or additional approval interaction service.
- An OMP source fork, unpinned runtime, or general MCP tool-replacement service.
- Additional provider secrets unrelated to supported AIr configuration.
- Unrelated permission expansion, retry systems, memory redesign, or global sandbox-default changes.
- Real-runtime acceptance during assistant implementation work.

## 4. Architecture and ownership

| Component               | Responsibility and dependency                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentFactory`          | Common environment assembly, agent-specific commands, OMP mode-specific flags/configuration, and proxy/state variables. Depends on existing agent and sandbox configuration. |
| `AgentProcessPool`      | Existing channel-scoped reuse and global execution lease; adds OMP permission mode to process identity and state ownership.                                                  |
| `AgentConnector`        | ACP lifecycle, stable-first model configuration, reasoning normalization, session option caches, and same-mode recovery.                                                     |
| `ChatbotClient`         | Per-session permission authority, filesystem authorization, trusted-root reads, and rejection diagnostics.                                                                   |
| AIr-owned OMP extension | Restricted tool admission, provenance checks, alternate-entry rejection, network adaptation, and policy-readiness enforcement. No independent mutable YOLO authority.        |
| Existing Skill API      | Session authentication, payload containment, existing memory/reply operations, and platform-facing delivery.                                                                 |

Prefer focused modules for policy evaluation, path access, and extension adaptation rather than
adding unrelated responsibilities to the already-large ACP client and orchestrator.
Reuse existing command policy and SSRF/proxy utilities; do not create a second conflicting allowlist
or private-address classification convention.

The extension is deployment-owned code, not workspace-owned code. Its module and dependencies must
remain outside agent-writable paths. Only exact owned paths may be explicitly loaded. Ambient
extensions, hooks, or executable custom-tool modules cannot become trusted by occupying a workspace
or matching an allowed tool name.

## 5. Permission modes and process isolation

### Restricted

Launch native `omp acp` with `--no-extensions`, owned configuration overlays, and the exact
`--trusted-extension` module. Do not pass native YOLO/auto-approve flags or select an explicit
YOLO approval mode for this process. Pin a non-YOLO native approval mode rather than relying on an
implicit default.

The trusted extension admits the intended capability set, checks provenance at execution time,
and blocks unknown tools and alternative execution surfaces. Bash and destructive actions still
reach AIr's ACP permission policy. Ordinary writes reach the independently secure ACP write sink.
Do not require a form-elicitation interaction to execute an already authorized capability.

### Native YOLO

OpenCode continues selecting its existing `yolo` Agent via ACP mode switching. Leave that Agent's
permissive policy intact; do not add a special LSP denial.

OMP uses a distinct process launched in native YOLO, with separate owned settings. Do not load
restricted approval records or execute restricted extension tool-denial rules in this process.
Do not implement native YOLO by flipping a process-wide setting while restricted sessions exist.
`getSessionModeOverride("omp", true)` remains `null`: OMP mode is selected at spawn, not through
OpenCode's session-mode API.

Native YOLO does not imply removal of existing deployment sandbox or egress settings. ACP callbacks
still enforce their broad filesystem containment. Those callbacks do not constrain every native
YOLO execution path; documentation must state that limitation rather than promise full isolation.
Deployment-owned startup/discovery controls are distinct from restricted tool-denial policies.
If a shared bootstrap module is needed for those controls, its YOLO branch must not impose the
restricted capability set.

### Pool identity and state

For OMP, the pool identity includes agent type, the existing conversation/channel identity, and the
resolved permission mode. OpenCode retains its existing reuse behavior.

Resolve effective YOLO before pool acquisition, for every session entry point. A channel whose
participants have different account-level YOLO decisions can have two OMP processes. The existing
global execution lease still serializes persona turns; splitting pools does not enable parallel
persona execution.

- `PI_CODING_AGENT_DIR` is under the selected process's `TMPDIR/omp-agent`.
- Shared-mode temporary and state roots are distinct for restricted and YOLO pools.
- Per-spawn mode follows the same mode separation; incompatible modes must not reuse a state root.
- Process `TMPDIR`/state ownership and session payload staging are separate concepts. Preserve the
  Skill API's canonical staging location when partitioning process state; do not make payload
  containment depend on a pool-wide or mode-wide temporary root.
- Shared subprocesses keep `SKILL_SHARED_PROCESS=1` and do not freeze a process-wide `SESSION_ID`.
- Do not select a named OMP profile or inherit profile/XDG selectors that redirect scoped state.
- Gate contexts remain per ACP session, not per process.
- Session ownership records include the original process/state namespace and permission mode.
- Reclaim, restart, and `session/load` must retain and verify that namespace. Do not accept an
  opposite-mode session merely because the agent can find its ID elsewhere.

## 6. Restricted capability and authorization matrix

The baseline is the combination of `agent-config/opencode.json` and actual AIr permission checks.
An OpenCode command marked `ask` is not automatically allowed: if AIr's command gate rejects it,
OMP must reject it too. Do not widen the command list while translating configuration.

| Capability                                | Restricted behavior                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read/list/glob/grep and equivalent search | Existing session boundaries plus explicit authorized shared/read-only roots. Account for native implementations that do not automatically invoke ACP callbacks. |
| Trusted skills                            | Owned skills remain discoverable and readable; workspace content cannot shadow a critical skill.                                                                |
| Ordinary write/edit                       | Session staging/TMPDIR, or authorized shared Agent workspace with allowed extension. No arbitrary normal user-workspace mutation.                               |
| Delete/move/destructive patch             | Normalize into the common destructive-action policy; validate all targets and require per-session authorization.                                                |
| Bash                                      | Existing script/command/argument/path policy, with the native ACP permission gate active.                                                                       |
| Web fetching                              | Preserve URL-reading capability, including the URL branch of native `read`; controlled transport and per-hop validation.                                        |
| Web searching                             | Preserve live search capability through supported configured provider credentials and controlled transport.                                                     |
| Code search                               | Preserve local text search and public code/documentation search without adding LSP or arbitrary execution.                                                      |
| LSP                                       | Disabled as a tool and as implicit server startup in both restricted agents.                                                                                    |
| Eval/task/computer/browser/async/launch   | No new unrestricted native execution surface. Disable and reject OMP-only surfaces outside the approved restricted capability set.                              |
| Debug/AST mutation/configuration devices  | Do not admit a hidden mutation/debug/device route merely because `read` or `write` is allowed.                                                                  |
| Todo state                                | In-session planning state only, without opening an arbitrary filesystem mutation route.                                                                         |
| MCP                                       | Operator-controlled, ACP-client-owned capabilities; provenance remains authoritative after registration/reconnection.                                           |
| Unknown tools/internal schemes            | Default reject in restricted mode. A name match alone is insufficient authorization.                                                                            |

Audit the complete pinned tool inventory and implicit side effects, not only tools listed in the
handoff YAML. Restricted `read`/`write` must not expose execution through `xd://`, configuration,
SSH, debug, or other internal device routes. Explicitly bounded read-only skill references and
HTTP(S) reads remain usable through their approved adapters.

OpenCode restricted LSP removal must be scoped to `build`/restricted execution. Do not use a global
disable that also removes YOLO LSP. Cover implicit startup paths as well as explicit tool calls.
If the pinned configuration cannot express both requirements, report that compatibility problem
rather than silently shrinking native YOLO.

## 7. Trusted-extension and configuration boundary

### Before executable discovery

`--no-extensions` is necessary but is not a complete custom-tool/plugin exclusion boundary.
Pinned source independently discovers and imports executable custom tools before a lifecycle
allowlist can run. The integration must establish a pre-import exclusion boundary for untrusted
sources on initial session creation and recovery.

Reject session setup if the required exclusion cannot be established. A later tool-name filter,
`withHostGuard`, or a mock that merely omits discovered tools is not evidence that module top-level
code cannot execute. Cover tool factories, plugin entry points, configured module roots, symlinks,
and workspace-owned dependencies. Do not import untrusted code to inspect its metadata.

### Readiness and registry changes

Install the restricted `tool_call` enforcement handler synchronously during trusted-module loading.
Initialize each session's readiness state to false. A lifecycle-handler failure, timeout, or partial
initialization must leave restricted execution blocked. Successful `session/new` or `session/load`
alone does not establish policy readiness.

Expose a client-observable readiness result for the exact current ACP session and process
instance before allowing its first normal prompt. This is a narrow extension-control contract,
not a new human-approval UI. It must be authenticated using process/session-scoped material, must
not reuse a raw platform or Skill API server secret, and cannot be asserted by chat content.
Startup failure ends that session; never fall back to an unguarded process.

Check the live tool's origin on every restricted call. Operator MCP registration and refresh can
occur after startup and must not bypass this check. Reset readiness on recovery and verify it again;
do not reuse a prior process instance's acknowledgement.

### Authoritative settings

Use owned overlays with higher precedence than project settings and filter setting/environment
selectors that can supersede them. Inventory and constrain the security-relevant schema keys;
unknown YAML keys and invalid values that fall back to native defaults are not protection.

Clear inherited approval records before installing the owned mode's policies. An empty mapping is
insufficient because records deep-merge. The pinned settings loader treats an explicit `null` as
unset; an owned reset overlay followed by the owned mode overlay is the selected record-reset
strategy. Verify this behavior through the configuration adapter's unit/mock tests. Apply it to
both mode configurations so YOLO does not inherit restricted or project `prompt`/`deny` entries.

OMP approval lookup uses exact tool keys rather than OpenCode's wildcard default deny. Restricted
execution-time rejection supplies the missing default-deny boundary. Explicitly supported native
operations and current client-owned MCP tools must not accidentally request unsupported generic
elicitation. Keep the extra native ACP bash/destructive permission path active.

Fix critical skill selection to canonical paths in the owned skills directory. Disable or exclude
untrusted project discovery from critical-name resolution; name-only filtering is insufficient.
Do not disable skills globally.

The first OpenSpec change must establish, from pinned source, supported mechanisms for pre-import
exclusion, readiness, record reset, destructive-target normalization, and transport adaptation.
Specify and test their adapter contracts using units/mocks. If the official binary's supported
interfaces cannot implement a required mechanism, report the incompatibility for a design decision.
Do not change the production pin, patch the executable, or manufacture compatibility with mocks.
Real execution of these mechanisms remains user-owned verification.

## 8. Filesystem sinks and destructive actions

### Write policy

Apply an agent-generic policy in `ChatbotClient.writeTextFile()`:

1. Resolve the path against the requesting session's context.
2. Reject targets physically outside the session workspace and shared Agent workspace.
3. For YOLO, allow targets that pass that broad containment check.
4. For restricted execution, allow the requesting session's authorized temporary/staging root,
   not a sibling session's staging root or a process-wide state root.
5. Otherwise allow shared Agent workspace writes only with `canWriteAgentWorkspace` and an allowed
   write extension.
6. Reject all remaining ordinary user-workspace targets, even an otherwise allowed `.md` file.

Each denial records one bounded, specific rejection reason for existing retry diagnostics. Preserve
specific shared-workspace authorization/extension reasons and add a reason for an in-workspace
restricted target that is not permitted.

### Physical containment and trusted reads

Lexical `resolve()` containment is insufficient. Validate canonical roots and existing targets or
ancestors for new files. Escaping parent-directory and final-file symlinks must not redirect reads
or writes into a sibling workspace or an external file. A session or process-state root outside the
requesting session's applicable authorized roots is likewise not a valid symlink destination.
Mode-specific process/session ownership must not be confused with a promise that native YOLO cannot
modify another state file already inside its permitted user workspace.

Do not call a real-path precheck race-proof. The affected filesystem access layer must perform
no-follow/root-relative operations or reject unsafe traversal, and preserve the containment decision
through the actual operation. Represent path replacement as a failure case in unit tests. Do not
substitute optional bwrap for application-level sink authorization.

Add an explicit read-only trusted skills root to ACP reading. Keep unrelated workspace read-extension
rules unchanged; a skills-root exception does not authorize writes or arbitrary external files.
Resolve trusted skill references canonically and deny links that leave the owned root.

### Destructive operations

Native OMP delete/move titles and multi-file patches are not automatically equivalent to OpenCode
`kind: edit`. Normalize trustworthy operation data and the complete target set into the existing
common policy. Never approve an arbitrary title string as a destructive permission request.

Validate every deletion target and every move's source and destination. Reject unparseable or
incomplete target sets. Include a patch whose first destructive target is allowed and a later target
escapes the boundary. The trusted-extension path and client normalization must agree on what will
execute; an incomplete native location list cannot authorize a larger patch.

## 9. Network and search compatibility

Preserve the approved web-fetch, web-search, and code-search capabilities through trusted-extension
adaptation. Do not disable them because the original handoff did so, and do not create a general
MCP replacement service.

The adapter owns the network transport boundary. When the configured egress policy requires the
AIr validating proxy, route the relevant native URL-read/search transports through an explicitly
controlled fetch/transport implementation and that proxy. Validate redirects and scraper/provider
subrequests, not just the initial model-supplied URL. Reuse existing SSRF rules and bounded manual
redirect handling. Distinguish text and binary paths.
`HTTP_PROXY` presence alone does not establish enforcement; automatic native redirect following is
not accepted as per-hop authorization.

Keep Skill API traffic and explicitly configured provider routing distinct from arbitrary tool
fetch targets. A necessary trusted loopback call must not authorize the agent's fetch tool to query
arbitrary loopback/private services. Do not log credentials or payload content.

Follow existing `egressProxy`, `unrestrictedEgress`, and sandbox decisions, including an explicitly
selected unrestricted-egress policy. Do not introduce YOLO-only network denial rules. Document that
existing environment-based routing and native YOLO shell tools are not a general kernel-level egress
guarantee. Private-target denial fixtures use the enforcing egress configuration; they must not
redefine an operator's unrestricted policy.

Search uses supported operator-configured providers; do not require an unrelated vendor secret
merely to select OMP. Real search/model usage may incur costs. Provider errors return honest failures,
not fabricated search results, an unguarded transport retry, or a switch to a different agent.

Mock transport tests establish adapter URL/redirect/proxy behavior only. They cannot prove that the
compiled OMP tool uses that adapter; that observation belongs to the user's manual verification.

## 10. Session flow, model configuration, and recovery

For normal, spontaneous, lurk, self-research, summary, and maintenance paths:

1. Resolve agent type and effective permission mode before acquiring/spawning a process.
2. Acquire the correct process/state namespace under the existing execution lease.
3. Create the ACP session with its absolute cwd and operator MCP definitions.
4. Register the correct per-session filesystem and permission context; do not use another session's
   fallback context for an unknown session ID.
5. Establish restricted policy readiness before normal prompting.
6. Apply the model and resolved reasoning effort.
7. Render and send the prompt with the exact skill session ID and absolute staging directory.
8. Preserve existing reply/reaction/file response handling, retry diagnostics, and summary gates.

Select the model using the stable `category=model` config option when advertised. Flatten its
supported option groups, match case-insensitively, and send the canonical advertised value. An
advertised catalog that does not contain the requested model is an explicit error. Only absence of
the stable option permits the existing unstable-model fallback. Refresh options from responses and
notifications. Agent-specific provider/model IDs must match that agent's catalog; do not silently
rewrite or invent unavailable model IDs.

For reasoning, prefer the canonical exact match; map `none` to advertised `off` only if no exact
`none` exists. `default` remains a no-op. Preserve existing best-effort/non-fatal treatment of
unsupported or unavailable reasoning values.

Recovery uses the original mode, state namespace, cwd, and operator MCP definitions. Consume the
load response to restore canonical config options, then restore the requested model/reasoning
through the same stable-first logic. Restore the session gate context and verify restricted readiness
before resuming. Loading an opposite-mode session is an ownership violation, not a recovery fallback.
Failure remains isolated to the affected session.

## 11. Skills and prompt contract

Every relevant prompt, including retries and pooled sessions, supplies:

- The literal active Skill API session ID.
- The absolute session staging directory.
- Absolute structured read/write/edit paths for payload files.
- The existing payload-file shell recipe, without putting free text on the command line.

Update all skill instructions that use `$TMPDIR/$SESSION_ID` as a structured file-tool path, not only
`send-reply`. Include reply/file captions, memory content, search queries, and reminder text wherever
the existing payload-file contract applies. Keep legacy token expansion in `resolveSessionPath()`
for existing OpenCode callers.

Shared processes must not depend on a frozen subprocess `SESSION_ID`. Skills receive the active
literal `--session-id` and canonical payload path. Payload containment, JWT checks, actual reply
quotas, and missing-response retry behavior remain the existing Skill API authority.

## 12. Non-permission settings and packaging

### Configuration translation

- Keep `GEMINI_API_KEY` and `OPENROUTER_API_KEY` for the supported providers. Pinned OMP names Gemini's
  provider `google`; operator model IDs must reflect the selected agent's advertised catalog.
- Preserve OpenRouter `X-Title: AIr-Friends` and `HTTP-Referer` application identity.
- Filter platform tokens, dashboard credentials, the raw Skill API server secret, unapproved provider
  credentials, profile selectors, and security-relevant setting overrides from child environment.
- Preserve `/app/prompts/system_prompt_override.md` and existing individual prompt-file mounts.
- Disable executable self-update and unintended update behavior; version changes are deliberate.
- Keep automatic compaction enabled using the pinned native strategy. Do not assert identical native
  pruning algorithms or invent an OMP `prune` setting. Document native behavior differences.
- Keep restricted and YOLO settings separate. Shared settings contain deployment concerns, not
  restricted-only tool clamps.

Configuration changes must synchronize `config.example.yaml`, `.env.example`, and `helm/values.yaml`
whenever new configuration or environment fields are introduced. Keep agent type defaulting and
unknown-type rejection consistent across loader/env/examples.

### Official executable and notices

| Release asset             | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `omp-linux-x64`           | `c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463` |
| `omp-linux-arm64`         | `cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a` |
| `LICENSE`                 | `16c45f9d667442781f03fa198914cc39abcaa48ec5ed8f644643e554ca2fbf63` |
| `THIRD-PARTY-NOTICES.txt` | `d0c2e7c05bb4d755044b13fa560be58d01ab7c980b87892400a979397e569a8b` |

Use `OMP_VERSION=18.6.1` and architecture-specific checksum build parameters. Map `amd64` to x64 and
`arm64` to arm64. Download from the exact `v18.6.1` release, verify bytes before installation, install
`/usr/local/bin/omp` executable, and preserve notices under the image's third-party license location.
Do not introduce Bun solely for the official binary or speculative extra runtime dependencies.
Package owned settings and the exact trusted module outside agent-writable roots.

The image's intended version is exact. Runtime health checking follows OpenCode's separate pattern:
report actual version and warn on below-minimum or undetermined versions without automatic download,
upgrade, or blocking all application startup. Version/checksum updates require deliberate review.
Container execution and architecture packaging checks are user-owned manual verification.

## 13. Error handling

- Missing/invalid owned configuration or failed trusted-module initialization fails the affected
  restricted session; do not use an unguarded fallback.
- Pre-import exclusion, policy readiness, gate-context ownership, and path-containment failure deny
  the operation/session before the protected side effect.
- Record bounded authorization rejection diagnostics without exposing secrets or private content.
- Stable-model catalog mismatch fails clearly; reasoning-option incompatibility retains existing
  best-effort semantics.
- Provider, network, MCP, and platform errors preserve existing session isolation and error classes.
- A recovery cannot cross permission modes or lose its gate context to make progress.
- No additional retry, telemetry, background execution, or validation subsystem is introduced unless
  needed for one of the explicitly specified boundaries.

## 14. Automated acceptance: unit and mock integration tests only

Use actual policy/configuration/handler code under unit and mocked boundary tests. Test
consumer-visible decisions and state transitions; avoid source-text snapshots, configuration-copy
assertions, forwarding-only tests, or mocks that manufacture the missing security behavior.

| Area                | Required automated evidence                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config/factory      | Omitted type remains OpenCode; unknown type fails; OMP is accepted; restricted and YOLO launch decisions differ correctly; filtered secrets/selectors cannot override policy or state scope.                               |
| Mode/pool ownership | Same-mode reuse and different-mode separation; no frozen pooled skill ID; recovery uses original namespace; an opposite-mode stored ID is rejected by ownership logic.                                                     |
| Models/reasoning    | Stable option precedence, grouped catalog/canonical matching, absent-option fallback, no fallback after a catalog miss, cache restoration after load, `none`/`off` and default semantics.                                  |
| Write/read sinks    | Staging success, normal-workspace restricted denial, shared authorization/extension checks, YOLO broad-boundary behavior, trusted-root reads, sibling/external and symlink escape denial, path-replacement failure.        |
| Destructive actions | Safe and unsafe native-shaped operations; all move endpoints; multi-target patch rejection when a later operation escapes; incomplete data fails without a side effect.                                                    |
| Trusted module      | Pre-import guard decisions, unready/failing initialization rejection, unknown/provenance violations, alternate URI/device rejection, new/load/reset behavior, post-start registry refresh.                                 |
| Settings parity     | Hostile lower-layer grants and prompt/deny records; reset then mode overlay; security env precedence; restricted-only LSP disabled while YOLO has no added LSP/tool denials.                                               |
| Skills/MCP          | Owned critical skill selection despite name collisions; readable trusted SKILL.md; client-provided MCP ownership; no host/workspace shadowing; refreshed operator tools remain admitted without human elicitation.         |
| Network/search      | Valid requests work through the adapter; private/link-local/loopback/invalid targets fail; redirect and secondary-request validation; explicit proxy routing; no unguarded fallback; real search failures remain failures. |
| Reply flow          | Absolute staging and literal session identity reach real Skill API/handler logic with a mock platform; exactly the intended response is recorded, with no duplicate retry/fallback delivery.                               |
| Existing OpenCode   | Regression suite remains compatible except approved restricted LSP removal and common filesystem hardening.                                                                                                                |

Mock ACP subprocess/connection fixtures may exercise new/prompt/cancel/load, crashes, and registry
updates without launching a real agent. Real temporary filesystem fixtures inside unit tests may
exercise sink and symlink behavior; those are not external-agent or deployment acceptance.
DNS/fetch/proxy/provider/platform dependencies remain deterministic mocks or local test adapters,
with no external provider calls or paid credentials required.

Run the repository's applicable formatting, lint, type, unit, mock integration, and coverage checks.
The expected task set is `fmt:check`, `lint`, `check`, `test:unit`, `test:integration`, and the existing
coverage tasks, with coverage greater than 75%. Do not let those tasks silently invoke newly added
live-agent/container/bwrap acceptance. Existing compile/configuration checks remain applicable;
actual deployment smoke is excluded by the user's decision.

Do not launch `omp --version`, real ACP agents, platform delivery, container images, or bwrap as
assistant-run acceptance. Mock process responses test version-health logic; they do not verify an
installed executable or architecture build.

## 15. User-owned manual verification and evidence limits

The assistant's implementation handoff must include this checklist with actual runtime outcomes
marked unverified until the user supplies observations. A passed unit/mock suite is not proof of
these properties in the official binary.

- Verify installed `omp --version`, both architecture artifacts/checksums, packaged notices, and
  image startup without an added Bun dependency.
- Exercise the real trusted-extension load, pre-import exclusion, policy readiness, hostile custom
  tool/plugin top-level code, setting precedence, and critical skill resolution on new/load.
- Observe actual ACP filesystem delegation, transformed-write readback behavior, restricted sink
  rejection, and native destructive permission shapes.
- Observe restricted LSP removal, including implicit startup, and native YOLO without added denials.
- Exercise real ACP initialize/new/prompt/cancel/load and operator MCP without host/workspace leakage.
- Exercise both per-spawn and pooled skill delivery, with absolute payload paths and no duplicates.
- Observe real pool reuse, mode separation, crash/restart, history restoration, and cross-mode
  ownership rejection.
- Observe actual native fetch/search/code-search traffic through the configured adapter/proxy,
  including binary/text fetches, redirects, and private-target failures.
- When configured and supported, verify bwrap sibling-workspace and daemon-environment isolation.
- Confirm existing OpenCode runtime behavior after restricted LSP removal and shared sink changes.

Keep source-based claims, unit/mock evidence, and user runtime evidence separate. Do not label the
integration runtime-verified solely because the first two categories pass. If a required official
runtime mechanism cannot be implemented from supported pinned interfaces, implementation is blocked
pending an explicit user design decision; that incompatibility cannot be hidden by passing mocks.

## 16. Planned OpenSpec change boundaries and dependencies

These are design-level work packages, not OpenSpec artifacts already created. The writing-plans step
will turn them into implementation plans and appropriately sized dependent changes. Every package
retains the complete behavior assigned here; no package is a placeholder runtime implementation.

| Package                                | Scope                                                                                                                                                            | Dependencies |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| P0: pinned compatibility contracts     | Establish supported extension/discovery/readiness/transport mechanisms from pinned source; unit/mock fixtures and incompatibility reporting.                     | None         |
| P1: common filesystem policy           | Independent restricted write authorization, physical containment, trusted reads, bounded diagnostics, destructive-target policy interface.                       | P0 contracts |
| P2: ACP model compatibility            | Stable-first selection, reasoning alias, canonical caches and load-response restoration.                                                                         | P0 contracts |
| P3: agent configuration and factory    | Agent type/defaults, common env assembly, mode-specific OMP launch, credential/state filtering, owned overlays and prompt override.                              | P0 contracts |
| P4: OMP process ownership              | Resolve mode before acquisition, mode-specific pool/state roots, same-namespace recovery, all session entry points.                                              | P2, P3       |
| P5: trusted restricted enforcement     | Pre-import exclusion, readiness, live registry/provenance, authoritative records, complete destructive-action adaptation, restricted LSP removal in both agents. | P1, P3, P4   |
| P6: portable skills                    | Absolute staging variables and all skill/system/retry instructions; mocked delivery in per-spawn and pool modes.                                                 | P1, P3, P4   |
| P7: controlled network/search          | Fetch/URL-read, web search and code-search adaptation; deterministic transport/redirect/proxy tests.                                                             | P3, P5       |
| P8: official packaging                 | Fixed executable/notices/checksums and owned module/settings installation; version-health logic with mock process results.                                       | P3, P5, P7   |
| P9: final regression and documentation | Combined mocked ACP/MCP/recovery/skill tests; config/env/Helm/README/AGENTS/OpenSpec/changelog synchronization and user runtime checklist.                       | P1–P8        |

P1, P2, and P3 have independent responsibilities after P0. P5 and P7 may need further workday-sized
subdivision; their contracts and dependency ordering stay unchanged. Shared changes to the client,
factory, connector, orchestrator, and policy module require one integration owner to avoid conflicting
edits. No package may relax a security boundary to satisfy an unavailable-tool test.

## 17. References and source-inspection findings

Input handoffs remain useful historical context, but section 2 records the approved overrides.

- [AIr-Friends baseline](https://github.com/jim60105/AIr-Friends/tree/0f3c4e06dd6b56056d6eeeb21c2664f4edc70452)
- [OMP official v18.6.1 release](https://github.com/can1357/oh-my-pi/releases/tag/v18.6.1)
- [Official checksum manifest](https://github.com/can1357/oh-my-pi/releases/download/v18.6.1/SHA256SUMS.txt)
- [Pinned OMP settings](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/settings.md)
- [Pinned provider credentials](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/providers.md)
- [Native approval semantics](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/approval-mode.md)
- [ACP session factory and exact trusted-extension loading](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/main.ts)
- [SDK executable custom-tool discovery](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/sdk.ts)
- [Custom-tool import boundary](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [Plugin source discovery](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/plugins/loader.ts)
- [Extension lifecycle runner](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/extensions/runner.ts)
- [Extension API](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/extensions/types.ts)
- [Layered settings and null/reset semantics](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/config/settings.ts)
- [ACP destructive-intent generation](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/acp-permission-gate.ts)
- [ACP filesystem bridge](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/acp-bridge.ts)
- [Native LSP mutation surface](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/lsp/tool.ts)
- [Native URL-read implementation](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/fetch.ts)
- [Native binary-fetch transport](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/web/scrapers/utils.ts)

Source inspection and an independent design critique identified the custom-tool import gap,
lifecycle-readiness gap, incomplete destructive intent, native network transport limitations,
lexical filesystem containment, critical skill selection, merged approval-record behavior, and
recovery cache loss. Sections 7–10 turn those findings into explicit contracts and acceptance cases.
They do not record a successful real-runtime security verification.
