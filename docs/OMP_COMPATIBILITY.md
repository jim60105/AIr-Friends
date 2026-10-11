# OMP Integration Compatibility Report & Decision Ledger

Date: 2026-10-08\
OpenSpec Change: `establish-omp-compatibility-contracts` (P0)\
Primary Branch: `master`\
Primary HEAD at Start: `0970462ab3f38dd68a3829afb76b51096cb51a56`\
Predecessor Changes: None (Change 1 of 24 in approved batch)

---

## 1. Executive Summary & Application Gate Verdict

**Compatibility Assessment Verdict:** **`BLOCKED` (Downstream Application Halted)**

The official OMP runtime (`v18.6.1` / commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`), OpenCode `1.18.21` (resolved tree `826d9ad46a22bef0294998e08daa3c4904fea28f`), and ACP SDK `0.14.1` (`terminal:false`) were audited strictly across the seven prerequisite security boundaries.

**Downstream Gate Invariant:**
All downstream implementation changes (`canonicalize-acp-filesystem-roots`, `secure-acp-filesystem-access`, `enforce-acp-filesystem-authorization`, `normalize-acp-destructive-targets`, `translate-omp-owned-settings`, `spawn-mode-scoped-omp-agents`, `gate-omp-policy-readiness`, `guard-omp-executable-discovery`, `control-omp-url-fetch-transport`, etc.) **MUST REMAIN BLOCKED** from applying to runtime production while any required boundary or subcase is classified as `incompatible` or `unresolved`. Proposal generation may proceed, but no runtime security boundary is cleared by mock tests or partial hooks. Resolving genuine incompatibilities requires an explicit user design decision.

---

## 1a. User Decision Register (2026-10-09)

The application-gate verdict and its "MUST REMAIN BLOCKED" invariant in section 1 are superseded
by the explicit user decisions recorded below. No downstream change is held back by that verdict
any longer, and the remaining batch changes implement the single posture recorded here.

The section 3 ledger is unchanged and remains the authoritative record of what the pinned OMP
`v18.6.1` does and does not support. The pinned binary still provides none of the mechanisms the
user's DECIDED dispositions work around; no ledger row, status, citation, or evidence limit is relabeled or
relaxed. Each decision below is the user's chosen disposition of a recorded gap, taken under
deployment ownership rather than as a claim of native support. All seven dispositions are
**DECIDED (2026-10-09)**; native support verdicts remain unchanged.

1. **Pre-import executable discovery exclusion** — disposition of section 3 boundary 1 (recorded
   `incompatible`). The boundary is carried by deployment control: the image and deployment keep
   executable custom tools and plugin entry points out of the workspace, the owned extension is
   loaded only from the image path with `--no-extensions` keeping ambient discovery off, and a
   startup check rejects the session when it finds an executable module in the workspace. The
   fail-closed session rejection the guard already ships remains the fallback. Carried by
   `guard-omp-executable-discovery`.
2. **Authenticated policy readiness** — disposition of section 3 boundary 2 (recorded
   `unresolved`). The requirement for a client-observable, authenticated readiness handshake is
   cancelled. The installed synchronous `tool_call` enforcement handler supplies the restricted
   execution-time decisions. If the handler is not installed, the pinned non-YOLO native approval
   mode plus the client ACP policy remain the boundary for ACP-mediated operations, with client
   denials fail-closed. The residual risk is recorded and accepted: `runner.emit` only logs
   lifecycle-hook errors and does not fail session startup, so an extension that fails to load
   leaves the session without the restricted capability set and no client-observable signal exists.
   This fallback does not establish equivalent native default-deny or complete ACP callback
   coverage. No readiness claim is made. `gate-omp-policy-readiness` is removed from the batch by
   user decision; the client-observable readiness requirement is cancelled, with handler wiring
   carried by `wire-omp-restricted-tool-enforcement` and fallback posture consumed by the remaining
   lifecycle and recovery changes.
3. **Authoritative approval-record reset** — disposition of section 3 boundary 3 (recorded
   `incompatible`). Settings discovery paths are controlled instead of the reset overlay: only the
   owned `--config` overlays are visible, with HOME, XDG and project settings sources filtered out,
   so no hostile lower layer exists to inherit from. The restricted runtime default-deny stays as
   the second boundary. Carried by `translate-omp-owned-settings`.
4. **Complete destructive intent** — disposition of section 3 boundary 4 (recorded `incompatible`).
   The ACP-mediated destructive path is kept with complete location lists, and native shapes
   (multi-file patches and first-operation-only lists) are denied fail-closed. Carried by
   `normalize-acp-destructive-targets`.
5. **LSP disabled for both agents in both modes** — disposition of section 3 boundaries 5a and 5b (recorded `unresolved`
   and `incompatible`). LSP is disabled for OMP restricted+YOLO and OpenCode build+yolo. OMP
   native-YOLO receives the disable in its mode overlay and/or `--no-lsp` launch argument.
   `agent-config/opencode.json` explicitly denies the `lsp` tool per agent for BOTH `build` and
   `yolo`, without a top-level global clamp. This supersedes design decision D6's LSP exemption;
   YOLO otherwise retains native approval posture and receives no restricted tool policy.
   Per-agent tool denial does not clear the pinned implicit-startup incompatibility or establish
   native server suppression; runtime observations remain user-owned and unverified.
   Carried by `disable-restricted-agent-lsp`.
6. **Native transport adaptation** — disposition of section 3 boundary 6 (recorded `incompatible`).
   The trusted-extension replacement tool covers the approved routes (URL read, web search, public
   code search) through the controlled transport, while the bypass routes (`fetchBinary` and
   scraper redirects that follow redirects automatically on global fetch) stay blocked. `HTTP_PROXY`
   alone does not establish enforcement. Carried by `control-omp-url-fetch-transport`.
7. **Critical skill canonical ownership** — disposition of section 3 boundary 7 (recorded
   `incompatible`). Skill roots come from deployment-owned settings: only owned paths are declared,
   workspace skill discovery is excluded, and name-only critical-skill resolution is denied. Carried
   by `guard-omp-executable-discovery` and `make-skill-staging-agent-portable`.

The evidence claim is unchanged: unit and mock tests certify this repository's decisions only, and
the design section 15 runtime checklist remains user-owned and unverified.

---

## 2. Fixed Upstream Pins and Reference Authority

| Component          | Fixed Release / Distribution      | Resolved Source Revision / Commit / Tree                                                                                               | Specification / Architecture Scope     |
| :----------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------- |
| **Oh-My-Pi (OMP)** | `v18.6.1`                         | Commit [`2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`](https://github.com/can1357/oh-my-pi/tree/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60) | Official CLI and coding-agent core     |
| **OpenCode**       | `1.18.21` (packaging)             | Tree `826d9ad46a22bef0294998e08daa3c4904fea28f` (`sst/opencode` tag `v1.18.21`)                                                        | Restricted vs YOLO baseline comparison |
| **ACP SDK**        | `@agentclientprotocol/sdk@0.14.1` | npm package `@agentclientprotocol/sdk@0.14.1`                                                                                          | Client capability `terminal:false`     |

---

## 3. Seven-Boundary Compatibility Decision Ledger

The ledger below records exact findings across the seven prerequisite boundaries and their distinct subcases.

Three separate evidence classes are maintained:

1. **Static Source Evidence**: Inspection of upstream source code, symbols, call graphs, and configuration merge logic.
2. **Deterministic Mock/Unit Evidence**: Pure contract validators and native-shaped offline fixtures in AIr repository tests.
3. **User-Owned Runtime Verification**: Live binary execution, process-level behavior, and container/sandbox checks. **Marked UNVERIFIED until exercised by the operator.**

| Boundary / Subcase | Pinned Source Citation & Symbols | Public Reachability (CLI / Settings / Extension) | New / Load / Refresh Scope | Downstream Owner | Selected Mechanism | Status | Deterministic Fixture Outcomes | Evidence Limits & Unresolved Gaps | User Runtime Checklist Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Pre-Import Executable Discovery Exclusion** | [`packages/coding-agent/src/sdk.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/sdk.ts) (`discoverCustomToolPaths`, `loadCustomTools`); [`loader.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/custom-tools/loader.ts) (`loadTool` invokes dynamic `import(url)`) | `--no-extensions` disables extension discovery in `main.ts`, but custom tools are discovered and imported independently via SDK session setup. | Executed during `createAcpSessionFactory` on every new session initialization. | `guard-omp-executable-discovery` (P5a) | Pre-import exclusion before unowned code execution. | **`incompatible`** | Pure validator blocks unowned tools, plugins, configured roots, and symlinks before importer/factory spies run. | OMP custom tool loader dynamically imports modules before inspecting metadata or applying factory filters. No pre-import exclusion mechanism exists in official OMP. | **UNVERIFIED** (Requires observing real process import behavior). |
| **2. Authenticated Policy Readiness** | [`packages/coding-agent/src/extensibility/extensions/types.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/extensions/types.ts); [`runner.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/extensions/runner.ts) (`emit`, `emitToolCall`) | Extension runner exposes synchronous handler registration, but no dedicated authenticated control channel exists for client-side readiness handshake. | Synchronous during module load; `runner.emit` logs errors on lifecycle hooks without failing session startup. | `gate-omp-policy-readiness` (P5b) | Authenticated control channel bound to current process, ACP session ID, challenge, and epoch. | **`unresolved`** | Pure validator accepts valid current readiness tuple and rejects stale/forged/timed-out/transition tuples. | No official supported control channel exists to transmit authenticated readiness independent of workspace/chat context. Lifecycle completion alone does not prove policy readiness. | **UNVERIFIED** (Requires live ACP handshake verification). |
| **3. Authoritative Approval-Record Reset** | [`packages/coding-agent/src/config/settings.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/config/settings.ts) (`#readConfigOverlays`, `#mergeOwnLayers`, `#deepMerge`); [`docs/settings.md`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/settings.md) | CLI overlays passed via `--config` are aggregated together into a single overlay in `#readConfigOverlays` before being merged over project/global layers. | Evaluated at startup and configuration reload. | `translate-omp-owned-settings` (P3b) | Reset overlay with `approval: null` followed by mode overlay with explicit mappings. | **`incompatible`** | Counterexample fixture demonstrates that `#readConfigOverlays` overwrites `approval: null` with mode mapping, leaving lower-layer grants surviving in `#deepMerge`. | The approved reset-then-mode strategy fails natively. Merging `{approval: null}` and `{approval: {read: "allow"}}` in CLI overlays produces `{read: "allow"}`, which deep-merges over `{unknown: "allow"}`, retaining hostile grants. | **UNVERIFIED** (Requires checking effective configuration in running binary). |
| **4. Complete Destructive Intent** | [`packages/coding-agent/src/session/acp-permission-gate.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/acp-permission-gate.ts) (`getEditDestructiveIntent`, `extractPermissionLocations`) | Native ACP gate inspects edit tool calls, but `fileOps.find` returns only the first operation, and `extractPermissionLocations` produces an incomplete location list. | Evaluated per edit/write/delete tool call. | `normalize-acp-destructive-targets` (P1d) | Full parser extracting all operations (delete, move endpoints, patch mutations) bound to execution input. | **`incompatible`** | Pure validator extracts all targets for supported formats and rejects first-allowed/later-escaping patches with zero mutation attempts; unsupported decoders fail closed. | Official OMP code does not provide a supported full patch parser. Native location lists omit subsequent destructive operations in multi-file patches, creating a critical security gap. | **UNVERIFIED** (Requires observing real ACP permission prompts for complex patches). |
| **5a. Restricted-Only LSP: OMP** | [`packages/coding-agent/src/main.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/main.ts) (`--no-lsp` -> `enableLsp: false`); [`lsp/tool.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/lsp/tool.ts); [`settings.md`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/settings.md) | `--no-lsp` CLI flag and `lsp.enabled: false` setting. | Evaluated at process startup and on edit/write tool execution. | `disable-restricted-agent-lsp` (P5d) | Mode-scoped `--no-lsp` and `lsp.enabled: false` without clamping YOLO. | **`unresolved`** | Pure validator verifies restricted profile disables explicit & implicit LSP while YOLO remains unclamped. | `--no-lsp` suppresses startup discovery/warmup, but lazy cold-start via edit/write diagnostics is not conclusively severed without deep live settings trace. | **UNVERIFIED** (Requires monitoring language server processes during restricted edit/write). |
| **5b. Restricted-Only LSP: OpenCode** | `sst/opencode` tree `826d9ad46a22bef0294998e08daa3c4904fea28f`; `packages/opencode/src/agent/agent.ts`; `agent-config/opencode.json` | Per-agent `permission.lsp` vs top-level `lsp: false`. | Evaluated at agent session creation. | `disable-restricted-agent-lsp` (P5d) | Landed row 17 (decision 5): BOTH `build` and `yolo` explicitly deny `lsp` per agent; no global clamp. | **`incompatible`** (for implicit scoping) | Pure validator rejects global OpenCode LSP clamp affecting YOLO, but admits per-agent explicit deny as strict improvement. | OpenCode 1.18.21 allows explicit `lsp` tool denial per agent, but automatic implicit server boot on diagnostics cannot be scoped per agent at all without a global `lsp: false`, which decision 5 forbids; explicit denial therefore does not clear implicit startup. | **UNVERIFIED** (Requires observing language server daemon spawn under OpenCode build AND yolo). |
| **6. Native Transport Adaptation** | [`packages/coding-agent/src/tools/fetch.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/tools/fetch.ts) (`fetchOverride`); [`packages/coding-agent/src/web/scrapers/utils.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/web/scrapers/utils.ts) (`fetchBinary` uses global fetch with `redirect: "follow"`) | Tool parameters and environment variables (`HTTP_PROXY`). | Per URL read, web search, and public code search request. | `control-omp-url-fetch-transport` (P7a), `adapt-omp-web-search` (P7b), `adapt-omp-public-code-search` (P7c) | Complete per-hop validation via AIr validating proxy under enforcing egress. | **`incompatible`** | Pure adapter checks validate public text/binary/search with attribution, reject private targets and secondary bypasses, and preserve unrestricted egress. | OMP only passes `fetchOverride` on select text enrichment paths. `fetchBinary` and scraper redirects bypass `fetchOverride` and follow redirects automatically via global fetch, bypassing per-hop validation. | **UNVERIFIED** (Requires network packet capture / proxy access logs). |
| **7. Critical Skill Canonical Ownership** | [`packages/coding-agent/src/extensibility/skills.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/skills.ts) (`resolveCollision`, `setActiveSkills`); [`packages/coding-agent/src/sdk.ts`](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/sdk.ts) | Skill search paths and directory scanning. | Startup and runtime skill reload. | `guard-omp-executable-discovery` (P5a), `make-skill-staging-agent-portable` (P6) | Pin critical skills to canonical deployment-owned paths in read-only root; reject collision and symlinks. | **`incompatible`** | Pure validator selects canonical owned path, rejects workspace collision, symlink escapes, and stale resource generations. | Official OMP `resolveCollision` allows custom workspace directories to override provider skills. `setActiveSkills` is process-global. Name-only selection cannot guarantee canonical ownership. | **UNVERIFIED** (Requires observing skill loading with conflicting workspace files). |

