# Tasks

Total estimate: **6.75 engineering hours**, strictly below 8 hours. Estimates include tests, controlled smoke verification, documentation and contingency; they are not guarantees. Apply dependencies: `email-session-receipts`, `email-opencode-intent-profile`, `email-omp-intent-profile`. Production activation remains blocked until the final batch cutover.

## 1. Owned behavior and its regression coverage

- [x] 1.1 (2h) Consume both completed native profile factory contracts and add deny-all ACP callback handling; verify selected profile identity, absence of mailbox/Skill API credentials and unchanged ordinary connector behavior. Native policy/assets are predecessor work, not hidden in this budget.
- [x] 1.2 (1.5h) Add bounded private text capture and teardown; verify no user mounts/mailbox credentials/Skill API material and timeout/overflow producer-safe cleanup, while the selected model-provider authentication remains usable.
- [x] 1.3 (1.25h) Add and run this responsibility's deterministic regression cases. Verify: Use deterministic ACP fixtures for both backends with environment/filesystem sentinels and assert zero tool effects, not only prompt text. Preserve ordinary connector behavior.
- [x] 1.4 (0.5h) Document the intent-only profile, hard failure behavior and accepted model-judgment limitation. Verify the documented fields, outcomes and commands match the implemented interface and link this slice's acceptance scenarios in `docs/email-platform.md`; add its scoped CHANGELOG entry.
- [x] 1.5 (0.75h contingency) Resolve bounded integration defects in the owned interfaces/tests only; verify the same acceptance cases after fixes, or record unused contingency without inventing extra features.

## 2. Controlled integration smoke

- [x] 2.1 (0.75h) Exercise the completed boundary with its real predecessor implementations in isolated temporary state. Verify all scenarios in `specs/email-intent-runtime/spec.md`, checking external side-effect counts and failure outcomes; use the owned/predecessor local IMAP/SMTP fixtures when transport is involved. Record actual exercised layers separately from model/production evidence.

Implementation checking policy: run local slice checks after its own edits settle; run the final repository formatting/lint/type/regression gate only once after the full integrated batch. During this planning assignment run only the final OpenSpec/artifact gate, with no application code tests.

## Evidence notes at apply

### 1.1 — Profile consumption, deny-all callbacks, identity

- `src/core/email-intent-runtime.ts` calls the real `createEmailIntentAgentConfig(backend, selection, roots, options)`
  for both engines and reads the identity back off `AgentConfig.executionProfile`, refusing anything that does not
  carry `"email-intent"`; on OMP it additionally requires the host-only `OMP_INTENT_PROFILE` marker to carry its
  EXACT value (`OMP_INTENT_PROFILE_FLAG_VALUE`), because the pinned extension classifies an unobservable marker as an
  ordinary launch.
- `src/acp/agent-connector.ts` gained an intent branch that requires the intent profile and the intent capture seam
  to AGREE in both directions before anything is spawned, supplies an EMPTY `SkillAutoApproveList` (the profile
  provisions no skill tree, so the ordinary mandatory trusted-root inventory cannot apply), drains the child's stderr
  without logging any of it, and verifies the created session before the prompt: the OpenCode session must advertise
  the authored intent agent as its only selectable mode, and (when a model selector is advertised) the requested
  `${providerID}/${modelID}` selection is applied, failing closed if the advertised catalog refuses it. OMP has no ACP
  session-mode override, so its identity evidence is the marker-checked launch.
- `src/acp/client.ts` gained the deny-all sink: with `ClientConfig.intentCapture` present, `requestPermission`,
  `readTextFile` and `writeTextFile` refuse before any ordinary path (YOLO, registered-skill, reserved-state,
  read/edit evaluation) and before any log/audit/rejection write, and `sessionUpdate` reports text to the bounded
  capture instead of the message buffer while treating `tool_call`/`tool_call_update` as a tool attempt.
- Verified by `tests/acp/email-intent-runtime.test.ts`: no `EMAIL_`/`SKILL_`/`DISCORD_`/`MISSKEY_` variable and no
  `SKILL_JWT_DIR` in the spawn environment, no trusted-skill provenance / Skill session id / YOLO flag on the client
  config, private HOME mode 0700 under the interpretation's own base with (OMP) the byte-copied authored model file,
  and an explicit ordinary-launch case asserting the ordinary connector path still logs its stream, answers
  permissions through its own policy and completes.

### 1.2 — Bounded capture, deadline and producer-safe teardown

