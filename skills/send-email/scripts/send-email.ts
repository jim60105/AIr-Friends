#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

// skills/send-email/scripts/send-email.ts
//
// Compose a NEW email (`email-compose-skill`, row 20) or forward a designated stored message
// (`email-forward-skill`, row 21) through the Skill API.
//
// Contract:
// - All free text (the destination mailbox, the subject and the body) is read from ONE
//   request file staged inside the session staging directory. Nothing free-form is ever
//   passed as a shell argument: the shell would expand `$` in it before the script runs.
// - The lab invocation sets the script's identity from the OWNING session, not from the
//   `--session-id` literal: a value naming another session is refused before any file is
//   read, so a sibling session's staged request can neither be read nor deleted.
// - The payload is the strict JSON object `{ "to", "subject", "body", "attachments"? }` for a
//   compose, extended with `{ "action": "forward", "sourceRecordId": "<stored source id>" }`
//   for a forward. The server re-validates every field and matches the destination (and, for
//   a forward, the designated source) against the session's immutable destination grants;
//   `--grant-id` names the grant the send is authorized by.
// - The forward shape is validated here TOO, before any API call: an unknown action or a
//   forward without a designated source record is a local, instructive failure, exactly like a
//   malformed request file. The request object itself is still forwarded verbatim — the request
//   file stays the ONLY carrier of free text.

import {
  callSkillApi,
  exitWithError,
  outputResult,
  parseBaseArgs,
  resolveOwningSessionId,
  SkillSessionUnresolvedError,
} from "../../lib/client.ts";
import { EMAIL_COMPOSE_FREE_TEXT_FLAGS, PayloadError, readPayloadArg } from "../../lib/payload.ts";
import { parse } from "jsr:@std/flags@^0.224.0";

/** Stable code for a payload read under an identity that is not this invocation's owner. */
const SKILL_SESSION_MISMATCH = "SKILL_SESSION_MISMATCH";

/** Stable code for a request file that is not the expected JSON object. */
const SKILL_COMPOSE_REQUEST_INVALID = "SKILL_COMPOSE_REQUEST_INVALID";

/** Stable code for a request file that asks for the forward operation without a source. */
const SKILL_FORWARD_REQUEST_INVALID = "SKILL_FORWARD_REQUEST_INVALID";

const REQUEST_FILE_NAME = "compose.json";

const EXAMPLE = `Use the literal skill-script root rendered in your system prompt for the script ` +
  `path below (never a $HOME expression): <skill root rendered in your system prompt>/send-email/scripts/send-email.ts ` +
  `--session-id "<session id rendered in your system prompt>" --grant-id "<grant id from your session context>" ` +
  `--request-file "<absolute staging directory rendered in your system prompt>/${REQUEST_FILE_NAME}"`;

const FORWARD_EXAMPLE = `{"action":"forward","sourceRecordId":"<source record id rendered in ` +
  `your grant>","to":"someone@example.org","subject":"Fwd: Subject","body":"See below.",` +
  `"attachments":["<absolute staging directory rendered in your system prompt>/notes.pdf"]}`;

/** Read the JSON object of the request file, or fail with an instructive typed error. */
function parseRequestBody(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PayloadError(
      SKILL_COMPOSE_REQUEST_INVALID,
      `The request file ${REQUEST_FILE_NAME} is not valid JSON. It must contain exactly one JSON ` +
        `object like {"to":"someone@example.org","subject":"Subject","body":"Body text",` +
        `"attachments":["<absolute staging directory rendered in your system prompt>/report.pdf"]} ` +
        `(attachments are optional and must be staged inside the session staging directory). ` +
        `Write the file again with your edit/write tool and invoke the skill once more.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PayloadError(
      SKILL_COMPOSE_REQUEST_INVALID,
      `The request file ${REQUEST_FILE_NAME} must contain exactly one JSON OBJECT with the ` +
        `compose fields to, subject, body and optional attachments — an array, string or number ` +
        `is not a compose request. Nothing was sent.`,
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reject a request that names an unsupported operation, or the forward operation without the
 * stored source record it must designate, BEFORE the Skill API call.
 *
 * `sourceRecordId` is an opaque host identifier the user's own current message already selected:
 * it is never derived from the staged paths, from a wire Message-ID or from a command-line value,
 * and the server still binds it to the session's immutable grant.
 */
function assertRequestOperation(request: Record<string, unknown>): void {
  const action = request.action;
  if (action === undefined) return;
  if (action !== "forward") {
    throw new PayloadError(
      SKILL_FORWARD_REQUEST_INVALID,
      `The request file ${REQUEST_FILE_NAME} names an unsupported "action". The only operation ` +
        `beyond composing a new message is "forward". Nothing was sent.`,
    );
  }
  const sourceRecordId = request.sourceRecordId;
  if (typeof sourceRecordId !== "string" || sourceRecordId.trim() === "") {
    throw new PayloadError(
      SKILL_FORWARD_REQUEST_INVALID,
      `The request file ${REQUEST_FILE_NAME} asks to forward without a "sourceRecordId". A ` +
        `forward must designate the stored message it quotes, as the host published that ` +
        `record in this session's grant, for example: ${FORWARD_EXAMPLE}. Nothing was sent.`,
    );
  }
}

async function main() {
  try {
    const { sessionId, apiUrl } = parseBaseArgs(Deno.args);

    // The invocation's identity is the OWNING session (resolved from the process'
    // authoritative source), never the CLI literal: a mismatched literal must not be able
    // to point the payload containment boundary at another session's staging directory.
    const owningSessionId = resolveOwningSessionId();
    if (sessionId !== owningSessionId) {
      throw new PayloadError(
        SKILL_SESSION_MISMATCH,
        `The --session-id value does not belong to this invocation. Pass the literal session id ` +
          `rendered in your system prompt; a session may only read and send its own staged ` +
          `request. Nothing was read and nothing was sent. Example: ${EXAMPLE}`,
      );
    }

    const requestText = await readPayloadArg(Deno.args, "request", {
      sessionId: owningSessionId,
      alias: "r",
      fileName: REQUEST_FILE_NAME,
      extraFreeTextFlags: EMAIL_COMPOSE_FREE_TEXT_FLAGS,
      // The owning session was already resolved above: the staging pointer must agree with it,
      // so a pointer that moved to another session fails closed instead of reading (and deleting)
      // a sibling session's staged request.
      requireSessionMatch: true,
      example: EXAMPLE,
    });
    const request = parseRequestBody(requestText ?? "");
    assertRequestOperation(request);

    const parsedArgs = parse(Deno.args, {
      string: ["grant-id"],
      alias: { g: "grant-id" },
    });
    const grantId = parsedArgs["grant-id"];

    const result = await callSkillApi(apiUrl, "send-email", owningSessionId, {
      ...(grantId ? { grantId } : {}),
      request,
    });

    outputResult(result);

    if (!result.success) {
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof PayloadError) {
      exitWithError(error.message, error.code);
    } else {
      exitWithError(
        error instanceof Error ? error.message : String(error),
        error instanceof SkillSessionUnresolvedError ? error.code : undefined,
      );
    }
  }
}

main();
