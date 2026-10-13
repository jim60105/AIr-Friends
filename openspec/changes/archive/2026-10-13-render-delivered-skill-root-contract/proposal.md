# Proposal

## Why

Callers pass the resolved trusted skills root, but most final bundled prompts omit it, leaving skill instructions unusable in isolated OMP HOME. Summary and retry executable recipes also split valid roots containing spaces.

## What Changes

- Render the literal trusted absolute root in every skill-instructing delivered system prompt and correction/retry instruction for both agents.
- Quote full executable paths and payload-file arguments in recipes using the existing resolved root; preserve literal session-id/staging and pointer-only content flow.
- Reject missing, empty or non-absolute required root values before delivery, including operator-mounted skill-instructing templates.
- Extend actual bundled-template/rendered-delivery tests across normal, spontaneous, lurk, research, summary, user/channel maintenance, reminders and retry; preserve dashboard chat's prohibition on skills.
- Update prompt/skill usage documentation and CHANGELOG without another resolver or runtime field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prompt-template-system`: delivered literal root, executable quoting and explicit missing-root failures.

## Impact

Owns bundled skill-instructing templates/fragments, their renderer/delivery boundaries in context assembly and orchestrator, the retry builder in agent-factory, and `tests/core/prompt-staging-literals.test.ts` plus focused delivery fixtures. Existing selected-agent root resolution, JWT files, filesystem grants and payload containment remain unchanged. Budget is 5.5h including implementation, focused mock verification and docs.

## Batch:

code-conflicts: thread-per-spawn-omp-recovery-context (session-orchestrator callers); apply this writer first, recovery writer second.
code-conflicts: synchronize-omp-seam-correction-docs (prompt/skill documentation and CHANGELOG); final consolidation last.
code-conflicts: admit-trusted-omp-native-builtins, bind-omp-owned-module-evidence (append-only CHANGELOG ownership); serialize history commits without adding a behavioral dependency.

No native admission or module-identity behavioral dependency exists. Prompt rendering and recovery are independently testable; their orchestrator edits are serialized.
