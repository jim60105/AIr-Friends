/**
 * tests/platforms/email/outgoing-mime.test.ts
 *
 * Tests for outgoing RFC 5322 MIME construction and the central literal
 * signature (email-mime-signature).
 *
 * Tests:
 * 1. Central signature: applied once with the standard `-- ` separator; blank and
 *    whitespace-only signatures add nothing; multiline literal content is
 *    preserved; model-written signature-like tails are never removed.
 * 2. Golden `.eml` fixtures for plain reply, blank signature, multipart binary
 *    attachment, RFC 2047 Subject and References/In-Reply-To/Message-ID chain.
 * 3. Forward ordering: commentary, signature, then labeled original section;
 *    original body text and attachment bytes preserved.
 * 4. Header injection rejection before any bytes are produced.
 * 5. Determinism, digest/size accounting and pure CRLF wire bytes.
 * 6. Round-trip through the predecessor `parseIncomingMime` parser.
 */

import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { createHash } from "node:crypto";
import {
  applyOutgoingSignature,
  buildForwardSection,
  type ConstructedOutgoingEmail,
  type EmailDraft,
  FORWARD_SECTION_MARKER,
  OutgoingMimeBuilder,
  OutgoingMimeDiagnosticCode,
  OutgoingMimeError,
  SIGNATURE_SEPARATOR,
} from "../../../src/platforms/email/outgoing-mime.ts";
import { parseIncomingMime } from "../../../src/platforms/email/incoming-mime.ts";

const OWNER = "e_" + "1".repeat(64);
const FIXED_DATE = new Date("2026-10-17T00:00:00Z");
const MULTILINE_SIGNATURE = "AIr-Friends Bot\n${NOT_EXPANDED} literal";

function builder(): OutgoingMimeBuilder {
  return new OutgoingMimeBuilder({
    fromAddress: "bot@example.com",
    now: () => new Date(FIXED_DATE.getTime()),
  });
}

function draft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    owner: OWNER,
    operationKey: { workId: "w1", actionSlot: "reply" },
    targetKind: "user",
    to: "user@example.com",
    subject: "Re: progress",
    authoredBody: "Thanks, I will review.",
    ...overrides,
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertChain(result: ConstructedOutgoingEmail): void {
  assertEquals(result.messageId, `<${result.messageId.slice(1, 33)}@example.com>`);
  assertEquals(result.envelope, { from: "bot@example.com", to: [result.to] });
  assertEquals(result.sizeBytes, result.emlBytes.byteLength);
  assertEquals(result.digest, sha256Hex(result.emlBytes));
}

Deno.test("applyOutgoingSignature: blank and whitespace-only signatures add nothing", () => {
  assertEquals(applyOutgoingSignature("Body", ""), "Body");
  assertEquals(applyOutgoingSignature("Body", "   \n\t "), "Body");
  assertEquals(applyOutgoingSignature("Body\r\nMore", "  "), "Body\nMore");
});

Deno.test("applyOutgoingSignature: literal multiline signature keeps line structure once", () => {
  assertEquals(
    applyOutgoingSignature("Thanks, I will review.", MULTILINE_SIGNATURE),
    `Thanks, I will review.\n${SIGNATURE_SEPARATOR}\n${MULTILINE_SIGNATURE}`,
  );
  // Empty authored body still carries the standard separator.
  assertEquals(
    applyOutgoingSignature("", MULTILINE_SIGNATURE),
    `${SIGNATURE_SEPARATOR}\n${MULTILINE_SIGNATURE}`,
  );
  // Literal line structure is preserved, including a trailing blank line.
  assertEquals(
    applyOutgoingSignature("Body", "Sig\n\n"),
    `Body\n${SIGNATURE_SEPARATOR}\nSig\n\n`,
  );
});

