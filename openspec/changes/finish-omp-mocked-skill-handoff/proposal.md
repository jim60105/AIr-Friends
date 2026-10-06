# Proposal: finish-omp-mocked-skill-handoff

## Why

Design §14's "Reply flow" row ("Absolute staging and literal session identity reach real Skill API/handler logic with a mock platform; exactly the intended response is recorded, with no duplicate retry/fallback delivery") and §16's P9b row require a COMBINED per-spawn/pooled skill-handoff regression driving the REAL Skill API server, session registry, reply/file/reaction handlers and orchestrator delivery path with a mock ACP agent and mock platform adapter. Rows 4/9/10/13/16 each shipped their own unit/mock slices, and row 16's delivery test exercises the prompt-render→Skill-API→handler chain at component level, but the end-to-end orchestrator delivery flow under the NEW pooling/staging/identity regime — pooled process with no frozen `SESSION_ID`, literal-first retry prompt, mode-keyed pool entry, readiness gate in front of a delivery that must satisfy the at-least-one-response gate exactly once — is structurally invisible to any single row's suite. Row 21 covers the lifecycle half (new/prompt/cancel/load/crash); the skill-handoff half is explicitly this change's ("Row 22 consumes `omp-mock-session.ts` unchanged"). P9b's second half — the batch-final documentation synchronization — is equally owed: row 21 explicitly deferred its CHANGELOG entry here, rows 4–20 wrote prose serially into README/AGENTS/`docs/OMP_*` files, §15's user-runtime checklist exists only inside the design document with outcomes scattered as "tracked with row 22" across predecessor docs, and the batch contract's config-trio synchronization (each row claimed its own slice) has never been audited as a whole. This change closes the batch: tests+docs only, no production behavior change.

## What Changes

**Part 1 — Combined mocked skill-handoff regression (`tests/integration/omp-skill-handoff/`, deterministic, mock-only):**

