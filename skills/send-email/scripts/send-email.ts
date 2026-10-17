#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

// skills/send-email/scripts/send-email.ts
//
// Compose a NEW email through the Skill API (`email-compose-skill`, row 20).
//
// Contract:
// - All free text (the destination mailbox, the subject and the body) is read from ONE
//   request file staged inside the session staging directory. Nothing free-form is ever
//   passed as a shell argument: the shell would expand `$` in it before the script runs.
// - The lab invocation sets the script's identity from the OWNING session, not from the
//   `--session-id` literal: a value naming another session is refused before any file is
//   read, so a sibling session's staged request can neither be read nor deleted.
// - The payload is the strict JSON object `{ "to", "subject", "body", "attachments"? }`.
//   The server re-validates every field and matches the destination against the session's
//   immutable destination grants; `--grant-id` names the grant the send is authorized by.

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

const REQUEST_FILE_NAME = "compose.json";

const EXAMPLE = `Use the literal skill-script root rendered in your system prompt for the script ` +
  `path below (never a $HOME expression): <skill root rendered in your system prompt>/send-email/scripts/send-email.ts ` +
  `--session-id "<session id rendered in your system prompt>" --grant-id "<grant id from your session context>" ` +
  `--request-file "<absolute staging directory rendered in your system prompt>/${REQUEST_FILE_NAME}"`;

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
      example: EXAMPLE,
    });
    const request = parseRequestBody(requestText ?? "");

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
