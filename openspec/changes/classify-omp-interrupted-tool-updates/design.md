# Design

## Context

See [proposal.md](proposal.md) and [the delta](specs/logging-and-error-handling/spec.md). `src/acp/client.ts:1265-1292` logs every failed tool update at ERROR and serializes the full failed update. The connector supplies the authoritative `agentType` after spreading client configuration, so request payloads cannot select the decoder.

The container pins OMP 18.6.1. The inspected pinned [agent-loop.ts source][native-loop] defines two distinct interruption shapes. `SyntheticToolResultDetails` uses `__synthetic: true`, `source: "interrupt_skipped"`, `executed: false` for a locally uninvoked tool. `InterruptedToolResultDetails` uses `__interrupted: true`, the same source, and `execution: "started"` for a tool that entered execution and may have done partial work. The inspected [ACP event mapper][native-mapper] maps error results to raw status `failed` while forwarding the result as `rawOutput`.

The supplied export contains 332 parsed entries covering two user sessions and summary phases. Its ERROR entries include three service-mode parameter failures and seven interruption-source results. The observed started markers prohibit interpreting all seven as unexecuted calls. Both the problematic command and image workflows were YOLO. None of this evidence establishes a model-quality cause or proves logging severity affects model behavior.

## Goals / Non-Goals

Provide an operator-visible distinction at one logging owner without altering native dispatch or consumer state. No permission wrapper, extension registration, tool alias, retry, metric, audit phase, dependency or sensitive logging expansion is in scope. The existing agent shell fragment is unchanged.

## Decisions

### Decode a small allowlisted metadata union

Add a private local decoder or inline type guard in `client.ts`; keep the only use in the failed-update logging branch. Read `rawOutput` and `details` only as non-null non-array records, and compare marker types strictly. Do not parse nested JSON strings or inspect rendered error prose.

| Configured agent | Raw status and details | Classification | Execution | Severity |
| --- | --- | --- | --- | --- |
| OMP | `failed`, source `interrupt_skipped`, synthetic true, executed false, no contradictory started marker | `skipped` | `not_started` | INFO |
| OMP | `failed`, source `interrupt_skipped`, interrupted true, execution started, no contradictory synthetic marker | `interrupted` | `started` | INFO |
| Any | Any other failed shape, including mixed markers or unknown agent | `failed` | No inferred state | ERROR |

The decoder rejects mixed or contradictory metadata instead of taking a favorable marker first. Native optional fields unrelated to the discriminator need not be rejected. Synthetic `assistant_stop_*` results remain on the existing ERROR path, outside this change's interruption scope. Started interruptions use INFO because the recognized native event is control flow, while their distinct classification explicitly retains possible partial execution. Never label them `skipped` or `completed`.

Choosing only the source string would misstate started calls. Downgrading all failed OMP updates or all interruption-looking prose would hide real errors. Rewriting ACP status to completed would falsely report work, so the raw status stays `failed`.

### Classify before collecting verbose failure diagnostics

For recognized outcomes, emit the existing call ID and raw status plus bounded `classification` and `execution` fields. Use an explicit interruption/skip message rather than the generic failure message. Do not attach raw output, command content, new full-update serialization or secret-bearing fields to this INFO path. For the remaining failures, keep the existing ERROR diagnostics and add classification `failed` without expanding their payload.

Thought/message buffer flushing and activity updates remain before the logging decision. Non-failed status updates remain unchanged. Use the existing logger masking and GELF conversion; no alternate sink or schema is introduced.

### Preserve audit and response contracts

The current audit contract records skills and completed thought/message phases, with session-end response flags. Metrics count Skill API outcomes and actual delivered files/replies. This tool-log classification creates no new audit event or metric label, increments no success counter, and cannot satisfy a response or verification gate. Logging does not re-execute interrupted tools. Any side-effect-sensitive retry remains the caller's concern under existing contracts.

### Pin tests to native shapes without running a live model

Extend `tests/acp/client.test.ts` using its existing captured logger pattern. Cover both exact native shapes, including the observed started case; malformed/null/array details; string booleans; missing markers; contradictory markers; another `assistant_stop_*` source; human-text-only lookalikes; true service parameter failures; nonzero command failures; and OpenCode/absent-agent scoping. Assert severity, raw status, call ID, classification/execution and lack of new verbose fields. Retain ordinary failed/completed tests. Fixtures are sanitized metadata examples tied to the pinned source, not copies of user messages or credentials.

## Risks / Trade-offs

Upstream may change the native shape. Unknown shapes remain ERROR until reviewed against the pinned contract, so failures are visible. INFO filtering may hide interruption entries when the operator selects WARN, consistent with the existing log-level contract. Started interruptions can have side effects; the explicit `interrupted`/`started` output and unchanged raw failure status prevent a no-execution claim. This change does not attempt broader remediation of pre-existing fullUpdate logging.

[native-loop]: https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/agent/src/agent-loop.ts
[native-mapper]: https://github.com/can1357/oh-my-pi/blob/v18.6.1/packages/coding-agent/src/modes/acp/acp-event-mapper.ts
