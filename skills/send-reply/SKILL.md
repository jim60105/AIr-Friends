---
name: send-reply
description: Send the final reply message to the user on the platform. This is the ONLY way to communicate with the user externally. If you don't use this skill, the user won't see your response.
allowed-tools: Bash
---

# Send Reply Skill

Send your final response to the user. This is the gateway to external communication.

## Critical Rules

1. **One reply only**: You MUST deliver exactly ONE reply per session. The limit counts SUCCESSFUL sends: an invocation the script rejected before the platform was reached (the `SKILL_*` codes below) does not consume it, so correct the reported cause and invoke the skill again. After a successful send, another `send-reply` is rejected — the only permitted follow-up is the scoped `edit-reply` correction under Delivery Recovery.
2. **This is the ONLY external output**: All other processing remains internal.
3. **Timeout**: The script won't run for more than 30 seconds. If it hangs, cancel the running command with the running-command controls your agent documents (if any). A stopped send may still have reached the platform.
4. **Recover by outcome**: Classify the result against the Delivery Recovery table below before you act. A confirmed success ends the turn, a failure that never reached the platform can be corrected, and a send you cannot confirm must not be repeated.
5. **Think before you send**: Review your message for clarity, tone, and content before you invoke this skill. Sending again is not a recovery option for a send that may already have arrived.
6. **Exit directly after a confirmed success**: After a `send-reply` result that confirms delivery, exit immediately. Do not summarize, continue processing, or attempt another send — the single exception is the scoped correction under Delivery Recovery.
7. **Threading**: The reply is threaded to the message the file tool (`send-file`) most recently delivered, when one exists in this session; otherwise it is threaded to the user's trigger message.

## Delivery Recovery

The script prints its result as JSON on stdout and exits non-zero on failure. Classify that result before you act: repeating a send whose outcome is uncertain duplicates the reply, and abandoning a failure that never reached the platform loses it.

| Outcome | How you know | What to do |
| ------- | ------------ | ---------- |
| **Confirmed success** | `success: true` — the result carries the delivered `messageId`. The reply IS delivered. | Exit. Do not resend, do not read the message back, do not start unrelated work. The single exception is the known-error correction below. |
| **Confirmed pre-delivery failure** | The script rejected the invocation BEFORE the Skill API was called and printed a structured `SKILL_*` code on stderr: `SKILL_LEGACY_FLAG`, `SKILL_MISSING_PAYLOAD`, `SKILL_PAYLOAD_OUT_OF_BOUNDS`, `SKILL_PAYLOAD_NOT_FOUND`. Nothing reached the platform and the one-reply limit is untouched. | Correct exactly what the error names — the payload text, its location, or the invocation — then invoke the skill again, inside the existing limits. |
| **Uncertain delivery** | Any other failure: a timeout, a cancellation, a connection loss, or a generic error returned by the platform after the request was dispatched. Whether the platform accepted the reply is unknown. | Treat the reply as possibly delivered. Inspect what you can (see Inspecting an uncertain result), then decide. If the evidence does not settle it, do NOT resend — a missing reply is better than a duplicate one. |
| **Partial or ambiguous file output** | A `send-file` result that reports an error while still reporting delivered IDs, or a positive `filesCount`. | Those files ARE delivered. Never resend the batch or its remainder; the `send-file` document owns that rule. |

### Known-error correction after a confirmed success

If the reply WAS delivered (`success: true`) but you already know of a concrete error in the text you sent — a wrong name, a broken fact, a garbled instruction — and this session is still active, you may correct it once:

1. Write the corrected full text to `<absolute staging directory rendered in your system prompt>/reply.md` with your edit/write tool.
2. Invoke `edit-reply` with the `messageId` that `send-reply` returned, within `edit-reply`'s own edit limit.
3. Exit. No follow-up `send-reply`, no reading the message back, no unrelated work.

That exception is the whole of it: nothing here promises another correction opportunity, and once the session ends you cannot edit or send anything at all. If no concrete error was already known when the success came back, there is no exception to apply — an acknowledged success is a finished job.

