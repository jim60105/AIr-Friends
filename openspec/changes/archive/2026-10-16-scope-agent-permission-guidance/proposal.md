# Proposal

## Why

Bundled browser guidance states shell operators are always rejected even in native-YOLO OMP, and self-research correction text names OpenCode restrictions for every engine. These claims can deter valid operations before the agent tries them; the researched log does not establish an actual failed redirection attempt.

## What Changes

- Scope command/operator restrictions to the effective engine and permission mode in bundled capability/browser fragments and corrective retries.
- Retain restricted command validation, tolerated standard-stream fd redirects and per-segment chaining rules where they apply; remove misleading unconditional claims from YOLO guidance.
- Describe OMP stdout handling as a tool-use recommendation, retaining native service/background lifecycle instructions and explicit LSP denial.
- Pass the session's selected agent type and resolved YOLO decision to self-research correction rendering, keeping bounded rejection evidence and completion verification unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prompt-template-system`: engine/mode-specific permission claims in initial and recovery instructions.
- `self-research`: correction guidance selected for the running engine and effective permission mode.

## Impact

Changes `prompts/agent_permissions.md`, `prompts/browser_automation.md`, self-research retry construction/callsite in `src/core/session-orchestrator.ts`, focused prompt/retry tests, and relevant engine documentation. Audit the existing missing-reply builder in `src/acp/agent-factory.ts` for equivalent wording without rewriting delivery recipes. No configuration, command gate, filesystem authorization, retry policy or external skill changes. This is one engineer-day of prompt/callsite corrections and matrix coverage.

## Batch:

depends-on: none

Code-conflict notes: shares `src/core/session-orchestrator.ts`, its tests and `docs/agent/acp-engine.md` with `reap-orphan-workspace-staging`; may share documentation and registration-context plumbing with `admit-current-omp-bash-artifacts`. No semantic dependency and no authorization changes. Apply sequentially to avoid shared-file conflicts.