- Drive the REAL `SkillAPIServer` + `SessionRegistry` + reply/file/reaction handlers + `SessionOrchestrator` delivery path with the mock ACP agent (row-21's `tests/mocks/omp-mock-session.ts` consumed UNCHANGED per its contract; `tests/mocks/mock-acp-agent.ts` extended ADDITIVELY with scripted skill-invocation behavior that spawns the real `skills/*/scripts/*.ts` against the local Skill API) and the `MockPlatformAdapter`; no real Discord/Misskey. Scenarios run in BOTH spawn shapes: per-spawn (frozen per-session `SESSION_ID`/`TMPDIR` env, legacy token expansion still available) and pooled OMP (`SKILL_SHARED_PROCESS=1`, `active.json` pointer, NO frozen `SESSION_ID`, literal id + absolute staging path per prompt per rows 10/16).
- Cross-component scenarios (each requires ≥2 landed rows' components; single-component decisions already unit-tested by rows 4/9/10/13/16/21 are NOT restated):
  - **Happy-path handoff, both shapes:** prompt renders literal Skill-API session id + absolute staging dir (row 16) → mock agent writes the payload file at the absolute path (restricted write authorized through row-4's sink decision on the real staging root) → mock agent invokes the real `send-reply` script with literal `--session-id` + absolute `--message-file` → real JWT auth + payload containment accept → orchestrator observes `replySent` and records EXACTLY ONE intended platform response via `MockPlatformAdapter`; no duplicate, no fallback dispatch.
  - **Missing-reply retry invariant under the new regime:** a turn ending `end_turn` with zero response triggers the retry exactly ONCE, and the retry prompt is literal-first in both shapes (literal id + absolute staging dir, zero unexpanded tokens — row 16); the retried turn's single delivery satisfies the at-least-one-response gate with no second delivery or fallback.
  - **Send-file invariants:** one successful call per session (429 + doom-loop counters), delivered message id anchored in `lastFileMessageId` and never `lastSentMessageId`, `edit-reply` on a file id rejected by the scoping check, file-only turn skips the conversation-summary gate (summary stays on `replySent`) while still counting as a response.
  - **Reaction-only and file-only turns satisfy the at-least-one gate** with zero retry; `send-reply` + `react-message` in one turn produces exactly those two platform actions, nothing added by the retry path.
  - **Auth/containment failure composes with the retry gate:** a skill call carrying a wrong-session JWT or an out-of-staging payload path is rejected by the REAL server (401/containment error), the turn still ends with no response, and the retry fires exactly once against the same session — asserting client-side rejection composition only, never native enforcement.
  - **OpenCode regression flows unchanged:** per-spawn OpenCode message flow through the same harness with byte-compared pool keys, spawn env, prompt-render and command strings, and the legacy `resolveSessionPath()` token-path expansion still working for existing callers (row 16's pinned compat), zero readiness/extension involvement.
- **Honest posture (row-21 pattern, restated without softening):** readiness, MCP admission, record reset, and destructive seams stay fail-closed in every scenario; restricted allow paths require row-21's `SyntheticPositive`-labeled fixtures registered in the runtime ledger, and no test name, comment, or assertion claims the native OMP binary staged a file, invoked a skill, or enforced anything. The mock subprocess does not load the trusted extension; that composition is client/handler-side evidence only.
- **Determinism and gate fit:** ephemeral-port local loopback Skill API (never the shared suite's fixed 3001), explicit awaited JSON-RPC/skill-call completion, `@std/testing` `FakeTime` for every timer path, no wall-clock sleeps, no network beyond loopback, no real agents, no `omp --version`, no container/bwrap; the suite runs under the existing `deno test:integration` and coverage tasks (>75%) which must not silently invoke live acceptance. `tests/mocks/omp-mock-session.ts` is extended ADDITIVELY in THIS change only if skill-handoff composition needs it (the row-21 contract makes the extension row 22's job, never a rework).
- **Test-only seam policy:** zero production change. If implementation proves a seam genuinely untestable from the harness (candidate: injecting the ephemeral Skill API port/`SKILL_JWT_DIR` into the orchestrator-spawned skill environment if no constructor/env path exists today), at most that minimal additive test-only hook ships and is flagged to the parent in the return — the row-21 precedent.

**Part 2 — Batch-final documentation synchronization (§15 checklist + §16 P9b):**

- `CHANGELOG.md`: add the consolidated entries for row 21's lifecycle suite (explicitly deferred there) plus this change's regression+docs work; AUDIT every prior OMP entry (rows P0–20, including row 20's already-landed entry) for presence, non-duplication, and terminology consistency — reconcile drift, never duplicate shipped entries.
- `README.md`: the OMP section — agent-type selection (`opencode` default | `omp`, unknown rejected at load), restricted vs native-YOLO deployment behavior, and the honest status statement (proposals approved; implementation lands through the applied rows; full security consumption remains gated by P0's unresolved verdicts and §15 user runtime verification).
- `AGENTS.md`: alignment on available agent types and the final payload-file/prompt-contract wording reflecting rows 4/16 (absolute literal staging + literal session id in prompts and skill recipes; `resolveSessionPath()` legacy token expansion pinned as OpenCode-caller compat only); the config-field audit table from the VERIFICATION audit lives in the AGENTS.md configuration-reference section.
- **ONE consistent checklist artifact `docs/USER-RUNTIME-VERIFICATION.md`** carrying the design §15 list verbatim-expanded per row, EVERY outcome `unverified` until the user supplies observations, cross-linked FROM every `docs/OMP_*` file (COMPATIBILITY, DISCOVERY, SETTINGS, READINESS, TOOL_POLICY, ENFORCEMENT, NETWORK, PACKAGING) and the README/AGENTS OMP sections — and cross-linking back, so predecessors' "tracked with row 22" items resolve to one home instead of eight parallel lists. Predecessor OMP docs gain only cross-link edits (append-only pointer lines to the checklist section), never content rewrites.
- **VERIFICATION audit:** every config/env field introduced or widened by ANY prior row — `agent.defaultAgentType`/`AGENT_DEFAULT_TYPE` value domain (row 7), `AGENT_OMP_MIN_VERSION` (row 20) — consistently present in `config.example.yaml` + `.env.example` + `helm/values.yaml`; and every row claiming "zero new fields" verified to have added none. Delivered as: (a) a focused deterministic sync test `tests/utils/config-trio-sync.test.ts` asserting field presence in all three files and that no unlisted `AGENT_OMP_*`/OMP-related name appears outside the audit table, and (b) the audit results table in AGENTS.md. Drift found → fixed in this change (docs-only; if drift reveals a missing trio entry a prior row OWED, fix the three files here and record the reconciliation).

**Explicit non-goals (named, owned elsewhere):** any P0 verdict revision or gate closure (P0 + rows 8/12/13/14 own the gates; this change restates them without softening); native runtime verification (design §15 user-owned — this change only records the checklist as unverified); dashboard/container/bwrap acceptance (row 20's image paths, user-owned); OpenCode version bump (row 15's audit note explicitly not acted on; separate deliberate decision); production behavior changes beyond a genuinely required, flagged test-only seam; re-implementing any single-row component decision rows 4/5/7–21 already unit-tested; per-spawn/pool payload CONTRACT changes (row 16 landed the contract; this change only proves delivery).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `skills-and-reply`: add requirements for the combined per-spawn/pooled mocked skill-handoff regression suite — the real-Server/registry/handler/orchestrator delivery flow with the mock ACP agent and mock platform adapter, the preserved retry/quota/anchor/summary-gate invariants under pooling+staging+literal-identity, the exactly-one-intended-response and no-duplicate/no-fallback rules, the honest fail-closed posture with labeled synthetic positives, and the determinism/live-acceptance-free execution contract.
- `configuration-and-deployment`: add the batch-final configuration-documentation consistency requirement — the audit that every batch-introduced config/env field appears consistently in all three documentation files, the sync-test enforcement, and the reconciliation path for drift.

## Impact

Eventual implementation owns: `tests/integration/omp-skill-handoff/` (new suite directory), `tests/mocks/mock-acp-agent.ts` (additive skill-invocation scripting; existing OpenCode behavior byte-compatible), `tests/mocks/omp-mock-session.ts` (additive skill-handoff composition fields ONLY — row-21 contract), `tests/utils/config-trio-sync.test.ts` (new), `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/USER-RUNTIME-VERIFICATION.md` (new), and append-only cross-link lines in `docs/OMP_COMPATIBILITY.md`, `docs/OMP_DISCOVERY.md`, `docs/OMP_SETTINGS.md`, `docs/OMP_READINESS.md`, `docs/OMP_TOOL_POLICY.md`, `docs/OMP_ENFORCEMENT.md`, `docs/OMP_NETWORK.md`, `docs/OMP_PACKAGING.md`. `config.example.yaml`/`.env.example`/`helm/values.yaml` are touched ONLY if the audit finds drift a prior row owed (recorded reconciliation). `src/**`, `skills/**`, `prompts/**`, `agent-config/`, `Containerfile`, `helm/templates/`, `deno.json` untouched; `tests/integration/` existing suites and `tests/mocks/mock-platform-adapter.ts` consumed unchanged (read-only harness).

Evidence posture, restated without softening: the suite certifies that the INTEGRATION CODE (orchestrator delivery path, Skill API authority, registry gates, retry strategy) composes the landed decisions correctly on fixtures with a mock ACP agent and mock platform. It certifies nothing about the official binary: real trusted-extension load, native staging by a real agent, real skill-script execution inside a real OMP process, real platform delivery, and real pool behavior all remain §15 user-owned observations — this change makes that boundary a first-class checklist artifact rather than eight doc footnotes.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Predecessor consumption audit (row-16 delivery test boundary, row-21 builder/mock contracts, shared-process harness patterns, Skill API port/JWT wiring) | 0.75 |
| Harness: additive mock-agent skill-invocation scripting + pooled/per-spawn spawn-shape fixtures + ephemeral-port Skill API wiring (test-only seam if genuinely needed, flagged) | 1.25 |
| Core handoff scenarios (happy path both shapes, retry-exactly-once literal-first, send-file quota/anchor, file-only summary gate, reaction-only, auth/containment-failure composition) | 2.00 |
| OpenCode byte-compare regression + honesty-posture assertions (fail-closed seams, synthetic-positive ledger guard) + non-duplication check against rows 16/21 suites | 0.75 |
| Documentation sync: CHANGELOG consolidation + README/AGENTS + `docs/USER-RUNTIME-VERIFICATION.md` + cross-link passes across `docs/OMP_*` | 1.75 |
| Config-trio VERIFICATION audit + sync test + drift reconciliation if found | 0.75 |
| Focused `test:unit`/`test:integration`/coverage runs, `openspec validate --strict`, contingency | 0.75 |
| **Total hard ceiling** | **8.00** |

## Batch:

depends-on: enforce-acp-filesystem-authorization
depends-on: normalize-acp-destructive-targets
depends-on: add-omp-agent-configuration
depends-on: translate-omp-owned-settings
depends-on: spawn-mode-scoped-omp-agents
depends-on: guard-omp-executable-discovery
depends-on: make-skill-staging-agent-portable
depends-on: control-omp-url-fetch-transport
depends-on: adapt-omp-web-search
depends-on: adapt-omp-public-code-search
depends-on: package-pinned-omp-runtime
depends-on: cover-omp-mocked-acp-lifecycle

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| make-skill-staging-agent-portable (row 16) | Required predecessor, contract under regression | Row 16's component-level delivery test (its task 4.3) is the boundary: this suite drives the full orchestrator session flow, retry gate, and summary gate around it and must not restate its prompt-render or payload-helper assertions. The literal-first retry prompt and absolute staging contract are consumed as landed behavior. |
| cover-omp-mocked-acp-lifecycle (row 21) | Required predecessor, shared harness | `tests/mocks/omp-mock-session.ts` consumed UNCHANGED; extension (additive fields) is this change's contractual job. `mock-acp-agent.ts` extended additively for skill invocation with existing OpenCode behavior byte-unchanged. The synthetic-positive runtime-ledger pattern is reused, not forked. Row 21's lifecycle scenarios are not restated. |
| enforce-acp-filesystem-authorization (row 4) / normalize-acp-destructive-targets (row 5) | Required predecessors, ambient conditions | Staged payload writes are authorized through row-4's real sink decision on the staging root; destructive decoding never appears as an allow path here. Their unit suites are untouched. |
| add-omp-agent-configuration (row 7) | Required predecessor, audit subject | The `AGENT_DEFAULT_TYPE`/`defaultAgentType` trio text written there is audited (not restated) by the VERIFICATION audit; the AGENTS.md agent-type table is extended, never rewritten. |
| translate-omp-owned-settings (row 8) / spawn-mode-scoped-omp-agents (row 9) / guard-omp-executable-discovery (row 12) | Required predecessors, scenario ingredients | Pooled spawn env (`SKILL_SHARED_PROCESS=1`, mode-scoped state), owned-settings posture, and the honest extension-load boundary are ambient; README's restricted/YOLO prose cites their landed contracts. No file overlap. |
| control-omp-url-fetch-transport (row 17) / adapt-omp-web-search (row 18) / adapt-omp-public-code-search (row 19) | Required predecessors, docs audit only | Their `docs/OMP_NETWORK.md` sections receive append-only cross-link lines to the checklist; the "row 22 extends never rewrites" rule is honored — the checklist artifact links INTO their sections, never edits them. No network scenarios here. |
| package-pinned-omp-runtime (row 20) | Required predecessor, CHANGELOG + audit reconciliation | Row 20 landed its own CHANGELOG entry (present, not duplicated); `AGENT_OMP_MIN_VERSION` trio presence is an audit subject, fixed only on drift. The suite runs against the DEV-path tree; never `/opt/air/omp`. |
| establish-omp-compatibility-contracts (P0) + rows 6/10/11/13/14a/14b/14c/15 | Indirect/transitive gates and ingredients | Verdicts restated without softening (readiness unresolved → fail-closed deny; labeled synthetic positives are the only allow path); mode-keyed pool and literal-identity invariants appear as ambient conditions. |

- Shared-file conflict: `CHANGELOG.md` — FINAL serial write for the batch here: rows P0–20 entries are read-only except drift reconciliation; this change ADDS the row-21 (deferred) and row-22 entries only. `README.md`/`AGENTS.md` — beyond row 20's small notes and row 16's §4 edit, owned here for the final OMP prose; earlier prose extended, never rewritten. `docs/OMP_*` — append-only cross-link lines (one pointer per file); content owned by their authoring rows. `docs/USER-RUNTIME-VERIFICATION.md` — new, exclusive. `tests/mocks/*` — ADDITIVE only (row-21 contract); `tests/integration/omp-skill-handoff/` new directory. `config.example.yaml`/`.env.example`/`helm/values.yaml` — untouched unless the audit finds drift owed by a prior row (recorded).
- Spec-conflict: ADDED requirements are uniquely named within their capabilities (`skills-and-reply`, `configuration-and-deployment`) and bind only this suite's/documentation-sync obligations; no predecessor requirement is modified, and no row-22 text may present a fail-closed seam as supported.
- Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
