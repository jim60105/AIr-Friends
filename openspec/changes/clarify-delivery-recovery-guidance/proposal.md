# Proposal

## Why

The reply template and send-reply skill claim that every script failure is irreversible, although local payload errors occur before delivery and the harness already supplies one missing-response retry. Recovery guidance must distinguish confirmed delivery from pre-delivery rejection and transport ambiguity to avoid duplicate output.

## What Changes

- Make send-reply's skill instructions the canonical owner of outcome-dependent recovery guidance and replace the reply template's blanket warning with a short reference.
- Permit correction after a confirmed pre-delivery error within existing quotas. After confirmed success, stop without resending; preserve the separate scoped edit-reply correction workflow.
- For uncertain delivery, consult existing results and `get-message` when a usable session message ID exists. An absent ID or unsuccessful lookup does not prove non-delivery; unresolved ambiguity forbids an automatic resend.
- Align the existing missing-response retry preamble with this policy, retaining one corrective turn, trusted skill documents and literal root/session/staging recipes.
- Preserve partial file delivery as a consumed file-send slot and session response, including when the result reports an error.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skills-and-reply`: Delivery-outcome guidance and a safely qualified missing-response retry prompt.

## Impact

One engineer-day of documentation, retry-prompt text and focused regression tests. Owners are `skills/send-reply/SKILL.md`, the partial-result guidance in `skills/send-file/SKILL.md`, `prompts/system_reply.md` and `src/acp/agent-factory.ts`. No delivery API, quota, deduplication, adapter, automatic retry count or session-state implementation changes are proposed. A causal link between irreversible wording and repeated checking remains a hypothesis.

## Batch:

depends-on: condition-harness-context-gathering
depends-on: clarify-platform-skill-recipes

Code-conflict notes: Serialize after both prerequisites. The gathering change also edits `prompts/system_reply.md` and rendered-prompt tests. The recipe change touches send-reply/send-file instructions and documentation tests. `classify-omp-interrupted-tool-updates` has no planned code conflict with this change.
