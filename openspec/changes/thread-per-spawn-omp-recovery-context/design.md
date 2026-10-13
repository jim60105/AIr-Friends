# Design

## Context

The pooled reply and pooled summary runner calls already pass a seventh helper argument containing registry-derived ownership, full per-session gate context and resolved effort. Seven per-spawn helper invocations omit it. `promptWithIdleReconnect` then selects a reconnect call without options, and `AgentConnector.reconnectAndResumeSession` verifies ownership only when ownership/gate options happen to be present.

The acquisition registry already stores immutable permissionMode/processNamespace for per-spawn as well as pooled OMP. This is a caller/connector contract correction, not new provenance storage or a new crash retry feature. `recoveryOwnershipFromRegistry` reads the record rather than deriving a fresh mode or namespace.

## Goals / Non-Goals

Pass the owning acquisition's context through every existing OMP recovery seam and reject absent/mismatched OMP provenance before teardown. Restore the same session's complete gate fields and resolved effort in canonical order.

Do not add capability probes, session/load support, retry triggers, credentials, runtime fields, new pool namespace formulas or readiness hooks. Do not change OpenCode's legacy context-free reconnect or per-spawn ordinary-crash fail-fast handling. Serialize orchestrator edits after delivered-root correction.

## Decisions

### Capture one session-owned recovery value

At each setup/acquisition path capture the ownership record read-only and reuse the same gate object/values used for initial `setSessionGateContext`. It includes exact cwd, owning shellSessionId, effective yolo permission, canWriteAgentWorkspace, configured extensions and trustedSkills root/identity. Optional values stay optional according to existing gates; do not synthesize defaults from a sibling or process-frozen client config. Carry the already-resolved reasoning effort, existing operator MCP definitions and the optional existing no-op attach hook. Do not re-resolve user mode or effort during recovery.

Use the existing helper/options type as a discriminated internal contract: OMP requires complete ownership and gate context; OpenCode retains optional trailing recovery options. Do not add a second context-builder convention. Preserve the two pooled callsites and share a minimal context constructor only if it removes repeated field construction without hiding ownership acquisition.

### Complete caller matrix

Line numbers below identify the reviewed baseline; function/session identity is authoritative after the prompt predecessor lands.

| Existing helper call | Baseline line | Required owning context |
| --- | --- | --- |
| Pooled reply | 849 | preserve existing registry/gate/effort values |
| Per-spawn message/lurk reply | 1179 | this message's shellSessionId, recorded spawn namespace, resolved effort and initial gate |
| Per-spawn spontaneous | 1789 | this spontaneous session's acquisition and own workspace |
| Per-spawn self research initial | 2250 | this research session's gate including existing shared-write permission, resolved effort |
| Per-spawn self research correction retry | 2358 | exact same research context, not a fresh inferred ownership value |
| Per-spawn user memory maintenance | 2781 | this user's maintenance id, flags and selected-agent effort |
| Per-spawn channel memory maintenance | 3149 | this channel maintenance id and scope-correct gate |
| Per-spawn scheduled reminder | 3552 | this reminder's shell identity/cwd, effective mode and effort |
| Pooled summary | 3846 | preserve existing complete summary context |

Every OMP invocation that can take the reconnect branch supplies this value. Summary's separate non-reconnecting paths are not given new retry behavior. There is no missing eighth per-spawn helper caller in the reviewed baseline.

### Agent type selects mandatory verification

At connector entry determine whether the configured deployment agent is OMP, independent of options presence. For OMP invoke recorded ownership verification as the first action, before settings/executable preflight, disconnect, respawn, load or any gate/cache mutation. Missing options, ownership, mode or namespace raises the existing bounded ownership-violation type, with zero teardown/load side effects.

Next prevalidate that the supplied full gate is the requested session's own context, bound to the recovery cwd and owning skill id. A missing or mismatched gate fails as gate-context restore failure before teardown; do not use OMP's cwd-only legacy fallback or another session's cached gate. Settings/executable preflight stays before every protected native request. Reverify ownership after respawn if the existing connector does so; recorded fields remain read-only.

OpenCode still follows its existing optional-context/fixed-mode behavior, capability-absence false return and cwd-only legacy path. No aliases or OMP legacy fallback remain in the OMP branch.

### Restore then resume

After successful same-mode load: refresh returned config-options cache, reapply prior model using the shared stable-first logic, reapply the caller-resolved reasoning effort with the existing best-effort semantics, restore the recovered id's complete gate, invoke the optional post-restore hook exactly once, then report success and permit re-prompt. A hook absence is the production no-op, not a readiness assertion. Do not swallow model catalog, gate or hook failures as effort best-effort failures.

Other cached sessions' gate contexts replay unchanged but cannot substitute for the recovered id. No cross-mode process is reused. Capability absence returns existing session-loss outcome without a prompt; ownership/gate failure propagates into existing bounded log/audit classification and ends only the affected run.

### Preserve trigger and fence behavior

Keep qualifying errors unchanged: existing connection-dead / ACP-agent-process-exited idle-liveness routes, plus the existing shared-only process-exited case. Do not turn every per-spawn process crash into reconnect. Fence raise/settle/decision and respond-gated retry ordering remain unchanged; no resume occurs after ownership/gate/session-loss failure.

## Risks / Trade-offs

Threading a freshly reconstructed value can drift from setup. Capture/reuse the initial gate/effort and prove per-session equality in mocks. Agent-type enforcement is intentional tightening for OMP without a context-free compatibility layer; OpenCode is tested separately. Full runtime reconnect and actual effort persistence remain user-owned UNVERIFIED.

## Migration Plan

Cleanly migrate the seven per-spawn callers and preserve both pooled ones. Remove optional-context branching that bypasses OMP verification, and update pooled-only comments/docs in OMP_RECOVERY, current enforcement/recovery cross-links and CHANGELOG. Budget: caller/context work 2h, connector verification/restore contract 2h, focused mocks 2h, docs 1h.

## Verification Plan

Use existing mock connector/session fixtures for both OMP modes and pooled/per-spawn acquisition. Table-drive all nine helper callers, including research initial/correction identity equality. Assert exact recorded namespace/mode, gate fields, cwd/MCP definitions and effort. Order spies require verify-before-any-side-effect and load/config/model/effort/gate/hook/success order. Cover absent/mismatched provenance, missing/inconsistent gate, empty fresh-client cache, sibling cache, unsupported load, model catalog miss, effort failure using existing best effort, rejecting hook and ordinary per-spawn crash no-retry. OpenCode absent-options behavior remains unchanged. Do not launch agents/providers or claim runtime acceptance.