---

## 4. Detailed Analysis of Selected Mechanism Incompatibilities

### 4.1 Authoritative Approval-Record Reset Counterexample

The approved design assumed that an owned reset CLI overlay containing:

```yaml
tools:
  approval: null
```

followed by an owned mode CLI overlay containing:

```yaml
tools:
  approval:
    read: "allow"
```

would act as an authoritative barrier that clears lower-layer (global or project) settings before applying the mode.
However, inspection of OMP's `packages/coding-agent/src/config/settings.ts` reveals:

1. `#readConfigOverlays` loops over all CLI config files and folds them into a **single** aggregated object via `#deepMerge`.
2. Merging `{tools: {approval: null}}` with `{tools: {approval: {read: "allow"}}}` yields `{tools: {approval: {read: "allow"}}}`.
3. When `#mergeOwnLayers` merges this aggregated CLI overlay over a lower layer that has:
   ```yaml
   tools:
     approval:
       unknown_tool: "allow"
       read: "deny"
   ```
4. `#deepMerge` recursively merges object properties:
   - `read` becomes `"allow"` (overwriting `"deny"`).
   - `unknown_tool` is **retained** as `"allow"`!
5. Consequently, the reset overlay is rendered inert. Lower-layer hostile grants or prompt/deny records persist into the effective configuration.
   **Verdict:** `incompatible`. Downstream application requires an explicit alternative (e.g. explicitly enumerating all known keys or an official reset mechanism) approved by the user.