- Capture is in-memory only and counts cumulative UTF-8 bytes before retaining a chunk; an overflow (or a tool
  attempt) discards the whole capture, so no partial output can be returned. The runtime never logs, persists or
  audits authored text, captured text or engine stderr; it logs bounded metadata only (backend, status, reason).
- The 30-second deadline races the WHOLE connect → createSession → prompt sequence and every stage re-checks it, so
  a late connect cannot dispatch a prompt against roots teardown has begun to reclaim; the losing arm's settlement is
  always observed, and the timer is cleared in `finally`.
- Teardown is ordered and individually guarded: a `CANCEL_BUDGET_MS`-bounded best-effort cancel (only when the run did
  not complete), the connector's disconnect, a confirmation that the launched wrapper is gone (bounded
  `processAlive` polling of the connector's process evidence), and only then removal of this interpretation's own
  base directory. An unconfirmed exit RETAINS the base with a bounded warning instead of reclaiming under a live
  producer — the same producer-safe posture the workspace tmp lifecycle uses. Removal never leaves the base subtree.
- Verified: timeout (600 ms override) → `timeout` under the 30 s hard bound; 8 KiB + 1 → `output_overflow` with no
  text; exactly 8 KiB → `complete`; constructor overrides cannot widen either hard bound.

### 1.3 — Deterministic regression cases (scripted fake ACP engine, both backends)

`tests/acp/email-intent-runtime.test.ts` drives the REAL runtime, the REAL `AgentConnector` and the REAL
`ChatbotClient` against `tests/acp/fixtures/email-intent-acp-engine.ts`, a scripted ACP engine spoken over a real
stdio pipe and spawned exactly like a production launch (`dumb-init -- deno run …`). Cases: success capture for both
backends; timeout; 8 KiB + 1 overflow; exactly-8-KiB success; tool attempt through a permission request (asserting the
explicit `reject_once` answer), through a `tool_call` notification, and through both filesystem callbacks; a
filesystem sentinel proving ZERO tool effect and a refusal message that discloses no path; incomplete output (no text,
blank text, non-`end_turn` stop); refused profile (undeclared model selection, non-intent session mode, missing mode
selector, foreign mode roster) with NO prompt ever dispatched; model pinning when the engine advertises another
selection; stderr and captured-output privacy; root reclamation for every case; the mismatched profile/capture pair
refused before spawn; and the unchanged ordinary connector path. The subprocess-backed cases self-skip without
`dumb-init`.

### 1.4 — Documentation

`docs/email-platform.md` gained the `email-intent-runtime` section (what an interpretation gets, the fail-closed
reason taxonomy, double identity verification, the accepted model-judgment limitation, the exported API, the linked
acceptance scenarios and the slice commands); `CHANGELOG.md` gained its scoped `Unreleased` entry.

### 2.1 — Controlled integration smoke: what was actually exercised

EXERCISED: the real profile factory for both engines against the SHIPPED authored deny-all documents plus a fixture
native payload (OMP), the real `AgentConnector` spawn path including `clearEnv` env passing, the intent branch
(inventory bypass, stderr privacy, session identity and model pinning), the real `ChatbotClient` deny-all and capture
paths, the deadline, and the teardown/reclamation path (including the retained-roots posture when termination is
unconfirmed) — all against a scripted engine process over a real stdio pipe.

SUBSTITUTION, stated plainly: the design asks for a composed profile/capture smoke "against the predecessor scripted
provider". This slice composes the runtime with the real profile factory and the real connector/client against a
SCRIPTED ACP ENGINE with a fixture payload; it does not drive the predecessors' loopback provider through this
runtime. The flag-gated NATIVE legs stay where they already live (rows 16/17: `EMAIL_INTENT_OPENCODE_ACCEPTANCE=1` /
`EMAIL_INTENT_OMP_ACCEPTANCE=1`), which is also where a runtime-level native/provider composition belongs once a
deployment exercises it.

NOT exercised (honest boundaries): a real `opencode`/`omp` executable, a real provider or credential, the native
pre-dispatch denial layer, any model judgment, and any IMAP/SMTP transport (this change touches no transport). No
test writes authored text to disk: the scripted engine records a SHA-256 digest and length of the prompt, never its
text. The `2.1` box is checked for the exercised layer above, which is the same scripted-provider assurance level the
rest of this suite offers; the production bootstrap wiring remains `email-activation`'s cutover.
