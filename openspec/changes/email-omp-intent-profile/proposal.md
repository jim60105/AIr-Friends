# Proposal

## Why

Native deny-all OMP intent profile makes the approved email behavior implementable without hiding security or restart work in integration. The final whole-batch critique identified this as a separately owned prerequisite.

## What Changes

- Add authored email-intent.yml with skills disabled, native exact-name deny entries for known tools and no normal restricted allow entries. Use the existing pinned synchronous api.on("tool_call") hook to unconditionally return {block:true,reason:safeCode} for every name under a host-only intent-profile flag fixed by the factory; ordinary restricted callback remains unchanged. This closes known and unknown native dispatch even without an ACP permission callback. Reuse the existing generated ESM entry and frozen bundler; no second bundle, generated OMP YAML or runtime fallback. Factory selects --config resolved email-intent.yml and --trusted-extension existing generated entry, with intent flag, private HOME/XDG/cwd and no user mounts/Skill JWT directory. Copy only deployment-authored models.yml bytes into isolated HOME and pass the selected provider API credential; do not copy auth databases, agents/skills/extensions or mailbox credentials.
- Implement and verify this complete bounded responsibility before its consumers; production email remains unavailable until email-activation.

## Capabilities

### New Capabilities

- `email-omp-intent-profile`: Native deny-all OMP intent profile with its own observable isolation and recovery contract.

### Modified Capabilities

None. Normal backend launches and non-email scheduling retain their current behavior.

## Impact

`agent-config/omp/email-intent.yml`, `src/acp/agent-factory.ts`, `src/acp/types.ts`, `src/acp/omp/extension/index.ts`, `src/acp/omp/extension/native-registration.ts`, `src/utils/omp-paths.ts`, `Containerfile`, `tests/acp/email-omp-profile.test.ts`, `tests/integration/email-intent/omp-native.test.ts`. No implementation is authorized during proposal creation.

## Estimate

Total **7 engineering hours**, including implementation, tests, smoke, documentation and contingency itemized in tasks.md. Strictly below 8 hours; estimates are not guarantees.

## Batch:

- depends-on: email-config-identity
- code-conflict: email-opencode-intent-profile (Containerfile, src/acp/agent-factory.ts, src/acp/types.ts)
- code-conflict: email-intent-runtime (src/acp/types.ts)
- code-conflict: email-tool-guidance (src/acp/agent-factory.ts)

Apply according to `../email-config-identity/batch-index.md`, serializing shared-file conflicts.
