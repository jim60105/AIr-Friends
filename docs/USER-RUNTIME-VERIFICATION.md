# User-Owned Runtime Verification Checklist

Single consolidated checklist for the OMP integration batch (design
[§15](superpowers/specs/2026-10-06-omp-integration-design.md#15-user-owned-manual-verification-and-evidence-limit)),
expanded with the per-area runtime items recorded across the batch's OMP
documentation. Exclusive home: every predecessor document cross-links here and
keeps its own content — verification items are never maintained in two places.

**Evidence separation (binding on every row).** Each row separates three
kinds of evidence, and none of the first two ever substitutes for the third:

- **Source audit** — what the pinned upstream source/contracts establish
  (never a claim that the official executable behaves).
- **Unit/mock** — automated suites in this repository (`deno task test:unit` /
  `test:integration`). A passed unit/mock suite is NOT runtime verification.
- **User runtime** — the user's own observation on a real deployment. Until
  supplied, the runtime outcome reads `unverified`.

Historically cancelled readiness observations are marked **cancelled by user
decision** with the accepted residual risk retained (decision-register
§1a amendment, 2026-10-09).

Status vocabulary: `unverified` (awaiting user observation) | `cancelled` (by
user decision; residual risk accepted).

---

## A. Packaging, image, and startup (row 20 / P8; design §15 bullet 1)

Source-audit home: [docs/OMP_PACKAGING.md](OMP_PACKAGING.md) ·
Unit/mock: `tests/utils/omp-packaging.test.ts`, `tests/utils/omp-version.test.ts`,
Containerfile checksum gates.

| Observation                                                                                                                                                                  | Source audit                                           | Unit/mock                                                      | Runtime outcome + user observation |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------- |
| Installed `omp --version` reports the pinned `18.6.1` inside the built image                                                                                                 | Pin + bootstrap check (`OMP_PACKAGING.md`)             | `omp-version.test.ts` mock process results                     | unverified —                       |
| Both architecture artifacts (`omp-linux-x64` / `omp-linux-arm64`) download and pass per-arch SHA-256 verification; unique-match allowlist selects exactly one asset per arch | `OMP_PACKAGING.md` asset-selection rule                | packaging tests cover selection logic only (never wire bytes)  | unverified —                       |
| Release notices (`LICENSE`, `SHA256SUMS`, notices bundle) install under `/licenses/omp/` checksum-verified before consumption                                                | `OMP_PACKAGING.md`                                     | digest/asset bytes are user-owned checks (batch index §5)      | unverified —                       |
| Image starts with both binaries present (`/usr/local/bin/opencode` shipped default + `/usr/local/bin/omp` root-owned `0755`) and NO added Bun runtime dependency             | Containerfile stages; `OMP_PACKAGING.md`               | n/a (container acceptance excluded from mock suites)           | unverified —                       |
| Existing OpenCode runtime behavior unchanged after the batch's restricted LSP removal and shared-sink changes (OpenCode default deployment)                                  | `agent-config/opencode.json` per-agent denies (row 17) | row-24 `3.6` byte-identity of shipped per-spawn launch posture | unverified —                       |

## B. Trusted extension load, discovery, and policy (rows 12/14; design §15 bullet 2)

Source-audit home: [docs/OMP_DISCOVERY.md](OMP_DISCOVERY.md) ·
[docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md) ·
Unit/mock: `tests/acp/omp-discovery-guard.test.ts`, extension/wiring suites,
row-24 handoff suite `4.1` (composition only).

| Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Source audit                                     | Unit/mock                                                                                                                                    | Runtime outcome + user observation                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real trusted-extension load of the generated bundle at the contracted image path (`/opt/air/omp/extension/index.js`, no import map, no download — `OMP_PACKAGING.md` §5/§7); owned-module trust scope rejects workspace copies, package caches, symlink escapes, name-only matches                                                                                                                                                                                                                                                                                                                                   | `OMP_DISCOVERY.md` pre-import exclusion audit    | discovery-guard unit suite (synthetic paths); packaging suite proves the generated entry's emitted edges and fail-closed load parity                                 | unverified —                                                                                                                                                                                                                                                                                                                                         |
| Pre-import discovery exclusion observed on a live session (hostile custom-tool/plugin top-level code never executes)                                                                                                                                                                                                                                                                                                                                                                              | `OMP_DISCOVERY.md`                               | mock never loads the extension — every allow-side observation stays synthetic (ledger-registered)                                            | unverified —                                                                                                                                                                                                                                                                                                                                         |
| Hostile custom-tool top-level code (import-time side effects) cannot run before exclusion                                                                                                                                                                                                                                                                                                                                                                                                         | `OMP_DISCOVERY.md`                               | same synthetic boundary as above                                                                                                             | unverified —                                                                                                                                                                                                                                                                                                                                         |
| Critical skill resolution stays canonical across new/load/refresh lifecycle events with generation checks                                                                                                                                                                                                                                                                                                                                                                                         | `OMP_DISCOVERY.md` critical-skill section        | pinned skill-selection unit fixtures                                                                                                         | unverified —                                                                                                                                                                                                                                                                                                                                         |
| OMP skill discovery on the official binary sees ONLY the settings-declared owned root (`skills.customDirectories: [/opt/air/skills]` consumption + the seven foreign-source toggles staying off; the root-owned `/opt/air/skills` install present and agent-unwritable). NOTE: the pinned `*/SKILL.md` instruction layout is currently UNPOPULATED in the shipped `skills/` tree — on-image minting is zero-critical-refs fail-closed until an operator mount populates it (`OMP_SETTINGS.md` §7) | `OMP_SETTINGS.md` §7 pinned skills block         | `owned-skills` producer + `filesystem-authorization` gate suites certify the deployment-side selection only, never what the binary discovers | unverified —                                                                                                                                                                                                                                                                                                                                         |
| Policy readiness: NO client-observable authenticated readiness handshake exists (ReadySignal/channel consumption cancelled)                                                                                                                                                                                                                                                                                                                                                                       | decision-register §1a amendment (row 13 removed) | row-24 `4.1` asserts the composition carries no readiness tuple/state/channel                                                                | cancelled by user decision — accepted residual risk: an extension that fails to load leaves the session without the restricted capability set (`runner.emit` only logs lifecycle-hook errors and never fails startup); no client-observable readiness assertion, no equivalent native default-deny claim, no proof of complete ACP callback coverage |
| Per-call live tool-origin + fresh `registryEpoch`/`resourceGeneration` observation on every restricted call (stale generation denies)                                                                                                                                                                                                                                                                                                                                                             | `OMP_ENFORCEMENT.md`                             | `tool-enforcement-wiring` suites with injected fresh-read fixtures                                                                           | unverified —                                                                                                                                                                                                                                                                                                                                         |
| Missing restricted capability set after a failed extension load is observable operationally (accepted risk, monitor posture)                                                                                                                                                                                                                                                                                                                                                                      | decision-register §1a                            | n/a                                                                                                                                          | unverified —                                                                                                                                                                                                                                                                                                                                         |
| Native owned skill-URI admission on the official binary: the registered `read` replacement's declared `readsSkillUris` capability is honored; an owned `skill://<relative>` instruction reads through the same-tool native delegation once with zero network dispatch, and foreign same-name / symlink-replaced / traversing / stale-generation URIs deny before delegation; the native must treat the `skill://` path BYTE-EXACT (no percent-decode before opening — the resolver authorizes literal bytes, so a decoding native would open an unverified target; the literal-bytes posture also means percent-encoded traversal like `a%2F..%2Fb` is just a weird directory name that containment already refuses) (`repair-omp-owned-skill-handoff`; `OMP_NETWORK.md` owned skill-URI branch) | `OMP_NETWORK.md` owned skill-URI branch          | `omp-skill-uri-authorization`, `omp-native-registration` C6 pair, fetch-transport skill-branch suites — fixtures only; composition evidence   | unverified — requires the official binary evaluating the bundle against a populated `/opt/air/skills` tree (including a percent-encoded-spelling probe)                                                                                                                                                                                               |

## C. Filesystem, permissions, and destructive intent (rows 3/4/14b; design §15 bullet 3)

Source-audit home: [docs/AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md) ·
[docs/OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) ·
Unit/mock: filesystem-access/tool-policy suites.

| Observation                                                                                                                         | Source audit                               | Unit/mock                                                                          | Runtime outcome + user observation |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- |
| Actual ACP filesystem delegation routes through the client callbacks on a live session                                              | `AGENT_PERMISSIONS.md`                     | callback-level suites; native delegation unverified                                | unverified —                       |
| Transformed-write readback behavior (post-authorization content lands as authorized)                                                | `AGENT_PERMISSIONS.md`                     | descriptor-bound access primitives tested with fixtures                            | unverified —                       |
| Restricted sink rejection (writes outside authorized targets denied before approval)                                                | `AGENT_PERMISSIONS.md`                     | canonical-target authorization suites                                              | unverified —                       |
| Native destructive permission shapes require complete bound JSON endpoints; partial-list/patch forms deny (never silently approved) | `AGENT_PERMISSIONS.md` destructive section | destructive-normalization suites; pinned destructive `incompatible` verdict stands | unverified —                       |

## D. LSP posture — both agents, both modes (row 17 / decision 5; design §15 bullet 4)

Source-audit home: [docs/OMP_SETTINGS.md](OMP_SETTINGS.md) ·
[docs/OMP_SPAWN.md](OMP_SPAWN.md) ·
Unit/mock: `tests/acp/omp-settings.test.ts`, `tests/acp/agent-factory-omp.test.ts`,
row-24 `4.1` (launch-posture retention).

| Observation                                                                                                                  | Source audit                              | Unit/mock                                                                                                                                                                           | Runtime outcome + user observation                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| OMP restricted: LSP removed, including IMPLICIT startup (no server starts from language detection)                           | `restricted.yml` pin + `--no-lsp` carrier | settings/factory unit assertions (flags/config only)                                                                                                                                | unverified — implicit native suppression is exactly the unproven part                                                     |
| OMP native-YOLO: LSP disabled via `native-yolo.yml` and/or the `--no-lsp` launch argument, without adding restricted denials | decision-register §1a decision 5          | factory carries `--no-lsp` in BOTH modes AND `native-yolo.yml` pins `lsp.enabled: false` with zero restricted content (settings/factory unit assertions — repo-selected bytes only) | unverified — the settings pin proves repository configuration, not native server suppression or implicit-startup behavior |
| OpenCode build AND yolo: per-agent explicit `lsp` deny in `agent-config/opencode.json` (no global clamp)                     | decision-register §1a decision 5          | config-file assertions                                                                                                                                                              | unverified — per-agent deny does not establish implicit server suppression; recorded incompatibility verdicts unchanged   |

## E. ACP protocol surfaces (rows 6/10/11; design §15 bullet 5)

Source-audit home: [docs/OMP_POOL_MODES.md](OMP_POOL_MODES.md) ·
[docs/OMP_RECOVERY.md](OMP_RECOVERY.md) ·
Unit/mock: connector/recovery suites, row-23 lifecycle suite.

| Observation                                                                                           | Source audit                                                               | Unit/mock                            | Runtime outcome + user observation |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| Real ACP initialize/new/prompt/cancel/load against the official binary without host/workspace leakage | `OMP_SPAWN.md`, `OMP_RECOVERY.md`                                          | mock ACP agent exercises shapes only | unverified —                       |
| Operator MCP registration works without leaking host or workspace state                               | `OMP_DISCOVERY.md` MCP tiers (`needs-mechanism-audit` honesty tiers stand) | provenance/admission unit fixtures   | unverified —                       |

## F. Skill handoff and payload staging (rows 16/18; design §15 bullet 6)

Source-audit home: [docs/SKILLS_IMPLEMENTATION.md](SKILLS_IMPLEMENTATION.md) ·
Unit/mock: row-24 `tests/integration/omp-skill-handoff/handoff.integration.test.ts`
(both spawn shapes), `tests/skills/*`, `tests/skill-api/*`.

| Observation                                                                                                                    | Source audit                           | Unit/mock                                                            | Runtime outcome + user observation |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| Real per-spawn skill delivery: literal session id + absolute staging path in prompt; skill script delivers once, no duplicates | prompt templates; `session-staging.ts` | row-24 `3.1/3.2` per-spawn (mock agent + real server + real scripts) | unverified —                       |
| Real pooled/shared skill delivery: same contract with pointer resolution (no session env at spawn)                             | pointer/`active.json` contract         | row-24 `3.1/3.2` pooled                                              | unverified —                       |
| Real retry-on-missing-reply lands exactly once with literal-first guidance under real agent output                             | main-spec retry requirement            | row-24 `3.2` (mock silent turn)                                      | unverified —                       |

## G. Process pool modes and recovery (rows 10/11/21; design §15 bullet 7)

Source-audit home: [docs/OMP_POOL_MODES.md](OMP_POOL_MODES.md) ·
Unit/mock: row-23 lifecycle suite (`tests/integration/omp-lifecycle/`).

| Observation                                                            | Source audit                     | Unit/mock                                     | Runtime outcome + user observation |
| ---------------------------------------------------------------------- | -------------------------------- | --------------------------------------------- | ---------------------------------- |
| Real pool reuse across turns (one process serves the channel)          | `OMP_POOL_MODES.md`              | lifecycle suite with mock processes           | unverified —                       |
| Mode separation: restricted and native-YOLO never share a process      | ownership-keying contract        | mode-keyed pool-entry unit + lifecycle suites | unverified —                       |
| Crash/restart and history restoration behave under the official binary | `OMP_RECOVERY.md`                | mock crash markers                            | unverified —                       |
| Cross-mode ownership rejection denies before any spawn                 | `recovery-ownership.ts` contract | recovery-ownership unit/lifecycle             | unverified —                       |

## H. Network: fetch / search (rows 17–19; design §15 bullet 8)

Source-audit home: [docs/OMP_NETWORK.md](OMP_NETWORK.md) (honesty tables) ·
Unit/mock: fetch/search transport suites (adapter decisions only).

| Observation                                                                                                                                     | Source audit                                                 | Unit/mock                                                                   | Runtime outcome + user observation |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------- |
| Actual native fetch/search traffic passes through the configured adapter/proxy (mediation observed, not inferred from env presence) | `OMP_NETWORK.md` F14 residual stated openly                  | adapter decision tables; mock suites certify decisions only, never the wire | unverified —                       |
| Binary fetch and text fetch both mediate; redirects revalidated per hop                                                                         | `OMP_NETWORK.md`                                             | redirect-loop unit suites                                                   | unverified —                       |
| Private/loopback targets fail closed under the enforcing posture                                                                                | `ssrf.ts` classifier contract                                | classifier unit suites                                                      | unverified —                       |
| Whether the compiled-binary runtime honors a per-request proxy option at all                                                                    | `OMP_NETWORK.md` §15 checklist entry (`candidate-to-verify`) | n/a                                                                         | unverified —                       |

## I. Sandbox / bwrap isolation (design §15 bullet 9)

Source-audit home: [docs/AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md) ·
Unit/mock: n/a (container/bwrap acceptance excluded from mock suites by batch
evidence limits).

| Observation                                                                                                      | Source audit                                  | Unit/mock                            | Runtime outcome + user observation |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ | ---------------------------------- |
| When configured and supported: bwrap sibling-workspace isolation observed (agent cannot read sibling workspaces) | sandbox section of `AGENT_PERMISSIONS.md`     | none — excluded from mock acceptance | unverified —                       |
| When configured and supported: daemon-environment isolation for the enforcement daemon                           | `AGENT_PERMISSIONS.md` / `OMP_TOOL_POLICY.md` | none — excluded                      | unverified —                       |

---

## J. Owned-only settings discovery (row 26; `isolate-omp-settings-discovery`)

Source-audit home: [docs/OMP_SETTINGS.md](OMP_SETTINGS.md) section 6 ·
[docs/OMP_SPAWN.md](OMP_SPAWN.md) ·
Unit/mock: `tests/acp/omp-settings-sources.test.ts` (sanitization, observer,
connector gate — deployment-side control logic only).

| Observation                                                                                                                                                                                                                  | Source audit                                 | Unit/mock                                                                                              | Runtime outcome + user observation |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Live OMP process sees ONLY the owned `--config` overlays: no global/project/legacy or foreign-provider settings content reachable in the child (env inspection + effective-configuration observation on the official binary) | `OMP_SETTINGS.md` §6 pinned source inventory | sanitization + observer suites certify the deployment-side check only, never what the binary discovers | unverified —                       |
| Preflight rejection on a host-populated forbidden source is observable fail-closed on a live session (no spawn/session request occurs)                                                                                       | `settings-sources.ts` contract               | connector gate suite with zero-protected-call counters                                                 | unverified —                       |
| Sustained absence between checks is deployment-control responsibility: preflight is a per-request snapshot, NOT a race-free watcher; mid-process host mutation of a settings file can be undetectable                        | `OMP_SETTINGS.md` §6 responsibility limits   | none possible by design                                                                                | unverified —                       |
| Native autonomous settings reload semantics (whether/when the binary re-reads layers mid-session)                                                                                                                            | pinned revision observation notes            | n/a — no mock clears this                                                                              | unverified —                       |
| Settings visibility limits survive recovery/respawn (recovery preflight observed against the real recovery cwd on the official binary)                                                                                       | `OMP_SPAWN.md` lifecycle order               | recovery-cwd rejection with zero side effects (mock)                                                   | unverified —                       |

---

## K. Workspace executable-source checks (row 27; `check-omp-workspace-executables`)

Source-audit home: [docs/OMP_DISCOVERY.md](OMP_DISCOVERY.md) (decision-1
admission) · [docs/OMP_SPAWN.md](OMP_SPAWN.md) (executable lifecycle order) ·
Unit/mock: `tests/acp/omp-executable-sources.test.ts` (observer shapes,
connector seam, startup check — deployment-side control logic only).

| Observation                                                                                                                                                                                                                                                                                 | Source audit                              | Unit/mock                                                                                    | Runtime outcome + user observation |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| Sustained absence of workspace executable discovery entries between checks is user-owned deployment control: the observation is a per-request startup snapshot, NOT a race-free watcher; mid-process workspace mutation or a native autonomous re-discovery/import can be undetectable      | `OMP_SPAWN.md` executable lifecycle order | observer/seam suites certify the deployment-side check only, never what the binary discovers | unverified —                       |
| Snapshot and native reload timing limits: the accepted observation binds the workspace identity + generation at check time; whether/when the binary re-scans or reloads native tool/plugin state mid-session (registry transitions, refresh) is not observable from any repository artifact | `OMP_DISCOVERY.md` decision-1 admission   | stale/foreign observation never re-admits (mock)                                             | unverified —                       |
| Preflight rejection on a workspace holding an executable module is observable fail-closed on a live session (no spawn/session request occurs; `executable_sources_rejected` surfaces on pooled recovery)                                                                                    | `executable-sources.ts` contract          | connector gate suite with zero-protected-call counters                                       | unverified —                       |

No new config field, environment variable, or Helm value: the check rides the
existing owned settings-source plan and the deployment-set `AGENT_WORKSPACE`.

---

## Reading the cancelled row

The design §15 readiness observation (authenticated policy-readiness signal,
ReadySignal/channel, readiness reset on recovery/refresh) is **cancelled by
user decision** (row 13 removed without renumbering). The accepted residual
risk — extension-load failure leaving a session without the restricted
capability set, with `runner.emit` logging only — is retained verbatim in the
decision register and in row B above. Cancellation is not verification, and
mock suites never claim to clear it.

## Evidence limits (binding)

- No row may be flipped to verified on unit/mock evidence.
- Mock suites never invoke live agents, providers, platforms, containers, or
  bwrap, and never certify native runtime enforcement, wire traffic, or image
  architecture behavior.
- Pinned incompatible/unresolved verdicts in
  [docs/OMP_COMPATIBILITY.md](OMP_COMPATIBILITY.md) stay unchanged regardless
  of checklist progress.
