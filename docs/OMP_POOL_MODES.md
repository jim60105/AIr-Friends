# OMP process pools by permission mode

OMP pooled sessions use separate processes for `restricted` and `native-yolo` decisions, while one global execution lease still serializes persona execution. This change establishes bot-side acquisition identity and ownership bookkeeping. Mock tests do not clear the native-runtime security gates in [OMP_COMPATIBILITY.md](OMP_COMPATIBILITY.md).

## Process identity and state

`poolEntryKey(poolKey, agentType, permissionMode)` returns the canonical `poolKey` unchanged for OpenCode. For OMP it returns `${poolKey}:${permissionMode}`. A mixed-decision channel can retain two live OMP processes, with same-mode reuse and independent idle reclaim. Reclaiming its idle restricted process does not disconnect the leased native-YOLO process.

The map-key mode segment is additive to the factory's existing mode-scoped state namespace. The factory consumes the unchanged `yolo` argument and the `omp-paths.ts` selectors described in [OMP_SPAWN.md](OMP_SPAWN.md). A pooled OMP base is `${dataRoot}/omp-pools/${poolKey}`; `PI_CODING_AGENT_DIR` is `${base}/omp-agent/${permissionMode}`, with `tmp`, `cwd`, and `xdg-data` children for `TMPDIR`, launch cwd, and `XDG_DATA_HOME`. Per-spawn OMP bases remain `${workspace}/tmp`, with the same independent `omp-agent/${permissionMode}` segment. Pool identity must never replace or remove the factory mode segment.

OpenCode retains its byte-identical pool key and directory formulas, `${dataRoot}/channel-cwd/${poolKey}`, `${dataRoot}/channel-tmp/${poolKey}`, and `${dataRoot}/opencode-data/${poolKey}`. Mixed permission decisions reuse one process with the existing per-session ACP mode switch. All pooled environments retain `SKILL_SHARED_PROCESS=1` and omit a frozen `SESSION_ID`. Because a pooled process carries no session identity in its environment, the active Skill API session id and the absolute staging directory reach the agent as literals rendered into every payload-staging prompt per acquisition — the same literal-first delivery per-spawn prompts use — never as `$SESSION_ID`/`$TMPDIR` instructions the agent would have to expand.

## Resolution before acquisition

Each entry point derives the explicit permission mode before constructing spawn configuration or requesting a pool process. The existing decision rules are unchanged.

| Entry point                  | Decision source                                                     | Acquisition route                                                                    |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Normal message               | Global flag, then account/channel YOLO policy, otherwise restricted | Inline pool runner or per-spawn                                                      |
| Channel lurk                 | Same user-context decision as message                               | Inline pool runner or per-spawn; pooled stale-trigger validation remains under lease |
| Spontaneous post             | Global flag, then target channel/bot-account policy                 | Shared helper runner or per-spawn                                                    |
| Self-research                | Global flag only                                                    | Shared helper runner or per-spawn                                                    |
| Workspace memory maintenance | Global flag only                                                    | Shared helper runner or per-spawn                                                    |
| Channel memory maintenance   | Global flag only                                                    | Existing per-spawn route, including when the deployment has a pool                   |
| Scheduled reminder           | Global flag, then resolved DM channel/account policy                | Existing per-spawn route, including when the deployment has a pool                   |

The shared helper consumes the resolved `agentType` and `permissionMode`; it never infers them from a connector. Conversation summary uses the existing ACP session and performs no additional acquisition. Pooled summary prompts remain inside the same execution lease.

## Global lease and ownership

Both modes, every channel key, and both queue lanes share the existing single `inFlight` slot. The interactive priority, starvation guard, deadline sweep, JWT/pointer lifecycle, and single release path remain in force. Two resident mode-specific processes do not authorize parallel persona execution.

At acquisition, before the first ACP session call, the registry records `permissionMode` and `processNamespace`. OMP records `restricted` or `native-yolo` and the factory-produced `PI_CODING_AGENT_DIR` (with `TMPDIR` as the namespace fallback). OpenCode pooled ownership records `yolo-switch` and its unchanged factory-produced `XDG_DATA_HOME`; per-spawn OpenCode records the resolved mode and its data-root identity. The `recordOwnership` setter preserves the original values on subsequent writes. A bounded `process_acquired` event carries the session ID, agent type, mode, namespace, and pooled flag when auditing is enabled.

Internal registry/audit identity exists even with the Skill API disabled. The pool receives that ownership identity separately from the nullable external skill identity, so disabled-API sessions issue no JWT or active pointer and per-spawn configurations expose no `SESSION_ID`. Registry activity and cleanup still apply. Row 11, `restore-mode-owned-acp-sessions`, must consume these acquisition-time fields read-only for reconnect/load verification; this change does not implement recovery verification or redefine the connector's landed configuration APIs.

No configuration field was added. `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain unchanged.

## Inherited application gates and evidence limits

P0's compatibility report has verdict **BLOCKED**. Pre-import custom-tool exclusion and canonical critical-skill ownership are incompatible; authenticated readiness and OMP restricted LSP are unresolved; authoritative approval-record reset, complete native destructive intent, OpenCode implicit LSP scoping, and complete native transport adaptation have incompatible cases. These findings halt runtime security application and remain independent of local mock verification.

Row 8's owned-settings record-reset gate remains unresolved/incompatible at the pinned runtime and cannot be cleared by separate process roots. Row 12 must provide the deployment-owned trusted extension; row 20 must provide the pinned OMP binary and packaged assets. Factory asset checks remain fail-closed. Readiness, restricted tool policy, and other downstream boundaries remain their respective owners' work.

Decision 3's application is DECIDED (2026-10-09, row 26 `isolate-omp-settings-discovery`) via settings-discovery-path control — mandatory OMP environment sanitization plus the pre-native-request source-plan preflight (`docs/OMP_SETTINGS.md` section 6) — not by clearing the merge verdict above, which stands verbatim. Restricted execution-time default-deny remains the second boundary.

The acceptance matrix uses the real factory and real pool with stub connectors, for both agent types, both deployment routes, global/channel/account/default decisions, and enabled/disabled Skill API. It checks ownership before ACP session creation, immutable provenance during prompts and summary, audit payloads, and disabled-API JWT absence. Factory-backed pool tests check same-mode reuse, disjoint namespaces, created directories, shared skill identity, and OpenCode paths. Existing pool tests cover global serialization, lanes/deadlines, and independent reclaim. Offline extension fixtures satisfy asset existence solely for mocked acquisition; they are never imported or executed by an agent. No live OMP/OpenCode agent, provider, container, sandbox, or platform delivery is part of this evidence.
