# Tasks

Total **7 engineering hours**, strictly below 8 hours; an estimate, not a guarantee. Dependencies: email-config-identity.

## 1. Complete owned prerequisite

- [x] 1.1 (2h) Implement authored intent YAML, factory selection and unconditional native hook branch; verify ordinary mapped-tool callback unchanged. (`agent-config/omp/email-intent.yml`, `createEmailIntentAgentConfig("omp", ...)`, the launch-marker branch in `src/acp/omp/extension/native-registration.ts`; the unchanged restricted callback is pinned in `tests/acp/omp-native-registration.test.ts` and by the delivered-bundle smoke.)
- [x] 1.2 (2h) Wire development/image asset resolution and real pinned-native scripted dispatch tests; verify known/unknown denial plus model catalog in isolated HOME. (dev→image resolution for the settings document, the deployed/dev model source and the generated bundle; `tests/integration/email-intent/omp-native.test.ts` is the pinned-native leg, `tests/acp/email-omp-profile.test.ts` pins the private-HOME model copy and catalog advertisement.)
- [x] 1.3 (1.25h) Add/run deterministic regression and native-dispatch or durable scheduler cases. Verify: Reuse tests/integration/omp-native-runtime native executable, authored fixture models and loopback scripted provider, including a malicious tool exposure fixture. Assert actual native tool-result denial and unchanged filesystem/network sentinels, not only callback mocks. (Deterministic cases all run and pass; the native leg reuses the pinned executable, the tracked loopback model fixture and the `unknown-tools.js` exposure control, and carries a positive control. The native leg itself stays UNEXERCISED here: no pinned 18.6.1 executable was available, so it is flag-gated and its first real run is the evidence.)
- [x] 1.4 (0.5h) Document the internal intent flag/profile and required authored model/settings/generated bundle deployment without a new public setting. Verify docs match owned inputs/results and add scoped CHANGELOG entry. (`docs/email-platform.md` "Native OMP Intent Profile", including the spawn contract for the host-only marker, plus one scoped Unreleased entry.)
- [x] 1.5 (0.5h contingency) Fix bounded owned integration defects and recheck the same acceptance cases, or record unused contingency without adding features. (Used once: the post-implementation review's marker/spawn-seam, fixture-marker and leg-observability findings were fixed and the same cases rechecked; no contingency added features.)

## 2. Controlled smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with real predecessor implementations and isolated scripted local services/native executable or scheduler. Verify zero unauthorized effects and unchanged non-email behavior, recording native versus mock evidence explicitly. (BLOCKED on a host with the pinned OMP 18.6.1 executable: without it the leg refuses to claim native success by design. Everything reachable here — deterministic refusals, the delivered-bundle wiring, the ordinary-launch regression — is exercised and green.)

## Handoff note (row 18 `email-intent-runtime`)

The profile returns its child environment and mount metadata but applies no sandbox of its own. The
consumer MUST spawn that environment verbatim (`clearEnv` semantics) and must not route it through
an allow-list/`filterEnv` pass: `OMP_INTENT_PROFILE` is the launch's own identity, and an
unobservable marker classifies as an ordinary launch (restricted callback instead of deny-all). If
row 18 does need a filtered environment, the marker has to be carried through explicitly — a
preserve rule for `executionProfile === "email-intent"` — rather than silently dropped.

No application verification runs during this planning assignment; only final artifact gates run after the entire proposal batch is complete.
