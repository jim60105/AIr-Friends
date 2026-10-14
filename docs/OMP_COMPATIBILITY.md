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

Each item below is a static read of the pinned source (and, where noted, the
upstream project's own documentation) — **source-observation, not runtime
evidence**. None of it was executed against the native binary, and the
deployment no longer builds compatibility contracts, validators or a ledger
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
  per-hop validation cannot be injected through the supported tool surface; the
  deployment therefore uses the native `read`/`web_search` tools rather than a
  project-owned replacement.
- **LSP**: the deployment expresses its LSP exception ONLY as the exact-name
  native tool denial `tools.approval.lsp: deny` in both mode documents. The
  pinned native LSP-disable settings keys are no longer authored, and this record
  makes no claim about implicit language-server startup either way — that
  remains upstream-owned.
- **OpenCode workspace discovery (upstream)**: upstream OpenCode DOES provide
  workspace locations for custom tools and plugins — see
  [custom tools](https://opencode.ai/docs/custom-tools/) and
  [plugins](https://opencode.ai/docs/plugins/). What this deployment lacks is a
  project-owned pre-import/executable preflight, not an upstream discovery
  capability; an earlier comparison that read "nothing project-owned scans the
  workspace" as "upstream cannot discover workspace tools/plugins" is corrected
  here.
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

## 4. Evidence levels

| Level | What it covers in this integration |
| :--- | :--- |
| **Source** | the pinned upstream tree and this deployment's authored files (sections 1–3) |
| **Mock / harness** | unit and mock-integration suites that certify this repository's client-side decisions and the delivered callback's API shape |
| **Native executable** | `tests/acp/omp-native-runtime-smoke.test.ts` (pinned `omp` 18.6.1: init/catalog/load/restore, confined mount IO, config-write observation) and `tests/integration/omp-native-runtime/native-runtime.integration.test.ts` (real native tool dispatch behind a scripted loopback model) |
| **Image** | the container build's own architecture only — user-owned and unverified |
| **Platform** | delivery to Discord/Misskey — user-owned and unverified |

Sections 1–3 above are static source observations at the pin. Native handler
enforcement for a specific mapped tool, implicit language-server startup, public
web-search backend success, proxy-mediated egress and platform delivery remain
runtime-unverified ([`USER-RUNTIME-VERIFICATION.md`](USER-RUNTIME-VERIFICATION.md)).
A local native version different from the `18.6.1` pin is a mismatch to REPORT,
never a certification.

## 5. Disposition index (37 items)

Every item of the approved 2026-10-14 parity design, with its disposition, the
current behavior and its evidence level (`Source` / `Mock` / `Native` /
`Image` / `Platform`). "Retained" means the shared mechanism intentionally
remains unchanged, covered by consumer non-regression rather than a speculative
inverse assertion; "Removed" items leave no runtime gate behind.

| # | Feature | Disposition | Current behavior / where | Evidence |
| ---: | :--- | :--- | :--- | :--- |
| 1 | Optional agent type | Retained | shared type/default/load validation unchanged (`agent.defaultAgentType`) | Source, Mock |
| 2 | Compatibility contracts/audit | Removed | governance ledger + fixed postures gone; historical evidence kept as history only | Source |
| 3 | Mode-owned settings | Simplified | one hand-authored native YAML per mode, parsed by OMP ([OMP_SETTINGS.md](OMP_SETTINGS.md)) | Native, Source |
| 4 | Settings-source isolation | Removed | no identity/preflight isolation; native config discovery owns it ([OMP_DISCOVERY.md](OMP_DISCOVERY.md)) | Source |
| 5 | Both-mode LSP disable | Simplified | exact-name native tool denial only, no startup-suppression claim ([OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md)) | Source, Native |
| 6 | Mode launch | Retained / simplified | native launch policy kept; generated/validated/path state gone ([OMP_SPAWN.md](OMP_SPAWN.md)) | Native |
| 7 | Mode process pool | Retained | mode-separated OMP pool keys + global lease kept ([OMP_POOL_MODES.md](OMP_POOL_MODES.md)) | Mock, Native |
| 8 | Pre-import guard / critical skills | Removed | no bootstrap exclusion, no critical-skill selection | Source |
| 9 | Workspace executable preflight | Removed | no scans or lifecycle wiring | Source |
| 10 | Restricted tool inventory | Simplified | minimal capability map + default deny ([OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md)) | Mock, Native |
| 11 | Runtime enforcement | Simplified | native callback for the wildcard default deny + shared ACP gate ([OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md)) | Mock, Native |
| 12 | Native extension wiring | Retained / simplified | official `on(tool_call)`, registry/evidence machinery gone | Mock, Native |
| 13 | Builtin provenance | Removed | no source tuple/admission; mapped capability policy applies | Source |
| 14 | Physical module evidence | Removed | no runtime/build anchors; ordinary install ([OMP_PACKAGING.md](OMP_PACKAGING.md)) | Source, Image |
| 15 | Destructive operations | Retained + ingress | shared decoder/all-target policy + OMP single-op ingress ([OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md)) | Mock, Native |
| 16 | Filesystem boundary | Retained | shared callbacks/no-follow/authorization, scoped to real callbacks | Mock, Native |
| 17 | Syscall confinement | Retained | shared confinement + selected native asset/data inputs | Native |
| 18 | Command path gate | Retained | common syntax/path policy unchanged | Mock |
| 19 | Skill script inventory | Retained | exact entrypoint + configured root + drift-denial contract | Mock |
| 20 | URL fetch transport | Removed | project transport/routes gone; native `read` ([OMP_NETWORK.md](OMP_NETWORK.md)) | Native |
| 21 | Web search | Removed | native `web_search`; public backend success unverified | Native, Platform |
| 22 | Network replacement admission | Removed | no completion markers or gates | Source |
| 23 | Replacement native contracts | Removed | no schema/result mirrors | Source |
| 24 | Dedicated public code search | Removed | not recreated; no native-service prohibition added | Source |
| 25 | Owned skill root declaration | Simplified | root authored in native YAML; manual deployer step ([OMP_SETTINGS.md](OMP_SETTINGS.md) §3) | Source, Native |
| 26 | Skill reads / handoff | Retained | native `skill://` read; shared script root/prompt/handoff | Mock, Native |
| 27 | Skill trust ladders | Removed | no root baseline/critical/generation/URI validation | Source |
| 28 | Single skills root | Retained | shared resolver/install/inventory/mounts + manual native declaration | Mock, Native |
| 29 | Binary version/package | Retained | pin + per-arch download checksum + version health ([OMP_PACKAGING.md](OMP_PACKAGING.md)) | Source, Image |
| 30 | Native extension bundle | Retained | single native-loadable frozen ESM; trust evidence/declarations gone | Mock, Native |
| 31 | Extension architecture | Simplified | native capability difference only | Mock, Native |
| 32 | Recovery ownership | Removed (OMP) / retained (OpenCode) | OMP option-based; OpenCode optional checks kept ([OMP_RECOVERY.md](OMP_RECOVERY.md)) | Mock |
| 33 | Dashboard agent selection | Retained | shared UI/type selection; no UI edits | Mock |
| 34 | Thought logging | Retained | common buffer/audit payload unchanged | Mock |
| 35 | ACP lifecycle testing | Retained | consumer lifecycle/OpenCode behavior kept | Mock |
| 36 | Skill handoff testing | Retained | real-component chain/session isolation + native evidence | Mock, Native |
| 37 | Current docs/decisions | Synced | this document, the sibling OMP docs, README and CHANGELOG | Source |

---

## Related Documentation

- [OMP Configuration Discovery (`docs/OMP_DISCOVERY.md`)](OMP_DISCOVERY.md)
- [OMP Network Egress (`docs/OMP_NETWORK.md`)](OMP_NETWORK.md)
- [OMP Restricted Tool Policy (`docs/OMP_TOOL_POLICY.md`)](OMP_TOOL_POLICY.md)
- [Agent Permissions Specification (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)
