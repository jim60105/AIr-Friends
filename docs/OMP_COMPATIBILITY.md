# OMP Upstream Compatibility

The former compatibility-contract / decision-ledger / validator apparatus was
removed by the native-runtime cutover. What remains is the pinned upstream
record and the deployment's own native posture.

## 1. Pinned upstream

| Component          | Fixed release / distribution      | Resolved revision / commit                                                                                                             |
| :----------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **Oh-My-Pi (OMP)** | `v18.6.1`                         | [`2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`](https://github.com/can1357/oh-my-pi/tree/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60)          |
| **OpenCode**       | `1.18.21` (packaging)             | tree `826d9ad46a22bef0294998e08daa3c4904fea28f` (`sst/opencode` tag `v1.18.21`)                                                        |
| **ACP SDK**        | `@agentclientprotocol/sdk@0.14.1` | npm package `@agentclientprotocol/sdk@0.14.1` (`terminal:false`)                                                                        |

## 2. Accepted upstream differences

Each item below is a static read of the pinned source — **source-observation,
not runtime evidence**. None of it was executed against the native binary, and
the deployment no longer builds compatibility contracts, validators or a ledger
around these facts.

- **No settings-merge reset barrier**: `#readConfigOverlays` folds overlays into
  one aggregated document before `#mergeOwnLayers` deep-merges it, and
  `#deepMerge` retains base-only entries. A reset overlay therefore cannot clear
  a lower layer. The deployment simply authors one hand-written mode document
  and passes it explicitly.
- **Import-before-inspection discovery**: custom-tool/plugin discovery imports
  candidate modules before inspecting their metadata, and no supported
  pre-import exclusion mechanism exists upstream.
- **No authenticated policy readiness**: there is no client-observable
  authenticated readiness handshake, and a failed or absent extension leaves the
  session running without the restricted capability set.
- **Incomplete native destructive intent**: native multi-file patch handling can
  omit later delete/move operations from the location list it authorizes.
- **Fetch/search do not accept a tool-level transport seam**: the native
  page/binary fetch paths use global fetch with `redirect: "follow"`, so
  per-hop validation cannot be injected through the supported tool surface.
- **LSP**: the native LSP-disable path suppresses startup discovery/warmup but
  does not conclusively sever a lazy cold start.
- **Skill discovery**: native collision resolution can let a workspace-adjacent
  or home-directory candidate stand in for a deployment-owned skill.

## 3. Native approval semantics

- **Restricted**: `tools.approvalMode: write` with exact-name
  `tools.approval.<name>` entries (`read`/`grep`/`glob`/`find`/`todo`/
  `web_search` allow, `lsp` deny). The pinned native schema has **no wildcard
  default-deny key**, so the restricted capability extension
  (`src/acp/omp/tool-inventory.ts`) blocks every unmapped tool name before
  dispatch with `{block: true, reason: "rejected_unknown_tool"}`; mapped names
  continue to native dispatch with no repeated native or ACP authorization.
  Membership is an own-property check, so prototype-shaped names never match.
- **Native-YOLO**: `tools.approvalMode: yolo` with the single exact-name
  `lsp: deny`.
- **Both modes deny the LSP tool** by exact-name native approval
  (`tools.approval.lsp: deny`). There is no `--no-lsp` flag and no session-mode
  override for OMP: the mode is chosen at spawn and the launched arguments are
  fixed for the process lifetime.

## 4. Evidence status

Everything above is a static source observation at the pin. Nothing in this
repository ran the native binary; native handler enforcement, LSP suppression
and traffic mediation remain runtime-unverified
([`USER-RUNTIME-VERIFICATION.md`](USER-RUNTIME-VERIFICATION.md)).

---

## Related Documentation

- [OMP Configuration Discovery (`docs/OMP_DISCOVERY.md`)](OMP_DISCOVERY.md)
- [OMP Network Egress (`docs/OMP_NETWORK.md`)](OMP_NETWORK.md)
- [OMP Restricted Tool Policy (`docs/OMP_TOOL_POLICY.md`)](OMP_TOOL_POLICY.md)
- [Agent Permissions Specification (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)
