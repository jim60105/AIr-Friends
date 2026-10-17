# Tasks

Total **7 engineering hours**, strictly below 8 hours; an estimate, not a guarantee. Dependencies: email-config-identity.

## 1. Complete owned prerequisite

- [x] 1.1 (2h) Implement authored deny-all native profile and provider-only factory selection; verify ordinary launches remain unchanged and intent mode cannot become build/yolo.
- [x] 1.2 (2h) Add development/image asset resolution and scripted real OpenCode native-dispatch regression; verify read/network/bash/skill/unknown attempts have zero effects.
- [x] 1.3 (1.25h) Add/run deterministic regression and native-dispatch or durable scheduler cases. Verify: Reuse existing OpenCode ACP lifecycle patterns and a loopback scripted provider, no paid model. Native profile acceptance must use the real installed executable and fail explicitly when mandatory prerequisites are unavailable; mocks are labeled separately.
- [x] 1.4 (0.5h) Document internal profile selection, model-provider-only provisioning and stock/development assets without adding public configuration fields. Verify docs match owned inputs/results and add scoped CHANGELOG entry.
- [x] 1.5 (0.5h contingency) Fix bounded owned integration defects and recheck the same acceptance cases, or record unused contingency without adding features.

## 2. Controlled smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with real predecessor implementations and isolated scripted local services/native executable or scheduler. Verify zero unauthorized effects and unchanged non-email behavior, recording native versus mock evidence explicitly.

No application verification runs during this planning assignment; only final artifact gates run after the entire proposal batch is complete.

### Exercised evidence (apply)

Deterministic layer — `tests/acp/email-opencode-profile.test.ts` (16 cases, no subprocess, no
network, no engine): the launch identity and private-root layout; the composed
`OPENCODE_CONFIG_CONTENT` carrying the wildcard denial plus an explicit denial for every shipped
native surface, exactly one declared agent, every built-in agent disabled and no permissive rule,
provider/command/compaction policy absent; provider-only provisioning (only the selected catalog
entry, only its `{env:...}` credential, no mailbox/Skill API/bot-platform variable); ordinary
OpenCode launches carrying no profile identity and no `OPENCODE_CONFIG_CONTENT`; and every
fail-closed refusal (undeclared provider, unlisted model, `{file:...}` reference, reserved or
excluded credential family, missing credential, relative/overlapping/symlinked/non-fresh/repository
roots, tampered authored document). The Containerfile install assertion parses the real
`Containerfile` and checks the authored document lands at the exact installed path the factory
resolves.

Native layer — `tests/integration/email-intent/opencode-native.test.ts` (gated on
`EMAIL_INTENT_OPENCODE_ACCEPTANCE=1`; ignored, never falsely passing, without it). Observed on the
real installed `opencode` 1.18.23 driven through the shipped factory by a test-owned loopback
HTTP provider: the session advertises exactly one selectable mode (`email-intent`) and exactly the
selected model, mode switches to `build`/`plan`/`yolo`/`general` are rejected, all six scripted
tool calls (`read`, `bash`, `webfetch`, `websearch`, `skill` and an unknown tool) fail closed with
the engine's own unavailable-tool text, zero webfetch HTTP hits, zero ACP permission/filesystem
callbacks, no sentinel bytes delivered to the client or echoed to the provider, and the scripted
terminal turn completing over 7 provider requests. The MODEL is a labeled mock; the dispatch,
denial and mode advertisement are the real engine's.

Contingency (1.5h, used in scope): the pre-implementation review found that a built-in agent's own
permission ruleset overrides the top-level denial, so the authored document now disables the whole
built-in roster and the factory refuses a document that drops any of those disables — verified by
both the deterministic case and the native mode-switch assertions. No unscoped work was added.

Declared deviations: the exported entry point is `createEmailIntentAgentConfig(backend, ...)` with
an added optional injectable `options` argument; `todoread` is retained beside the pinned engine's
`todowrite` as a conservative legacy denial; the profile carries no `skillsRoot`, so consumers
that require one (the ordinary `AgentConnector`) must handle the profile explicitly — recorded in
`docs/email-platform.md`.
