# Design

## Context

See [proposal.md](proposal.md) and [the delta](specs/skills-and-reply/spec.md). The current reply template and `skills/send-reply/SKILL.md` both say no script error gets a second attempt. That conflicts with instructive pre-API payload errors and with the existing one-turn missing-response retry. The trace does not prove that this wording caused repeated checking.

Read-only inspection established these available delivery surfaces.

| Surface | Observed contract | Limit |
| --- | --- | --- |
| `skills/send-reply/scripts/send-reply.ts` and `skills/lib/client.ts` | Print successful or failed API JSON to stdout; local payload exceptions emit structured JSON to stderr before calling the API | Nonzero exit alone does not establish where failure occurred |
| `src/skills/reply-handler.ts` | Success returns a message ID; failure returns an error | Generic platform failure can follow a remotely committed send with a lost response |
| `src/skill-api/server.ts` | Marks reply before execution, unmarks on failure, increments reply count on success | Internal false state is not evidence that the remote platform received nothing |
| `ReplyHandler.handleGetMessage` | Explicit message ID, else session last text ID, else last file ID | No ID produces an error; a missing message or failed fetch is not authoritative negative delivery evidence |
| `FileHandler` and Misskey chat adapter | Partial batch failure returns delivered IDs and positive `filesCount` | The failed remaining send can itself have an ambiguous remote outcome |
| Skill API file tracking | A positive delivered count retains the reserved slot, marks `fileSent` and records the last delivered file ID | Full preflight failure frees the slot; absence of IDs after transport failure is still ambiguous |

Both current platform reply adapters truncate long text and make a single text delivery call; this proposal does not invent multi-chunk reply state. Misskey chat file delivery does send one message per file and can partially complete. The Skill API exposes POST skill invocations, with no agent-facing delivery-status endpoint. Internal registry methods and audit logs are not new agent APIs.

## Goals / Non-Goals

Revise instructions only, including the existing retry-message builder text. Keep one successful reply, one file-send slot, existing doom-loop gates, one missing-response corrective turn and current edit scope. Do not add retries, idempotency keys, delivery-state machinery, public APIs, privileged log access, model switching or telemetry.

## Decisions

### Put the shared decision in send-reply's skill document

Replace its irreversible-error warning with a short outcome table. Confirmed success means no resend and immediate exit. Confirmed pre-delivery rejection means correct the reported issue and retry within current limits. Uncertain delivery means inspect available authoritative evidence before considering another send; unresolved uncertainty means no automatic resend.

Local payload errors are the primary confirmed pre-delivery cases because the scripts reject them before `callSkillApi`. Explicit preflight validation errors are also pre-delivery. Generic adapter errors, interrupted commands, timeouts and missing stdout are insufficient. A successful response needs no extra readback.

The reply template retains a brief instruction to follow the skill's delivery-outcome policy. Delete its blanket “No second attempt” warning and the remaining irreversible-send phrase in its review bullet. Retain the final-reply ordering and immediate-exit rule for confirmed success. The existing edit-reply instruction remains a separate supported correction path within the session's current text ID and edit quota; it does not authorize tools after an ordinary successful final response. Do not duplicate the decision table in prompts or generic shell guidance.

### Explain lookup limits instead of promising a status service

`get-message` can inspect a known ID or the server's recorded last-text/last-file fallback. If a script's HTTP response is lost after the server recorded success, fallback can recover the recorded message. If the adapter lost the remote response before recording an ID, fallback cannot discover that unknown message. A file fallback also cannot confirm that a separate text reply succeeded.

Describe those distinctions in the owning skill guidance. Prohibit interpreting a missing ID, unsuccessful fetch, unmarked reply flag or log severity as a safe negative acknowledgement. If available evidence cannot settle an ambiguous send, stop attempts. This accepts a possible missing response rather than risking duplicate delivery. Leave get-message and fetch-context behavior unchanged.

### Align the existing corrective prompt without changing its gate

`getRetryPromptStrategy` already reads trusted send-reply, react-message and send-file documents for both agent types, in both spawn shapes, and returns `maxRetries: 1`. Keep that flow. Qualify the preamble as “no recorded response,” preserve its payload-failure checklist and literal recipe, and refer to the included skill recovery policy rather than instructing unconditional resend after any error.

The existing `Retry on Missing Reply` spec says “without having called” while its later clauses and implementation use recorded responses, including partial file delivery. The delta reconciles that wording and preserves all existing scenarios, with outcome qualifications and an ambiguity scenario. The change does not promise exactly-once delivery or repair the runtime's inability to observe an unacknowledged remote send. It changes what the agent is instructed to do when the already-existing retry turn is offered.

### Keep file-specific partial results in send-file's owner

Extend its Result section to say positive delivered counts/IDs consume the one file slot even when `success` is false. Do not resend the whole batch or the remainder. An allowed pending text reply uses its separate quota and existing last-file anchor. Keep this rule local rather than copying the shared outcome table into every skill document.

### Reuse existing regression suites

Extend `tests/acp/agent-factory.test.ts` to check the delivered corrective text for both agent types, trusted document inclusion and one retry. Extend the existing skill-document gate and prompt-rendering tests for policy ownership and successful-send exit. Use existing real handler/Skill API fixtures to pin pre-API rejection, a recorded successful reply, ambiguous failure with no ID, get-message fallback roles, and partial file delivery without a second batch. Inspect existing quota/doom-loop tests as unchanged safeguards. Mocked platform outcomes are labeled as such; runtime behavior is not inferred from prompt prose.

## Risks / Trade-offs

The runtime cannot settle every platform ambiguity. Conservative instructions can leave a session without an additional response, which is accepted here. Existing mounted prompts may retain obsolete warnings and are outside the bundled-default change. The follow-on change depends on the gathering and recipe changes because they edit the same instruction owners; no compatibility layer or migration is needed for this pre-release project.
