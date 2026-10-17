# Tasks

Total estimate: **1.5 engineering hours**, strictly below 8 hours. This is a specification-artifact
repair under an explicit user request: no application code, prompt, skill script, configuration,
container or documentation file is modified, so every task is an artifact task.

## 1. Split the three capability deltas

- [x] 1.1 (0.2h) `prompt-template-system`: reduce `Available Template Variables` to one behavior
  (catalog) and add requirements for each removed behavior (payload-staging variable pair, literal
  staging values).
- [x] 1.2 (0.2h) `shared-acp-process-pool`: reduce `Session Resumption After Process Death` and
  `Shared Process Environment Scoping` to one behavior each and add requirements for each removed
  behavior (recorded-context recovery, post-load restoration, failure isolation; environment
  path/JWT/identity scoping, permission-gate confinement).
- [x] 1.3 (0.2h) `skills-and-reply`: reduce `Retry on Missing Reply`, `Instructive Skill Error
  Messages`, `Payload-File Argument Passing` and `Agent-Portable Staging And Session Identity` to
  one behavior each and add requirements for each removed behavior.

## 2. Verification

- [x] 2.1 (0.4h) Run the harness for all three deltas and confirm: MODIFIED scenario sets and
  bodies byte-identical to the main spec, no added/renamed scenario under MODIFIED, every MODIFIED
  and ADDED description ≤500 characters with `SHALL`, and no identifier token from the seven
  replaced descriptions missing from its delta.
- [x] 2.2 (0.2h) `openspec validate split-overlong-requirement-descriptions --strict` passes.
- [x] 2.3 (0.2h) `openspec archive split-overlong-requirement-descriptions --yes` then
  `openspec validate --all --strict` reports 72 passed and 0 failed (previously 69 passed,
  3 failed).

Implementation checking policy: artifact-only change — run only the OpenSpec validate/archive gate
above and the harness, with no application code, Deno test or formatter run, since no code file is
modified.
