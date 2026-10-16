# Design

## Context

See `proposal.md` for motivation. `prompts/agent_permissions.md` has a `!yolo` block that labels restrictions as OpenCode's for either engine. Its OMP section separately recommends reading stdout instead of redirecting. `prompts/browser_automation.md` is included by reply, spontaneous and self-research templates and unconditionally forbids operators. The self-research corrective builder in `session-orchestrator.ts:402-439` repeats those claims without an engine/mode input.

The deployed OMP native-YOLO settings use `approvalMode: yolo` with `lsp: deny`; restricted OMP uses native approval plus the restricted capability extension and shared ACP command/filesystem checks. `ChatbotClient`'s restricted generic-command gate and operator checks are shared. OpenCode alone also has its authored agent-level command denials. Both engines retain protected callback filesystem policy even when their permission requests are auto-approved.

The current `self-research` completion requirement explicitly requires naming OpenCode-denied commands and restating shell restrictions for every correction. That contract must change alongside the prompt code. `buildDefaultRetryMessage()` in `agent-factory.ts:496-536` recommends edit/write payload creation but makes no universal operator-denial claim, so its delivery recipes remain unchanged.

## Goals / Non-Goals

Make permission statements match the current selected engine and effective mode, including correction prompts. Preserve useful tool-use recipes and the distinction between a recommendation and an enforced denial.

Do not change native YAML, OpenCode permission maps, command parsing, tool admission, filesystem roots, optional template-variable defaults, retry count, research completion detection or delivery uncertainty rules. No promise that every arbitrary YOLO command succeeds is introduced. External skills and operator-mounted prompt overrides are not rewritten.

## Decisions

### D1. Use the already-resolved session mode

Use the existing `agentType` and `yolo` Vento inputs. Pass `{ agentType, yolo }` explicitly into `buildSelfResearchRetryMessage()` from the same local agent selection/effective `yoloDecision.enabled` used for the running connector. Never infer from a model name, process environment, global flag alone or process-pool defaults. No new config flag or permission-profile framework is needed.

For generic template rendering, absent `agentType` retains the current default OpenCode interpretation and absent `yolo` retains restricted wording. This is the existing optional-variable rendering behavior, with no new runtime shim or migration.

### D2. Keep a small, explicit wording matrix

| Engine and mode | Permission wording |
| --- | --- |
| OpenCode restricted | Existing command allowlist and OpenCode pre-gate denials; each chained segment must be allowed; file redirects, pipes/background/newline remain denied; tolerated standard-stream fd redirects remain available. |
| OMP restricted | Shared restricted command/operator/path rules and native capability admission, without claiming OpenCode performs upstream denial. OMP one-shot/service/background parameter instructions remain present. |
| OpenCode YOLO | Omit restricted command/operator-denial paragraphs. Preserve delivery/payload instructions and applicable callback filesystem limits; do not promise unrestricted filesystem access. |
| OMP native-YOLO | Omit restricted command/operator-denial paragraphs. Retain explicit native LSP denial and applicable callback limits; stdout/exit-code reading is a recommendation. Preserve native service/background instructions. |

Within `agent_permissions.md`, separate common restricted guidance from the OpenCode-only denial paragraph. Fix the existing opening claim that restricted mode permits read-only operations, since it already permits staging writes and authorized shared-workspace writes. Keep those exceptions conditional on the existing `canWriteAgentWorkspace` value and configured extension policy; do not promise all shared writes are accepted. In `browser_automation.md`, wrap operator-policy assertions in the restricted-mode condition; the browser close workflow and 403/429 fallback stay available in every mode. Prefer separate browser commands as a recipe without asserting YOLO rejects chains or redirection.

`2>&1` and currently tolerated standard-stream fd redirects must not be described as rejected in restricted wording. `||` itself is supported when all command segments qualify, so the `cat x || echo ...` explanation must attribute denial to `echo` rather than claiming `||` is universally forbidden.

### D3. Keep research correction content and policy boundaries separate

The corrective retry always requires a note under `$AGENT_WORKSPACE/notes/` or `journal/`, the note-index update and existing trusted skill-root delivery. Retain edit/write as the recommended note-writing method in all modes; attach the enforcement claim about shell redirects only in restricted mode. Attach the OpenCode command-denial list only for restricted OpenCode. OMP correction text identifies shared restricted command/path rules without attributing them to OpenCode. Rejections remain bounded diagnostic data through `formatPermissionRejections()`.

Use direct local conditions in the existing builder, matching the project's current code-built retry pattern. Do not move all templates into a new policy engine or duplicate enforcement tables into prompt code. The small matrix is tested against selected consumer outputs. The missing-response builder remains unchanged because its edit/write payload recipe is a stable delivery contract rather than an operator capability claim.

### D4. Cover delivered prompts, not just fragment text

Render all existing entry templates that include either edited fragment for OpenCode/OMP crossed with restricted/YOLO. Cover true/false shared-workspace write authorization where the capability fragment appears. Drive the actual self-research no-note correction path with a mock connector in each mode, asserting the session-selected context reaches the delivered retry and recent rejections remain present.

Preserve the existing note fingerprint, exactly-one-retry, final audit/metric, literal skills-root/staging, no-platform-reply and delivery recovery assertions. User-supplied overrides retain operator ownership; document that they need equivalent wording changes if they copied the obsolete text.

## Risks / Trade-offs

Prompt wording can drift from enforcement. Small positive/negative engine-mode assertions in delivered prompt tests make the affected claims visible without snapshots of entire personality prompts. Native command execution remains upstream-owned, so rendered text alone is never evidence of a successful command.

Mounted overrides may preserve old claims after the bundled fix. Engine documentation will identify the affected fragments and the operator responsibility without attempting to rewrite mounts.

## Deployment

Ship the updated bundled templates and retry builder together. No stored-state migration or compatibility layer is needed. Reverting the prompt/callsite commit restores the prior wording without changing persisted data or authorization policy.
