# Tasks

## 1. Classify and pin native outcomes at the existing logging boundary

- [x] 1.1 Add a small local metadata decoder or guard in `src/acp/client.ts` for configured OMP failed updates. Verify it recognizes only the pinned synthetic/unexecuted and interrupted/started shapes, rejecting incorrectly typed/conflicting markers and unknown sources.
- [x] 1.2 Emit INFO for `skipped` with execution `not_started` and for `interrupted` with execution `started`. Verify logs retain raw `status: failed` and tool-call ID, adding only bounded classification fields without verbose interruption payloads.
- [x] 1.3 Keep all other failed updates at ERROR with existing diagnostics and classification `failed`. Verify the diff preserves non-failed logging, buffer flushing, activity, configured-agent selection and execution/response state, adding no audit/metric/dispatch/prompt behavior.

- [x] 1.4 Extend `tests/acp/client.test.ts` with sanitized pinned native fixtures for synthetic unexecuted skips and started interruptions. Assert severity, distinct classification/execution, retained raw failure status and absence of new verbose log fields.
- [x] 1.5 Cover malformed/null/array details, string booleans, incomplete and conflicting markers, unknown/assistant-stop sources, text-only lookalikes, service-parameter failures and nonzero command failures. Assert ERROR remains for each non-matching failed update.
- [x] 1.6 Cover OpenCode and absent-agent clients carrying otherwise matching metadata, and preserve completed/in-progress update behavior. Assert the notification is not rewritten as completed and classification does not mark response/verification success or invoke tools.

## 2. Integration acceptance

- [x] 2.1 Run the focused ACP-client tests once after edits and retain existing logger masking/audit/metrics suites as the integration checks. Report synthetic fixture coverage separately from native runtime or public-platform evidence.