### 4.2 Destructive Target Extraction Gap

In `packages/coding-agent/src/session/acp-permission-gate.ts`, `getEditDestructiveIntent` uses `fileOps.find` to return a single destructive operation. Its `extractPermissionLocations` method returns only locations from that single operation.
When a multi-operation patch modifies an allowed file first and subsequently deletes or moves an out-of-boundary file, native OMP code authorizes only the first location, blind to the later destructive escape.
**Verdict:** `incompatible`. The client cannot rely on native OMP location lists for destructive authorization.

### 4.3 Native Transport Partial Override

OMP `packages/coding-agent/src/tools/fetch.ts` provides a `fetchOverride` hook in some high-level text flows, but `packages/coding-agent/src/web/scrapers/utils.ts` and `fetchBinary` call the standard `fetch` API directly with `redirect: "follow"`. Secondary scraper requests and binary assets completely bypass `fetchOverride`.
**Verdict:** `incompatible`. A partial fetch override cannot satisfy the per-hop SSRF validating proxy requirement under enforcing egress.

---

## 5. Consumer Ownership Matrix

| Contract Name               | Downstream Batch Owner                                                            | Imported Value / Signature          | Downstream Obligation                                                                                                                                                                                                                  |
| :-------------------------- | :-------------------------------------------------------------------------------- | :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DiscoveryContract`         | `guard-omp-executable-discovery` (P5a)                                            | `validateDiscoveryContract`         | Must enforce pre-import rejection before invoking any importer or factory.                                                                                                                                                             |
| `ReadinessContract`         | `gate-omp-policy-readiness` (P5b)                                                 | `validateReadinessContract`         | Must bind handshake to current process, session, challenge, revision, and epoch.                                                                                                                                                       |
| `RecordAuthorityContract`   | `translate-omp-owned-settings` (P3b)                                              | `evaluateApprovalRecordAuthority`   | Must evaluate effective merged settings and detect residual grants/prompts/denies.                                                                                                                                                     |
| `DestructiveIntentContract` | `normalize-acp-destructive-targets` (P1d)                                         | `validateDestructiveIntentContract` | Must validate all delete targets, move endpoints, and patch mutations before execution.                                                                                                                                                |
| `RestrictedLspContract`     | `disable-restricted-agent-lsp` (P5d)                                              | `validateRestrictedLspContract`     | Superseded posture: encodes decision D6's restricted-only LSP removal; decision 5 (row 17) disables LSP in all agents/modes instead, so the export stays unwired (named residual; see `tests/acp/omp-lsp-coldstart-evidence.test.ts`). |
| `TransportContract`         | `control-omp-url-fetch-transport` (P7a)                                           | `validateTransportContract`         | Must validate every network hop under enforcing egress; distinguish unrestricted egress.                                                                                                                                               |
| `CriticalSkillContract`     | `guard-omp-executable-discovery` (P5a) / `make-skill-staging-agent-portable` (P6) | `validateCriticalSkillContract`     | Must resolve canonical owned SKILL.md in read-only root and reject workspace shadowing.                                                                                                                                                |

---

## 6. User-Owned Manual Verification Checklist (Design §15)

The following checklist contains runtime properties of the official compiled binary, architecture packaging, and live execution. Automated unit and mock tests **cannot and do not** verify these items.

- [ ] **Executable & Architecture:** Verify installed `omp --version` matches `v18.6.1`, SHA-256 checksums match published manifests for x64 (`c92a684...`) and arm64 (`cb78153...`), packaged notices are present, and image starts without adding Bun.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **Extension Loading & Discovery:** Exercise real trusted-extension load, pre-import exclusion, policy readiness, hostile custom tool/plugin top-level code, setting precedence, and critical skill resolution on new/load.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **Filesystem Delegation:** Observe actual ACP filesystem delegation, transformed-write readback behavior, restricted sink rejection, and native destructive permission shapes.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **LSP Suppression (all four agent/mode observations, row 17 carriers):** With the both-mode `--no-lsp` flags and per-agent `build`/`yolo` `lsp` denials landed, observe on a real host that no language-server process spawns — including implicit startup on edit/write/diagnostics — in EACH of: (1) OMP restricted, (2) OMP native-YOLO, (3) OpenCode `build`, (4) OpenCode `yolo`. Carrier wiring is config/launch evidence only; it does not clear the pinned 5a `unresolved` / 5b `incompatible` verdicts and no mock test here substitutes for these observations.\
      _Current Status:_ **UNVERIFIED (LSP disabled: all-off, row 17)**.
- [ ] **ACP Lifecycle & MCP:** Exercise real ACP initialize/new/prompt/cancel/load and operator MCP without host/workspace leakage.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **Skill Delivery:** Exercise both per-spawn and pooled skill delivery, with absolute payload paths and no duplicate deliveries.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **Pool Reuse & Recovery:** Observe real pool reuse, mode separation, crash/restart, history restoration, and cross-mode ownership rejection.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **Network Egress:** Observe actual native fetch/search/code-search traffic through the configured adapter/proxy, including binary/text fetches, redirects, and private-target failures.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **Container Isolation:** When configured and supported, verify bwrap sibling-workspace and daemon-environment isolation.\
      _Current Status:_ **UNVERIFIED**.
- [ ] **OpenCode Regression:** Confirm existing OpenCode runtime behavior after restricted LSP removal and shared sink changes.\
      _Current Status:_ **UNVERIFIED**.

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (sections A–I; the §15 checklist rows live there; pinned verdicts above stay unchanged).
