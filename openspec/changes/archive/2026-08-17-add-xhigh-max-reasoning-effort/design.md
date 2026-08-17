## Context

The system exposes reasoning-effort configuration at three levels (global, per-rule, per-section) that
resolve per session and are applied to the ACP agent via the `thought_level` Session Config Option. The
project maintains two independent vocabulary lists that currently enumerate `none | low | medium | high`:

1. `KNOWN_REASONING_EFFORTS` in `src/core/config-loader.ts` — used by `normalizeReasoningEffort()` to
   decide whether a config value is a standard level (returned as-is) or a passthrough token (preserved
   with a non-standard warning).
2. `KNOWN_REASONING_EFFORT_TOKENS` in `src/acp/agent-connector.ts` — used by `setReasoningEffort()` to
   decide whether a value follows the known-token application gate (skipped with a structured warning
   when the model does not offer it) or is sent blindly as a passthrough token.

The `ReasoningEffort` type union in `src/types/config.ts` mirrors the known vocabulary for editor
autocomplete. Models with extended thinking budgets advertise levels such as `xhigh` and `max`; using
them today produces a misleading passthrough warning at load and passthrough send semantics at apply.

The project is unreleased with 0 users; no backward-compatibility or migration constraints apply.

## Goals / Non-Goals

**Goals**

- Treat `"xhigh"` and `"max"` as first-class standard reasoning-effort levels end-to-end: load without
  warning, resolve through the existing chain, apply through the known-token gate.
- Keep the two vocabulary lists and the type union consistent, verified by tests (see D1).

**Non-Goals**

- No new resolution-chain semantics, audit outcomes, or observability behavior — the existing paths
  already cover known tokens.
- No reordering or renaming of existing levels.
- No validation that a model actually supports the new levels beyond the existing advertised-values gate.

## Decisions

### D1: Extend the two existing constant lists rather than introducing a shared vocabulary module

`KNOWN_REASONING_EFFORTS` (config-loader) and `KNOWN_REASONING_EFFORT_TOKENS` (agent-connector) are
updated in place to include `"xhigh"` and `"max"`. The `ReasoningEffort` type union gains both values.

- **Why**: Minimal diff; the lists already serve different purposes (load-time normalization vs.
  apply-time gating) and are tested independently. Extracting a shared module would touch the same
  files with no behavioral benefit for a two-element addition.
- **Alternative considered**: A single `REASONING_EFFORT_VOCABULARY` constant imported by both call
  sites. Rejected for now: the config-loader list includes the `"default"` sentinel while the
  connector list intentionally excludes it (`"default"` short-circuits earlier in
  `setReasoningEffort()`), so the lists are not textually identical; forcing one source would blur the
  semantic difference.
- **Sync risk**: Two lists must stay consistent. Mitigated by updating the type union, both lists, and
  the tests in the same change, plus a new cross-consistency unit test asserting that every
  `KNOWN_REASONING_EFFORTS` entry except `"default"` is present in `KNOWN_REASONING_EFFORT_TOKENS`
  (and vice versa), so a future drift between the lists fails CI.

### D2: New levels follow the existing known-token application gate unchanged

Once listed in `KNOWN_REASONING_EFFORT_TOKENS`, `"xhigh"` / `"max"` automatically get the existing
behavior: case-insensitive match against the model's advertised `thought_level` values, canonical-casing
send on match (`applied`), structured `skipped_unavailable` skip with warning when the model does not
offer them. No code change in `setReasoningEffort()` is required.

- **Why**: This is exactly the semantic the operator wants — a recognized standard level, applied when
  the model supports it and loudly skipped when not — and it replaces the previous blind passthrough
  send for these tokens.
- **Alternative considered**: Leave the tokens as passthrough and only silence the load warning. Rejected:
  passthrough sends bypass the advertised-values gate, so a typo like `"xhhig"` would still be sent to
  the agent and fail at runtime instead of being caught by the gate.
- **Edge case — empty advertised value list**: a `thought_level` option with an empty enumerated value
  list keeps the existing behavior for all known tokens (`none`–`max`): the token is sent as-is, since
  an empty list means the option is open-ended. This matches today's behavior for `none|low|medium|high`
  and is not changed by this proposal; the new `skipped_unavailable` scenarios are scoped to options
  with a non-empty enumerated list.

### D3: Documentation mirrors the vocabulary change

`AGENTS.md`'s effort table, the `ReasoningEffort` JSDoc in `src/types/config.ts`, and the comment
blocks in `config.example.yaml`, `.env.example`, and `helm/values.yaml` are updated where the vocabulary
is enumerated. The values are simply added; no new config fields are introduced.

## Risks / Trade-offs

- [Two lists could drift in a future change] → The connector's known-token set is exercised by unit
  tests covering the skip-when-not-offered path; a drift would surface as a behavior change in tests
  touching both constants.
- [`"max"` could collide with a future model's differently-cased value] → Case-insensitive matching and
  canonical-casing send already handle casing; the gate requires the value be present in the model's
  advertised list before sending.
- [Operators previously relied on `"xhigh"`/`"max"` passthrough being sent even when unadvertised] →
  Zero-user unreleased project; the new skip behavior is the desired outcome and is the same behavior
  already applied to `none|low|medium|high`.

## Migration Plan

None required. This is an additive vocabulary extension in an unreleased project. Rollback is a revert
of the constant/type/doc changes.

## Open Questions

None.
