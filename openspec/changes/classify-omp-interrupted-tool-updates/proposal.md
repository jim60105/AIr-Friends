# Proposal

## Why

The ACP client logs every failed tool update at ERROR, including OMP's native interruption results. The supplied export contains three service-parameter failures and seven `interrupt_skipped` updates across two user sessions and summary phases; those counts describe different outcomes.

## What Changes

- Classify native OMP interruption metadata once at the `ChatbotClient.sessionUpdate` logging boundary, using the configured agent type and typed `rawOutput.details` fields.
- Log a genuine synthetic unexecuted skip at INFO with classification `skipped`. Log the distinct started interruption at INFO with classification `interrupted` and execution `started`, preserving possible partial side effects.
- Retain raw ACP `status: failed` for both outcomes. Neither outcome means successful execution or completed verification.
- Keep real command/service failures, incomplete metadata and other-agent failed updates at ERROR. Do not use message-text matching.
- Add focused logging tests without changing dispatch, permissions, audit phases, response state or metrics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `logging-and-error-handling`: OMP-specific tool-update classification with conservative execution semantics.

## Impact

One engineer-day targeting `src/acp/client.ts` and `tests/acp/client.test.ts`, using the existing connector-supplied agent discriminator. No native extension wrapper, schema migration, new telemetry or sensitive payload logging is proposed. This improves operator interpretation; it makes no claim about model behavior.

## Batch:

No prerequisite changes.

Code-conflict notes: No planned shared implementation files with `condition-harness-context-gathering`, `clarify-platform-skill-recipes` or `clarify-delivery-recovery-guidance`. It can be applied independently.
