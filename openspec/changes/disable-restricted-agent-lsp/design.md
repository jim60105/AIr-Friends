# Design: disable-restricted-agent-lsp

## Context

See `proposal.md` for motivation and `specs/acp-integration/spec.md` for requirements. The approved design fixes the goal (D5: LSP removed from both restricted agents including implicit language-server startup; D6: native YOLO keeps its LSP posture with no added denial) and the predecessor state: row 8 pins `lsp.enabled: false` in `agent-config/omp/restricted.yml` ONLY — `agent-config/omp/native-yolo.yml` carries no `lsp.*` key — row 9 assembles the restricted `omp acp` argument list without `--no-lsp`, and 14a's inventory already default-denies the `lsp` tool and `lsp-adjacent` routes, which 14b's wired `tool_call` handler enforces at execution time. P0's ledger verdicts are inherited verbatim: OMP = CANDIDATE (`main.ts` maps `--no-lsp` to `enableLsp:false` and SDK background discovery/warmup is gated, while pinned-source comments identify lazy cold-start via edit/write); OpenCode `1.18.21` restricted-only mechanism = UNAUDITED. Today's `agent-config/opencode.json` grants `"lsp": "allow"` in the `build` agent's permission map and `"*": "allow"` in `yolo`.

## Goals / Non-Goals

**Goals:**
- Restricted OMP launch + settings carry the disable through every supported mechanism row 9/row 8 expose (`--no-lsp` AND the `lsp.enabled:false` pin), with the lazy cold-start route resolved by a bounded pinned-source audit into either an additive 14a decision row or a recorded `userDecisionRequired` gate.
- Restricted OpenCode (`build` agent) loses the `lsp` permission; the `yolo` agent is byte-identical.
- A mechanism verdict is recorded per agent: supported-with-evidence, unsupported → NOT applied + gated, or residual-route → decision-extended or gated. Never a silent global clamp, never a mock-certified native claim.

**Non-Goals:**
- No edits to row 8's overlay content or composition module, row 9's state/env/launch skeleton, 14a's shipped row semantics (additive rows only), 14b's handler wiring, P0's contract module, or 14c (explicit non-dependency).
- No transport (17–19), no packaging/digest changes (20), no OpenCode or OMP version bump, no LSP replacement service, no new config/env/Helm field.
- No native-runtime execution: no live agents, no language-server spawn observation — that stays §15 user-owned.

## Decisions

### D1. Both mechanisms, composed — flag over overlay, both over neither

