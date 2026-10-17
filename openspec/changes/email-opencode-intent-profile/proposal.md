# Proposal

## Why

Native deny-all OpenCode intent profile makes the approved email behavior implementable without hiding security or restart work in integration. The final whole-batch critique identified this as a separately owned prerequisite.

## What Changes

- Create an internal executionProfile=email-intent factory branch, never a user-selectable dashboard mode. Use an authored unique primary email-intent agent with permission {"*":"deny"} plus explicit deny keys for every shipped native read/edit/glob/grep/list/bash/task/external_directory/webfetch/websearch/lsp/skill/question/todo surface; no permissive overrides. Native denial applies before dispatch. Launch with a fresh private HOME/XDG roots and empty cwd outside any repository ancestry. Provision only the selected backend provider/model configuration (provider options/catalog and the required model API key), excluding agents, plugin, MCP, skills, instruction discovery and previous auth/session data. Use OPENCODE_CONFIG_CONTENT for the authored deny-all agent plus provider-only snapshot as the final application override. No email credentials or Skill API material exist in this profile. Confirm active ACP mode is email-intent; mismatch fails closed.
- Implement and verify this complete bounded responsibility before its consumers; production email remains unavailable until email-activation.

## Capabilities

### New Capabilities

- `email-opencode-intent-profile`: Native deny-all OpenCode intent profile with its own observable isolation and recovery contract.

### Modified Capabilities

None. Normal backend launches and non-email scheduling retain their current behavior.

## Impact

`agent-config/email-intent-opencode.json`, `src/acp/agent-factory.ts`, `src/acp/types.ts`, `Containerfile`, `tests/acp/email-opencode-profile.test.ts`, `tests/integration/email-intent/opencode-native.test.ts`. No implementation is authorized during proposal creation.

## Estimate

Total **7 engineering hours**, including implementation, tests, smoke, documentation and contingency itemized in tasks.md. Strictly below 8 hours; estimates are not guarantees.

## Batch:

- depends-on: email-config-identity
- code-conflict: email-omp-intent-profile (Containerfile, src/acp/agent-factory.ts, src/acp/types.ts)
- code-conflict: email-intent-runtime (src/acp/types.ts)
- code-conflict: email-tool-guidance (src/acp/agent-factory.ts)

Apply according to [the proposal batch index](../../../docs/superpowers/specs/2026-10-17-email-platform-design.md#proposal-batch-index), serializing shared-file conflicts.