Deno.test("construct: golden plain reply fixture with chain, Auto-Submitted and signature", async () => {
  const result = await builder().construct(
    draft({
      thread: { wireMessageId: "<parent@relay.example>", references: ["<root@relay.example>"] },
    }),
    MULTILINE_SIGNATURE,
  );

  const golden = `Auto-Submitted: auto-generated
From: bot@example.com
To: user@example.com
In-Reply-To: <parent@relay.example>
References: <root@relay.example> <parent@relay.example>
Subject: Re: progress
Message-ID: <47cce36946d8fa0a9485a3e12f59d720@example.com>
Date: Sat, 17 Oct 2026 00:00:00 +0000
Content-Transfer-Encoding: 7bit
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Thanks, I will review.
-- 
AIr-Friends Bot
\${NOT_EXPANDED} literal
`;

  assertEquals(decode(result.emlBytes), golden.replace(/\n/g, "\r\n"));
  assertEquals(
    result.historyBody,
    "Thanks, I will review.\n-- \nAIr-Friends Bot\n${NOT_EXPANDED} literal",
  );
  assertEquals(result.messageId, "<47cce36946d8fa0a9485a3e12f59d720@example.com>");
  assertEquals(result.wireIds, {
    inReplyTo: "<parent@relay.example>",
    references: ["<root@relay.example>", "<parent@relay.example>"],
  });
  assertChain(result);
});

Deno.test("construct: blank signature adds no separator at all", async () => {
  const result = await builder().construct(
    draft({
      thread: { wireMessageId: "<parent@relay.example>", references: ["<root@relay.example>"] },
    }),
    "   ",
  );

  const text = decode(result.emlBytes);
  assertEquals(text.includes(SIGNATURE_SEPARATOR), false);
  assertEquals(text.includes("\r\n-- \r\n"), false);
  assertEquals(result.historyBody, "Thanks, I will review.");
  // No text is ever dropped, only the signature is omitted.
  assertMatch(text, /\r\n\r\nThanks, I will review\.\r\n$/);
  assertChain(result);
});

Deno.test("construct: model-written signature-like tail is preserved without de-duplication", async () => {
  const authored = "Here you go.\n-- \nModel Invented Tail";
  const result = await builder().construct(draft({ authoredBody: authored }), "Real Signature");

  assertEquals(
    result.historyBody,
    `Here you go.\n-- \nModel Invented Tail\n-- \nReal Signature`,
  );
  const occurrences = result.historyBody.split("Real Signature").length - 1;
  assertEquals(occurrences, 1);
});

Deno.test("construct: golden multipart binary attachment with encoded Subject", async () => {
  const binary = new Uint8Array([0x00, 0x01, 0x02, 0xfe, 0xff, 0x0a, 0x0d]);
  const result = await builder().construct(
    draft({
      operationKey: { workId: "w2", actionSlot: "files" },
      subject: "報告: quarterly 資料",
      authoredBody: "See attached.",
      attachments: [{
        filename: "report.bin",
        contentType: "application/octet-stream",
        content: binary,
      }],
    }),
    "",
  );

  const golden = `Auto-Submitted: auto-generated
From: bot@example.com
To: user@example.com
Subject: =?UTF-8?Q?=E5=A0=B1=E5=91=8A=3A_quarterly_?=
 =?UTF-8?Q?=E8=B3=87=E6=96=99?=
Message-ID: <fd582b78e22c7121dd422ee9cb29f100@example.com>
Date: Sat, 17 Oct 2026 00:00:00 +0000
MIME-Version: 1.0
Content-Type: multipart/mixed;
 boundary="--_NmP-affd582b78e22c7121dd422ee9cb29f100-Part_1"

----_NmP-affd582b78e22c7121dd422ee9cb29f100-Part_1
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 7bit

See attached.
----_NmP-affd582b78e22c7121dd422ee9cb29f100-Part_1
Content-Type: application/octet-stream; name=report.bin
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename=report.bin

AAEC/v8KDQ==
----_NmP-affd582b78e22c7121dd422ee9cb29f100-Part_1--
`;

  assertEquals(decode(result.emlBytes), golden.replace(/\n/g, "\r\n"));

  // Predecessor parser decodes the encoded Subject and the exact attachment bytes.
  const parsed = await parseIncomingMime(result.emlBytes);
  assertEquals(parsed.subject, "報告: quarterly 資料");
  assertEquals(parsed.attachments.length, 1);
  assertEquals(parsed.attachments[0].mimeType, "application/octet-stream");
  assertEquals(parsed.attachments[0].content, binary);
  assertEquals(parsed.wireIds.messageId, result.messageId);
  assertChain(result);
});