### Inspecting an uncertain result

There is no delivery-status API, no hidden session state to query, and no idempotency guarantee. Your evidence is the result you already hold plus the `get-message` skill, which fetches exactly ONE message:

- the `messageId` you pass explicitly, otherwise
- the session's last successful text reply, otherwise
- the session's last delivered file message.

The fetched message carries no label naming which role it played, so decide from the ID you used and from the content that comes back. A message obtained through the file fallback — any file message — is NEVER confirmation that a text reply was delivered.

None of the following is evidence that your reply did not reach the platform:

- the failed result simply carrying no `messageId`;
- `get-message` failing, or answering "Message not found";
- the session's internal reply flag having been rolled back, or a `send-file` slot being returned.

When the available evidence cannot settle an uncertain send, stop there. Ending the turn without an additional reply is the correct choice when the alternative is a duplicate.

## Usage

**Two-step flow — the message text MUST NOT appear on the command line.**

1. Write your reply text to a payload file under the session staging directory using your **edit/write tool**:

   ```
   <absolute staging directory rendered in your system prompt>/reply.md
   ```

   Use the **absolute staging directory your system prompt renders** verbatim — never build the path from environment variables. The write goes through the ACP filesystem interface, so the text bytes are preserved **verbatim** (no shell expansion), and the script resolves the owning session automatically in every deployment shape.

2. Invoke the script with the payload file path:

> The placeholder `<skill root rendered in your system prompt>` is the absolute skill-script root rendered in your system prompt: substitute that literal root before invoking — never run this command with the placeholder, a `$HOME` expression, or any other root.

   ```bash
   <skill root rendered in your system prompt>/send-reply/scripts/send-reply.ts \
     --session-id "<session id rendered in your system prompt>" \
     --message-file "<absolute staging directory rendered in your system prompt>/reply.md"
   ```

**WARNING**: Never put message content on the command line. The legacy `--message "..."` / `--message=...` flags are REMOVED: the shell expands `$VAR` in them (e.g. `$0` → `/usr/bin/bash`, `$HOME`, `$API_KEY`), which corrupts your message and can leak environment variables to the user.

## Parameters

| Parameter        | Required | Description                                                                                                                                                                                               |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--session-id`   | Yes      | Pass the literal session id rendered in your system prompt — authoritative in every deployment shape; the skill library resolves the owning session automatically and a mismatched value is never honored |
| `--message-file` | Yes      | Path of the payload file containing the reply text (must be under `<absolute staging directory rendered in your system prompt>/`)                                                                         |

## Error Codes

If the script fails, read the JSON error on stderr. It contains the fix. Common codes:

| Code                          | Meaning                                                                                | Fix                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SKILL_LEGACY_FLAG`           | You used the removed `--message` flag                                                  | Put the text in `<absolute staging directory rendered in your system prompt>/reply.md` and use `--message-file` |
| `SKILL_MISSING_PAYLOAD`       | No `--message-file` given                                                              | Write the payload file first, then invoke with `--message-file`                                                 |
| `SKILL_PAYLOAD_OUT_OF_BOUNDS` | Payload path is outside `<absolute staging directory rendered in your system prompt>/` | The script only reads its own session's staging dir — stage the text there                                      |
| `SKILL_PAYLOAD_NOT_FOUND`     | Payload file missing/unreadable                                                        | Write the file FIRST with the edit/write tool, then invoke the script                                           |

## Limits

- Maximum **1 successful reply** per session. After a successful reply, subsequent `send-reply` calls are rejected — an invocation that failed before the platform was reached does not count against this limit.
- After a successful reply, use `edit-reply` (within its own edit limit) for the single scoped correction, then exit.
- Excessive retry attempts will cause the agent process to be terminated.
- Ultrathink carefully and make the text final before you invoke the skill: a send you cannot confirm cannot be repeated, so a duplicate or a half-finished reply cannot be taken back.
