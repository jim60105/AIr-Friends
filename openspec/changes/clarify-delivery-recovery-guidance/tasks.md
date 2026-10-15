# Tasks

## 1. Revise and pin delivery guidance after both prerequisites

- [ ] 1.1 Replace send-reply's blanket irreversible-error warning with the canonical outcome-dependent recovery table. Verify stable pre-API errors, success exit, quota preservation and ambiguity are covered, with no contradictory failure/finality wording left in that skill.
- [ ] 1.2 Replace `prompts/system_reply.md`'s “No second attempt” and irreversible-send wording with a short policy reference. Verify the exit/edit bullets consistently permit only the active-session known-error correction exception, with necessary payload write and scoped edit followed by exit, while preserving side-effects-before-final ordering.
- [ ] 1.3 Extend send-file's Result instructions for positive delivered counts/IDs on failure. Verify the text prohibits retrying the batch or remainder, retains the consumed file slot, and preserves the pending text reply's separate quota and last-file anchor.
- [ ] 1.4 Document existing `get-message` explicit-ID and text-then-file fallback limits in the recovery owner. Verify the guidance states that absent IDs, failed lookups, file fallbacks and internal rollbacks cannot establish non-delivery of an ambiguous text send, and promises no new API or hidden-state access.

- [ ] 1.5 Qualify `buildDefaultRetryMessage` in `src/acp/agent-factory.ts` as “no recorded response.” Verify generated text retains the payload checklist/literal recipe and defers to included trusted skill guidance without treating generic errors as safe resend evidence.
- [ ] 1.6 Extend existing skill-document, rendered-prompt and agent-factory tests to assert policy ownership, pre-delivery correction, ordinary success exit, the narrow known-error correction exception, one corrective turn and uncertain-result no-resend guidance for both agent types and spawn shapes. Assert no proactive readback, unrelated tools or new correction turn are authorized after success.
- [ ] 1.7 Reuse real handler/Skill API fixtures to assert preflight failure with an unused slot, recorded successful reply, ambiguous platform failure with no ID, get-message explicit/fallback role limits, and partial Misskey chat file results retaining the file slot/response state and last delivered anchor. Add focused assertions only where existing coverage is absent.

## 2. Integration acceptance

- [ ] 2.1 Run the focused instruction, retry-builder and affected handler/Skill API suites once after edits. Confirm trusted loading, reply/file quotas, edit scoping, `maxRetries: 1` and no-retry-after-recorded-response behavior remain unchanged; report mocked evidence without claiming exactly-once delivery.