Deno.test("construct: forward preserves commentary ordering and original bytes", async () => {
  const originalBody = "Original line one.\n\nOriginal line two with  trailing space.  ";
  const originalAttachment = new Uint8Array([0x10, 0x00, 0xff, 0x0d, 0x0a]);
  const result = await builder().construct(
    draft({
      operationKey: { workId: "w3", actionSlot: "third-party:g1" },
      targetKind: "third-party",
      to: "friend@example.net",
      subject: "Fwd: invoice",
      authoredBody: "Forwarding this for you.",
      forwardSource: {
        from: "billing@example.com",
        to: "bot@example.com",
        subject: "invoice",
        date: new Date("2026-10-16T10:00:00Z"),
        body: originalBody,
        attachments: [{
          filename: "../../etc/passwd",
          contentType: "application/octet-stream",
          content: originalAttachment,
        }],
      },
    }),
    "Bot Signature",
  );

  const commentaryIndex = result.historyBody.indexOf("Forwarding this for you.");
  const signatureIndex = result.historyBody.indexOf(`${SIGNATURE_SEPARATOR}\nBot Signature`);
  const markerIndex = result.historyBody.indexOf(FORWARD_SECTION_MARKER);
  const originalIndex = result.historyBody.indexOf(originalBody);
  assertEquals(commentaryIndex >= 0, true);
  assertEquals(signatureIndex > commentaryIndex, true);
  assertEquals(markerIndex > signatureIndex, true);
  assertEquals(originalIndex > markerIndex, true);
  // Original body text preserved exactly, including trailing spaces.
  assertEquals(result.historyBody.includes(originalBody), true);

  const parsed = await parseIncomingMime(result.emlBytes);
  assertEquals(parsed.provenance.status, "clean");
  assertEquals(parsed.provenance.authoredText, "Forwarding this for you.\n-- \nBot Signature");
  // The parser trims the section, so internal spacing is asserted there while the
  // exact original bytes (including trailing spaces) are asserted on the wire.
  assertEquals(
    parsed.provenance.forwardedText?.includes(
      "Original line one.\n\nOriginal line two with  trailing space.",
    ),
    true,
  );
  // Path components in attachment filenames are display-sanitized.
  assertEquals(parsed.attachments.length, 1);
  assertEquals(parsed.attachments[0].displayName, "passwd");
  assertEquals(parsed.attachments[0].content, originalAttachment);
  assertEquals(decode(result.emlBytes).replace(/\r\n/g, "\n").includes(originalBody), true);
  assertChain(result);
});

Deno.test("buildForwardSection: marker, metadata and verbatim body only", () => {
  const section = buildForwardSection({
    from: "src@example.com",
    to: "bot@example.com",
    subject: "hello",
    date: new Date("2026-10-16T10:00:00Z"),
    body: "line one\nline two\n",
  });
  assertEquals(
    section,
    `${FORWARD_SECTION_MARKER}\nFrom: src@example.com\nDate: Fri, 16 Oct 2026 10:00:00 GMT\n` +
      `Subject: hello\nTo: bot@example.com\n\nline one\nline two\n`,
  );
});

Deno.test("construct: rejects header injection before producing any bytes", async () => {
  const cases: Array<{ draft: EmailDraft; code: OutgoingMimeDiagnosticCode }> = [
    {
      draft: draft({ subject: "Hello\r\nBcc: attacker@example.com" }),
      code: OutgoingMimeDiagnosticCode.INVALID_SUBJECT,
    },
    {
      draft: draft({ to: "user@example.com\r\nBcc: attacker@example.com" }),
      code: OutgoingMimeDiagnosticCode.INVALID_MAILBOX,
    },
    {
      draft: draft({ to: "route:user@example.com" }),
      code: OutgoingMimeDiagnosticCode.INVALID_MAILBOX,
    },
    {
      draft: draft({ to: "a@example.com, b@example.com" }),
      code: OutgoingMimeDiagnosticCode.INVALID_MAILBOX,
    },
    {
      draft: draft({ thread: { wireMessageId: "<a@example.com> <b@example.com>" } }),
      code: OutgoingMimeDiagnosticCode.INVALID_THREAD_HEADER,
    },
    {
      draft: draft({ thread: { references: ["<a@example.com>\n<b@example.com>"] } }),
      code: OutgoingMimeDiagnosticCode.INVALID_THREAD_HEADER,
    },
    {
      draft: draft({
        attachments: [{
          filename: "ok.bin\r\nX-Injected: 1",
          contentType: "application/octet-stream",
          content: new Uint8Array([1]),
        }],
      }),
      code: OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
    },
    {
      draft: draft({
        attachments: [{
          filename: "ok.bin",
          contentType: "application/octet-stream; name=x",
          content: new Uint8Array([1]),
        }],
      }),
      code: OutgoingMimeDiagnosticCode.INVALID_ATTACHMENT,
    },
  ];

  for (const testCase of cases) {
    const error = await assertRejects(
      () => builder().construct(testCase.draft, "Sig"),
      OutgoingMimeError,
    );
    assertEquals(error.diagnosticCode, testCase.code);
  }
});

