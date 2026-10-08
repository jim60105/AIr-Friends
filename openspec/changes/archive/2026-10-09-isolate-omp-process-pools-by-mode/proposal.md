## Why

Design D7/§5 requires OMP restricted and native-YOLO traffic to live in separate processes, pools, and persistent state, but `AgentProcessPool` keys processes solely by the conversation/channel identity (`{platform}:{channelId}`, `self-research:…`, `memory-maintenance:…`) and the orchestrator resolves effective YOLO only for prompt/gate purposes. With `omp` selectable (row 7) and mode-distinct launches produced by the factory (row 9), a naive pool would either force two users with different account-level YOLO decisions in one channel onto a single process, or — worse — let an acquisition path spawn/reuse a process whose mode was never resolved for the requesting session. Row 10 makes pool/process identity mode-aware for OMP and converts "resolve the effective mode before acquisition" into a hard, per-entry-point contract (design §10 step 1).

## What Changes

- **OMP pool identity includes agent type + resolved permission mode.** `PoolRunOptions` carries the deployment agent type and the resolved effective mode; the pool composes its entry map key from the existing conversation/channel pool key plus, for `omp` only, the resolved mode. Same-mode requests for the same key reuse the live process; a different-mode request acquires/spawns a **separate** process that carries row 9's mode-scoped state namespace. A channel whose participants have different account-level YOLO decisions therefore holds two concurrent OMP processes (restricted + native-YOLO). The pool key's `reclaiming`/generation/refcount semantics apply per mode-keyed entry, so reclaim/respawn never double-opens a mode's state root.
- **Mode resolution precedes acquisition at every session entry point.** Effective YOLO (global `--yolo` flag || channel/account config via the existing `getEffectiveYolo`/`resolveYoloDecision` logic, unchanged) SHALL be resolved BEFORE `createAgentConfig`/pool acquisition at every enumerated entry point, and no acquisition path may spawn or reuse a process before that resolution: (1) normal message, (2) channel lurk (both `processMessageInternal` routes), (3) spontaneous post, (4) self-research, (5) memory maintenance (workspace-keyed), (6) channel memory maintenance, (7) scheduled reminder, (8) the shared runner `runSharedPoolSession` and the pool's own `executeInFlight`/`acquireProcess` contract (mode comes from the options, never inferred from a connector), plus (9) the per-spawn (non-pool) spawn of every one of those session types. Conversation summary runs on the already-acquired session under the same lease and SHALL NOT acquire a second process.
- **Global execution lease preserved unchanged.** Splitting pools by mode does NOT enable parallel persona execution: at most one session holds the lease across ALL entries (both modes, all keys, both lanes). This behavior is asserted by tests, not just preserved by construction.
- **OpenCode pool reuse byte-for-byte unchanged (design D8).** OpenCode pool identity excludes the mode; per-session ACP mode switching (`getSessionModeOverride("opencode", true)` → `yolo`) continues to steer OpenCode YOLO on the shared process. OpenCode's spawn environment, data roots, cwd, and map-key strings remain byte-identical to today, protected by regression tests.
- **Per-spawn (non-pool) mode follows the same distinctness.** Every per-spawn path passes the same resolved mode into `createAgentConfig`, so row 9's mode-distinct per-spawn state roots apply. Shared subprocesses keep `SKILL_SHARED_PROCESS=1` and keep NOT freezing a process-wide `SESSION_ID` — an invariant asserted here because row 16 consumes it.
- **Session-ownership bookkeeping records acquisition provenance.** On pool/per-spawn acquisition the bot's session-ownership record (registry session + audit event) records the original permission mode and the process/state namespace (the OMP mode-scoped state area / effective pool identity). This change only WRITES those durable fields; row 11 (`restore-mode-owned-acp-sessions`) verifies them on reconnect/`session/load`. The handoff interface is stated explicitly in the delta spec.
- **Explicit non-goals (owned elsewhere):** reconnect/same-mode-load verification and gate-context restoration (row 11); readiness gating before prompt (row 13); tool policy (`enforce-omp-restricted-tool-policy`, row 14); LSP disablement (row 15); skill staging prompt text and shared-process payload work (row 16); URL-fetch transport (row 17); web search (row 18); public code search (row 19); packaging (row 20); P0 compatibility-contract redefinition; row 6's `setSessionModel`/`setReasoningEffort`/config-option-cache/reconnect-config logic (consumed via existing call sites, never forked); row 9's launch-argument/state-root formulas (consumed unchanged); dashboard chat sessions (not pool acquisition; unchanged); OpenCode pool identity or directory layout changes.
- **No new `config.yaml`, `.env`, or Helm field:** the mode comes from existing global-flag/reply-policy configuration and the agent type from row 7; `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain intentionally unchanged.

## Capabilities

### New Capabilities

None. Requirements extend the existing `shared-acp-process-pool` and `acp-integration` capabilities rather than forking a parallel specification.

### Modified Capabilities

- `shared-acp-process-pool`: Pool identity for OMP includes agent type and resolved permission mode (same-mode reuse, cross-mode separation, concurrent dual-mode channel processes, per-mode reclaim); effective mode is resolved before acquisition at every session entry point and carried explicitly in acquisition options; the global execution lease continues to serialize every session across mode-split entries; OpenCode's pool identity, reuse behavior, and process environment are unchanged.
- `acp-integration`: Per-spawn (non-pool) OMP spawns receive the same resolved mode so row 9's per-spawn state distinctness holds; the shared-process marker/`SESSION_ID` non-freeze invariant is restated; session-ownership records gain the original permission mode + process/state namespace written at acquisition, forming the durable verification field that recovery consumes (verification itself is row 11).

## Impact

Eventual implementation owns: `src/core/agent-process-pool.ts` (explicit mode/agent-type fields on `PoolRunOptions`, mode-composed entry identity, per-mode directory/reclaim identity — this file is owned by this change), `src/core/session-orchestrator.ts` (mode resolution reordered before every `createAgentConfig`/acquisition at all enumerated entry points; mode threaded into pool options and per-spawn configs; ownership fields written at acquisition — shared file with rows 4/11/16, serialize), `src/skill-api/session-registry.ts` (two additive optional fields on `ActiveSession` — ownership mode + process/state namespace — written at acquisition, read by row 11), one additive `permission_mode_resolved`-style audit event per session at acquisition, and minimal touch of `src/acp/agent-connector.ts` only if the ownership record must be attached per ACP session — after row 6 lands, since row 6 owns `setSessionModel`/`setReasoningEffort`/config-option cache/reconnect config restoration and this change consumes those signatures unchanged and never forks them. `src/acp/agent-factory.ts` is consumed unchanged (row 9's `omp-paths.ts` namespace helpers supply the state-namespace value; the factory's `yolo` argument is exactly the resolved mode this change guarantees to pass). Consumer-visible tests: mode resolution strictly before acquisition at every enumerated entry point (stubbed pool/connector recording option order), same-mode reuse vs cross-mode separate spawn with mode-distinct namespaces, dual-mode channel coexistence, lease serialization across mode-split entries, OpenCode identity/environment byte-identity, per-spawn mode threading and `SKILL_SHARED_PROCESS`/no-frozen-`SESSION_ID` invariant, and ownership-record fields written at acquisition.

Application gates inherited, not removed: P0 verdicts and row 8's record-reset gate continue to gate security consumption of OMP processes; OMP spawns remain fail-closed until rows 12/20 provide the trusted module and binary. Mock tests prove pool/pool-key/orchestrator logic only — never native OMP isolation. Row 9's factory-side state-distinctness (independent of pool-key composition) is NOT weakened: the mode segment remains present in every state root even after pool keys include mode; pool-level mode identity is additive.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Predecessor consumption audit (row 6 connector signatures, row 9 `omp-paths` selectors, existing `getEffectiveYolo`), option-shape design | 0.75 |
| Pool: explicit mode/agent-type options, mode-composed entry identity, per-mode directory/reclaim identity, OpenCode key byte-identity | 1.50 |
| Orchestrator: mode-resolution-before-acquisition reordering + threading at all enumerated entry points (pool + per-spawn paths), summary no-acquire assertion | 1.75 |
| Ownership bookkeeping: registry fields + audit event written at acquisition, row-11 interface documented | 1.00 |
| Consumer-visible unit/mock tests (resolution ordering per entry point, same-mode reuse, cross-mode separation, dual-mode coexistence, lease serialization, OpenCode byte-identity, per-spawn invariants, ownership fields) | 1.75 |
| Docs (`docs/OMP_POOL_MODES.md` + changelog; config docs confirmed unchanged) | 0.50 |
| Applicable focused type/unit checks and OpenSpec verification, no live agents | 0.50 |
| Contingency for review fixes | 0.25 |
| **Total hard ceiling** | **8.00** |

Core is 7.75 hours plus 0.25 contingency. Reconnect/load verification, readiness, tool policy, LSP, staging, transport, and packaging are owned by rows 11–20 and would exceed this change if attempted.

## Batch:

depends-on: establish-omp-compatibility-contracts
depends-on: modernize-acp-session-config
depends-on: spawn-mode-scoped-omp-agents

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts (P0) | Application gate | P0's recorded verdicts gate security consumption of OMP pool isolation claims; nothing here invents a native interface or claims a P0-incompatible boundary is satisfied. Do not edit P0 artifacts. |
| modernize-acp-session-config (row 6) | Required predecessor, same-file shared (after) | Row 6 landed first and owns `setSessionModel`/`setReasoningEffort`/config-option cache/reconnect config restoration in `agent-connector.ts`. This change consumes those signatures unchanged, adds no connector config logic, and touches the connector only if ownership recording requires it. Serialize connector edits after row 6; never fork row 6's resolution helpers. |
| spawn-mode-scoped-omp-agents (row 9) | Required predecessor, contract consumer | Row 9's mode-distinct state roots (`omp-paths.ts`, mode segment independent of pool-key composition) are consumed as the state-namespace value recorded in ownership bookkeeping; its interim distinctness MUST NOT be weakened or "simplified" away by pool-key changes — pool mode identity is additive. The factory signature (`yolo` argument) is unchanged; this change guarantees the resolved mode reaches it. Serialize any factory-adjacent edits; `agent-factory.ts` itself stays untouched. |
| restore-mode-owned-acp-sessions (row 11) | Required successor, interface consumer | Row 10 WRITES the ownership fields (original permission mode + process/state namespace) at acquisition; row 11 VERIFIES them on reconnect/`session/load` and restores gate context. The delta spec names the fields and write point; row 11 must not change their meaning. Apply row 6, then this change, then row 11. |
| add-omp-agent-configuration (row 7) | Indirect (via row 9) | Agent type from row 7's predicate/default feeds the explicit pool identity field; no config change here. |
| translate-omp-owned-settings (row 8) | Indirect (via row 9) | Inherit row 8's record-reset gate status; no overlay/settings edits here. |
| gate-omp-policy-readiness (row 13) | Successor | Readiness gating before prompt is row 13's; this change neither adds nor bypasses a readiness gate. |
| enforce-omp-restricted-tool-policy (row 14) | Non-goal successor | No tool-inventory, URI/device, or MCP-admission logic here. |
| disable-restricted-agent-lsp (row 15) | Non-goal successor | No LSP handling here. |
| make-skill-staging-agent-portable (row 16) | Successor, invariant supplier | Shared subprocesses keep `SKILL_SHARED_PROCESS=1` and no frozen `SESSION_ID` — asserted here because row 16 consumes it. Canonical payload staging remains untouched (row 9 contract). |
| control-omp-url-fetch-transport / adapt-omp-web-search / adapt-omp-public-code-search (rows 17–19) | Downstream | No transport/search code; egress posture untouched. |
| package-pinned-omp-runtime (row 20) | Downstream | No packaging; OMP spawns stay fail-closed until then. |
| cover-omp-mocked-acp-lifecycle (row 21) / finish-omp-mocked-skill-handoff (row 22) | Final regression | Row 21 extends (does not duplicate) this change's mode-separation mocks with combined lifecycle coverage; row 22 must not restate config sync — zero new config/env/Helm fields here. |

- Shared-file conflict: `src/core/agent-process-pool.ts` — owned by THIS change (only row touching pool identity). `src/acp/agent-connector.ts` — shared with row 6 (apply AFTER row 6; this change consumes its connectors) and row 11 (before row 11; ownership recording write point is here). `src/core/session-orchestrator.ts` — shared with rows 4/11/16; serialize; this change's edits are confined to mode-resolution ordering/threading and ownership writes per entry point. `src/skill-api/session-registry.ts` — additive optional `ActiveSession` fields only; row 11 reads them. `CHANGELOG.md` serial as usual.
- Spec-conflict: delta requirements are uniquely named within `shared-acp-process-pool`/`acp-integration`; the MODIFIED pool-identity requirement keeps every OpenCode scenario verbatim and only adds the mode dimension for OMP. Row 11's verification and row 13's readiness requirements must reference, not modify, the acquisition-ordering and ownership-field requirements written here.

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