The restricted launch gains `--no-lsp` on top of row 8's `lsp.enabled:false` pin. Rationale: the CLI flag maps to `enableLsp:false` at CLI-parse time (`main.ts`, P0 evidence) and gates SDK background discovery/warmup; the settings pin covers sessions constructed through paths that consult live settings rather than the CLI parse. Choosing only one would leave the other layer's consumer reachable, and row 9's contract already passes `--config` overlays opaquely — adding one argument to the restricted branch of `buildBaseAgentConfig()` is the minimal wiring. Alternative rejected: settings-only (P0 shows the flag's discovery/warmup gating is a distinct code path); launch-flag-only (weakens defense-in-depth and contradicts row 8's already-shipped pin, which must not regress).

### D2. Lazy cold-start: bounded audit, then decide-extend or gate — never claim

Audit the pinned OMP revision (`packages/coding-agent/src/lsp/tool.ts`, `tools/settings.ts`, edit/write tool paths, and every consumer of `enableLsp`/`lsp.enabled`/`diagnosticsOnWrite`/`diagnosticsOnEdit`/`formatOnWrite`) for a path where the FIRST restricted `edit`/`write` (or read-side diagnostic/format route) boots a language server while `enableLsp:false` + `lsp.enabled:false` are in effect. Outcomes, recorded as a status artifact consumed by tests and docs:
- **No residual route** → the composed mechanisms are marked the supported LSP-suppression path (still §15-verified natively); no inventory change.
- **Residual route reachable through the restricted tool surface** → append additive default-deny rows to 14a's inventory table (data rows + design-§6/P0 citations, keyed on the `lsp-adjacent` route surface already defined in 14a) so 14b's unchanged handler denies the tool call that would trigger cold start. 14a's shipped rows are never edited; new decision SHAPES are out of scope (that would force a 14a revision, which is the honest escalation).
- **Residual route is native-internal** (fires inside `edit`/`write` execution with no consultable tool call) → ship the supported parts, record `userDecisionRequired` naming the exact source symbols, and gate the restricted-LSP acceptance requirement as fail-closed: docs/tests state suppression is partial-until-decision. Alternative rejected: intercepting file-write syscalls or sandbox tricks — inventing an unsupported boundary exceeds the pin's interfaces.

### D3. OpenCode: per-agent permission removal is the applied mechanism; the global kill-switch is gated, not applied

Remove the `"lsp": "allow"` entry from the `build` agent's permission map — the agent's `"*": "deny"` default then denies the explicit tool per-agent. OpenCode's documented permission model supports per-agent `permission.lsp` overrides merged over global (`opencode.ai/docs/agents`, `docs/permissions`), so the explicit-tool half is expressible without touching `yolo`. The audit question is the IMPLICIT half: whether per-agent permission denial also stops OpenCode's automatic language-server boot (diagnostics attached to read/edit/write behavior), or whether server boot is driven solely by the global top-level `lsp` config, whose only disable (`"lsp": false`) is process-global and would strip YOLO too. Decision rule, straight from design §6: apply only what the pinned `1.18.21` source shows is restricted-only. If implicit startup cannot be scoped per-agent, DO NOT set `lsp:false` — record the incompatibility, keep the per-agent explicit-tool deny (a strict improvement, no YOLO bleed), and gate full restricted-LSP removal `userDecisionRequired`. Alternative rejected: applying the global disable and "waiting for" a newer OpenCode — that silently shrinks native YOLO, explicitly forbidden.

### D4. YOLO exemption is structural, asserted not assumed

No `--no-lsp` in the native-yolo branch, no `lsp.*` key in `native-yolo.yml` (row 8 invariant, re-asserted), no `lsp` deny added anywhere in the `yolo` agent block, and the trusted extension (hence any LSP deny row, additive or shipped) is loaded ONLY in restricted launches (row 9's `--trusted-extension` is restricted-only). Tests prove each of these four independently so a future refactor that, e.g., passes launch args uniformly fails loudly.

### D5. Evidence boundary is part of the artifact

The implementation handoff and `docs/AGENT_PERMISSIONS.md` separate three columns: pinned-source claim (audit verdict + symbols), unit/mock evidence (what the suite mechanically proves), and §15 user checklist (unverified until observed). Restricted native LSP removal including implicit startup, and native YOLO LSP availability on both agents, are §15 lines; the suite's green check next to them is explicitly NOT evidence.

## Risks / Trade-offs

- **[OMP cold-start fires after the handler denies nothing]** The 14b handler sees tool calls, not internal boot → D2's audit is the only detector; if the audit is inconclusive within its bound, the gate is recorded, never guessed away.
- **[OpenCode per-agent deny proves tool-only]** Likely outcome per docs: implicit boot may be global-config-driven. Mitigated by D3's apply-explicit-only, gate-implicit rule — partial coverage is documented as partial.
- **[Partial coverage misread as complete]** The spec delta's requirements name their own evidence limits in-scenario; docs repeat the §15 lines verbatim rather than paraphrasing.
- **[Audit consumes the budget]** Bounded by design §17-style entry-point limits; unresolved-with-record is a valid outcome; contingency covers fixes, not deeper archaeology.

## Migration Plan

Pre-release change, no migrations: land the `agent-config/opencode.json` edit and the factory flag together; rollback is reverting both plus the additive inventory rows (data-only revert). Containers pick up the edited `opencode.json` at rebuild; restricted OpenCode loses the `lsp` tool immediately, `yolo` is unchanged at every step.

## Open Questions

None that can change the specs or approach: both mechanism unknowns have bounded audit procedures with pre-committed outcome branches (D2, D3), and anything the audit cannot resolve follows the recorded-gate path rather than a deferred decision.