Deno.test("construct: rejects unsafe configured from address", () => {
  assertThrows(
    () => new OutgoingMimeBuilder({ fromAddress: "bot@example.com\r\nBcc: x@example.com" }),
    OutgoingMimeError,
  );
});

Deno.test("construct: no Cc/Bcc surface and single envelope recipient", async () => {
  const result = await builder().construct(draft(), "Sig");
  const text = decode(result.emlBytes);
  assertEquals(/\r\nCc:/i.test(text), false);
  assertEquals(/\r\nBcc:/i.test(text), false);
  assertEquals(result.envelope.to.length, 1);
  assertEquals(result.envelope.to[0], "user@example.com");
});

Deno.test("construct: deterministic bytes and digest, sensitive to attachment bytes", async () => {
  const first = await builder().construct(draft(), "Sig");
  const second = await builder().construct(draft(), "Sig");
  assertEquals(first.emlBytes, second.emlBytes);
  assertEquals(first.digest, second.digest);
  assertEquals(first.messageId, second.messageId);

  const withAttachment = await builder().construct(
    draft({
      attachments: [{
        filename: "a.bin",
        contentType: "application/octet-stream",
        content: new Uint8Array([1, 2, 3]),
      }],
    }),
    "Sig",
  );
  assertNotEquals(withAttachment.digest, first.digest);
  assertNotEquals(withAttachment.messageId, first.messageId);
});

Deno.test("construct: wire bytes are pure CRLF with accounting metadata", async () => {
  const result = await builder().construct(
    draft({ authoredBody: "Ünïcode body line one.\nLine two." }),
    "Sig",
  );
  const text = decode(result.emlBytes);
  assertEquals(/[^\r]\n/.test(text), false);
  assertEquals(text.includes("\r\n"), true);
  assertEquals(result.sizeBytes, result.emlBytes.byteLength);
  assertEquals(result.digest, sha256Hex(result.emlBytes));
  for (const line of text.split("\r\n")) {
    if (line.length > 998) throw new Error("wire line exceeds RFC 5322 limit");
  }
});

Deno.test("construct: empty body with attachment and blank signature stays valid", async () => {
  const result = await builder().construct(
    draft({
      authoredBody: "",
      attachments: [{
        filename: "only.bin",
        contentType: "application/octet-stream",
        content: new Uint8Array([7, 8, 9]),
      }],
    }),
    "",
  );
  const parsed = await parseIncomingMime(result.emlBytes);
  assertEquals(parsed.attachments.length, 1);
  assertEquals(parsed.attachments[0].content, new Uint8Array([7, 8, 9]));
  assertEquals(result.historyBody, "");
  assertChain(result);
});

Deno.test("construct: round-trip through parseIncomingMime for reply and forward", async () => {
  const reply = await builder().construct(
    draft({ thread: { wireMessageId: "<parent@relay.example>" } }),
    MULTILINE_SIGNATURE,
  );
  const parsedReply = await parseIncomingMime(reply.emlBytes);
  assertEquals(parsedReply.from, "bot@example.com");
  assertEquals(parsedReply.subject, "Re: progress");
  assertEquals(parsedReply.wireIds.messageId, reply.messageId);
  assertEquals(parsedReply.wireIds.inReplyTo, "<parent@relay.example>");
  assertEquals(parsedReply.wireIds.references, ["<parent@relay.example>"]);
  assertEquals(parsedReply.plainBody, reply.historyBody);

  const forward = await builder().construct(
    draft({
      authoredBody: "FYI",
      forwardSource: { from: "src@example.com", subject: "orig", body: "original body" },
    }),
    "Sig",
  );
  const parsedForward = await parseIncomingMime(forward.emlBytes);
  assertEquals(parsedForward.provenance.authoredText, "FYI\n-- \nSig");
  assertEquals(parsedForward.provenance.forwardedText?.includes("original body"), true);
  assertEquals(parsedForward.wireIds.messageId, forward.messageId);
});
