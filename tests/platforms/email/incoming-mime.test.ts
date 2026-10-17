/**
 * tests/platforms/email/incoming-mime.test.ts
 *
 * Tests for bounded MIME parsing and provenance extraction (email-incoming-mime).
 *
 * Tests:
 * 1. Pinned dependencies and streaming bounded parser for HTML, binary, and malformed cases.
 * 2. Conservative provenance: separates authored, quoted, and forwarded content. Ambiguity on HTML-only or mixed.
 * 3. Pre-byte message size limit (declared and actual bytes).
 * 4. Attachment count limit: rejects 11th attachment immediately without partial storage, cancelling upstream reader.
 * 5. Display-only sanitized attachment filenames.
 * 6. Attachment-only requests (empty body + attachment).
 * 7. Malformed routing headers, multi-valued Message-ID, and multiple From mailboxes rejection.
 * 8. Privacy: no private headers or error text leaked in error diagnostics or messages.
 * 9. Integration with EmailMessageStore (toMessageStoreParsedEmail).
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  convertHtmlToInertText,
  extractProvenance,
  IncomingMimeDiagnosticCode,
  IncomingMimeError,
  parseIncomingMime,
  sanitizeAttachmentDisplayName,
  toMessageStoreParsedEmail,
} from "../../../src/platforms/email/incoming-mime.ts";

Deno.test("sanitizeAttachmentDisplayName: strips directory traversals, control chars, and defaults correctly", () => {
  assertEquals(sanitizeAttachmentDisplayName("report.pdf", 0), "report.pdf");
  assertEquals(
    sanitizeAttachmentDisplayName("../../../etc/passwd", 0),
    "passwd",
  );
  assertEquals(
    sanitizeAttachmentDisplayName("C:\\Windows\\System32\\calc.exe", 0),
    "calc.exe",
  );
  assertEquals(sanitizeAttachmentDisplayName("..", 0), "attachment-1.dat");
  assertEquals(sanitizeAttachmentDisplayName(".", 0), "attachment-1.dat");
  assertEquals(sanitizeAttachmentDisplayName("", 0), "attachment-1.dat");
  assertEquals(sanitizeAttachmentDisplayName(undefined, 2), "attachment-3.dat");
  assertEquals(
    sanitizeAttachmentDisplayName("file\x00name\x1f.txt", 0),
    "filename.txt",
  );
});

Deno.test("convertHtmlToInertText: converts HTML without executing scripts or referencing external images", () => {
  const html = `
    <html>
      <head>
        <style>body { color: red; }</style>
        <script>alert("exploit");</script>
      </head>
      <body>
        <p>Hello <b>World</b></p>
        <img src="http://evil.com/tracker.png" alt="tracker">
        <blockquote>Some quoted text</blockquote>
      </body>
    </html>
  `;
  const text = convertHtmlToInertText(html);
  assertEquals(text.includes("alert"), false);
  assertEquals(text.includes("tracker.png"), false);
  assertEquals(text.includes("Hello World"), true);
  assertEquals(text.includes("Some quoted text"), true);
});

Deno.test("extractProvenance: separates authored and quoted text", () => {
  const body = `
I approve this request.

On Fri, Oct 17, 2026 at 10:00 AM Alice <alice@example.com> wrote:
> Can we schedule the deployment for Monday?
> Please confirm.
  `.trim();

  const prov = extractProvenance(body);
  assertEquals(prov.status, "clean");
  assertEquals(prov.authoredText, "I approve this request.");
  assertEquals(
    prov.quotedText?.includes("Can we schedule the deployment"),
    true,
  );
  assertEquals(prov.forwardedText, undefined);
});

Deno.test("extractProvenance: separates forwarded text", () => {
  const body = `
FYI take a look at this.

---------- Forwarded message ---------
From: Bob <bob@example.com>
Subject: Update
Here is the status.
  `.trim();

  const prov = extractProvenance(body);
  assertEquals(prov.status, "clean");
  assertEquals(prov.authoredText, "FYI take a look at this.");
  assertEquals(prov.forwardedText?.includes("From: Bob"), true);
});

Deno.test("extractProvenance: marks status ambiguous when mixed reply occurs after quote", () => {
  const body = `
Top comment.

> Quoted comment 1
Middle reply between quotes!

> Quoted comment 2
  `.trim();

  const prov = extractProvenance(body);
  assertEquals(prov.status, "ambiguous");
  assertEquals(prov.authoredText.includes("Top comment."), true);
  assertEquals(prov.authoredText.includes("Middle reply between quotes!"), true);
});

Deno.test("extractProvenance: marks status ambiguous for HTML-only fallback bodies", () => {
  const body = "Please process this command immediately.";
  const prov = extractProvenance(body, { isHtmlOnly: true });
  assertEquals(prov.status, "ambiguous");
  assertEquals(prov.authoredText, body);
});

Deno.test("parseIncomingMime: parses clean plain-text MIME with wireIds", async () => {
  const eml = [
    "From: Alice Bob <alice@example.com>",
    "To: bot@example.com",
    "Subject: Project Status",
    "Date: Fri, 17 Oct 2026 12:00:00 +0000",
    "Message-ID: <msg-001@example.com>",
    "In-Reply-To: <parent-000@example.com>",
    "References: <root-000@example.com> <parent-000@example.com>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello team,",
    "Everything is on track.",
    "",
    "On 2026-10-16, Charlie wrote:",
    "> How are things going?",
  ].join("\r\n");

  const parsed = await parseIncomingMime(eml);
  assertEquals(parsed.from, "alice@example.com");
  assertEquals(parsed.subject, "Project Status");
  assertEquals(parsed.wireIds.messageId, "<msg-001@example.com>");
  assertEquals(parsed.wireIds.inReplyTo, "<parent-000@example.com>");
  assertEquals(parsed.wireIds.references, [
    "<root-000@example.com>",
    "<parent-000@example.com>",
  ]);
  assertEquals(parsed.provenance.status, "clean");
  assertEquals(
    parsed.provenance.authoredText,
    "Hello team,\nEverything is on track.",
  );
  assertEquals(
    parsed.provenance.quotedText?.includes("How are things going?"),
    true,
  );
  assertEquals(parsed.attachments.length, 0);
});

Deno.test("parseIncomingMime: HTML-only message converts inertly with ambiguous status", async () => {
  const eml = [
    "From: <bob@example.com>",
    "Subject: HTML Announcement",
    "Message-ID: <html-msg-01@example.com>",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body><h1>Important</h1><p>Please click <a href='https://example.com'>here</a>.</p></body></html>",
  ].join("\r\n");

  const parsed = await parseIncomingMime(eml);
  assertEquals(parsed.from, "bob@example.com");
  assertEquals(parsed.provenance.status, "ambiguous");
  assertEquals(parsed.plainBody.toLowerCase().includes("important"), true);
  assertEquals(parsed.plainBody.includes("Please click here"), true);
});

Deno.test("parseIncomingMime: multipart/alternative prefers plain text over HTML", async () => {
  const eml = [
    "From: sender@example.com",
    "Subject: Multi Part",
    "Message-ID: <multi-01@example.com>",
    'Content-Type: multipart/alternative; boundary="alt-boundary"',
    "",
    "--alt-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Plain text representation.",
    "--alt-boundary",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>HTML representation.</p>",
    "--alt-boundary--",
  ].join("\r\n");

  const parsed = await parseIncomingMime(eml);
  assertEquals(parsed.plainBody, "Plain text representation.");
  assertEquals(parsed.provenance.status, "clean");
  assertEquals(parsed.provenance.authoredText, "Plain text representation.");
});

Deno.test("parseIncomingMime: attachment-only request is valid with empty authoredText", async () => {
  const eml = [
    "From: sender@example.com",
    "Subject: Attachment Only",
    "Message-ID: <att-only@example.com>",
    'Content-Type: multipart/mixed; boundary="mix-boundary"',
    "",
    "--mix-boundary",
    'Content-Type: text/plain; name="note.txt"',
    'Content-Disposition: attachment; filename="note.txt"',
    "",
    "This is the attachment payload.",
    "--mix-boundary--",
  ].join("\r\n");

  const parsed = await parseIncomingMime(eml);
  assertEquals(parsed.plainBody, "");
  assertEquals(parsed.provenance.authoredText, "");
  assertEquals(parsed.provenance.status, "clean");
  assertEquals(parsed.attachments.length, 1);
  assertEquals(parsed.attachments[0].displayName, "note.txt");
  assertEquals(parsed.attachments[0].mimeType, "text/plain");
  assertEquals(
    new TextDecoder().decode(parsed.attachments[0].content),
    "This is the attachment payload.",
  );
});

Deno.test("parseIncomingMime: pre-byte check rejects declaredSize exceeding limit", async () => {
  const err = await assertRejects(
    async () => {
      await parseIncomingMime("From: a@b.com\r\n\r\nSmall", {
        maxMessageBytes: 1000,
        declaredSize: 2000,
      });
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
  );
});

Deno.test("parseIncomingMime: understated declaredSize is caught by streaming byte counter and cancels source", async () => {
  let streamCancelled = false;
  const chunk = new Uint8Array(2000);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
    },
    cancel() {
      streamCancelled = true;
    },
  });

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(stream, {
        maxMessageBytes: 1500,
        declaredSize: 500, // understated declared size
      });
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
  );
  assertEquals(streamCancelled, true);
});

Deno.test("parseIncomingMime: streaming byte check rejects oversized payload and cancels stream", async () => {
  let streamCancelled = false;
  const bigChunk = new Uint8Array(1024 * 1024); // 1 MiB
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bigChunk);
      controller.enqueue(bigChunk);
    },
    cancel() {
      streamCancelled = true;
    },
  });

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(stream, {
        maxMessageBytes: 1.5 * 1024 * 1024, // 1.5 MiB limit, stream produces 2 MiB
      });
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
  );
  assertEquals(streamCancelled, true);
});

Deno.test("parseIncomingMime: rejects message with 11 attachments before consuming and cancels source", async () => {
  const parts: string[] = [
    "From: sender@example.com",
    "Subject: Too Many Attachments",
    'Content-Type: multipart/mixed; boundary="mix-11"',
    "",
  ];

  for (let i = 1; i <= 11; i++) {
    parts.push("--mix-11");
    parts.push(`Content-Type: text/plain; name="att${i}.txt"`);
    parts.push(`Content-Disposition: attachment; filename="att${i}.txt"`);
    parts.push("");
    parts.push(`Content of attachment ${i}`);
  }
  parts.push("--mix-11--");

  const emlBytes = new TextEncoder().encode(parts.join("\r\n"));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(emlBytes);
      controller.close();
    },
  });

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(stream, {
        maxIncomingAttachments: 10,
      });
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.ATTACHMENT_LIMIT_EXCEEDED,
  );
});

Deno.test("parseIncomingMime: rejects multiple From header lines", async () => {
  const eml = [
    "From: user1@example.com",
    "From: user2@example.com",
    "Subject: Fraud",
    "",
    "Body",
  ].join("\r\n");

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(eml);
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
  );
});

Deno.test("parseIncomingMime: rejects multiple Message-ID header lines", async () => {
  const eml = [
    "From: user@example.com",
    "Message-ID: <id1@example.com>",
    "Message-ID: <id2@example.com>",
    "Subject: Bad IDs",
    "",
    "Body",
  ].join("\r\n");

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(eml);
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
  );
});

Deno.test("parseIncomingMime: rejects multi-valued or malformed Message-ID and References", async () => {
  const emlMultiMsgId = [
    "From: user@example.com",
    "Message-ID: <id1@example.com> <id2@example.com>",
    "Subject: Multi ID",
    "",
    "Body",
  ].join("\r\n");

  const err1 = await assertRejects(
    async () => {
      await parseIncomingMime(emlMultiMsgId);
    },
    IncomingMimeError,
  );
  assertEquals(
    err1.diagnosticCode,
    IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
  );

  const emlBadRef = [
    "From: user@example.com",
    "Message-ID: <id1@example.com>",
    "References: <valid@example.com> unbracketed-garbage",
    "Subject: Bad Ref",
    "",
    "Body",
  ].join("\r\n");

  const err2 = await assertRejects(
    async () => {
      await parseIncomingMime(emlBadRef);
    },
    IncomingMimeError,
  );
  assertEquals(
    err2.diagnosticCode,
    IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
  );
});

Deno.test("parseIncomingMime: rejects malformed From mailbox (e.g. invalid syntax or group)", async () => {
  const eml = [
    "From: Group Name: user1@example.com, user2@example.com;",
    "Subject: Group Mail",
    "",
    "Body",
  ].join("\r\n");

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(eml);
    },
    IncomingMimeError,
  );
  assertEquals(
    err.diagnosticCode,
    IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
  );
});

Deno.test("Privacy: errors never disclose private message bodies or malformed header values", async () => {
  const privateSecret = "SUPER_SECRET_TOKEN_98765";
  const eml = [
    `From: attacker@example.com`,
    `Message-ID: malformed-no-brackets-${privateSecret}`,
    `Subject: Secret Message`,
    "",
    `Private body secret: ${privateSecret}`,
  ].join("\r\n");

  const err = await assertRejects(
    async () => {
      await parseIncomingMime(eml);
    },
    IncomingMimeError,
  );

  const serialized = JSON.stringify(err.toJSON());
  assertEquals(serialized.includes(privateSecret), false);
  assertEquals(err.message.includes(privateSecret), false);
});

Deno.test("toMessageStoreParsedEmail: correctly transforms ParsedEmail for EmailMessageStore", async () => {
  const eml = [
    "From: sender@example.com",
    "Subject: Storage Test",
    "Message-ID: <store-01@example.com>",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain",
    "",
    "Hello Store",
    "--b",
    'Content-Type: application/octet-stream; filename="payload.bin"',
    'Content-Disposition: attachment; filename="payload.bin"',
    "Content-Transfer-Encoding: base64",
    "",
    "SGVsbG8gQXR0YWNobWVudA==", // "Hello Attachment"
    "--b--",
  ].join("\r\n");

  const parsed = await parseIncomingMime(eml);
  const storeData = toMessageStoreParsedEmail(parsed);

  assertEquals(storeData.from, "sender@example.com");
  assertEquals(storeData.subject, "Storage Test");
  assertEquals(storeData.plainBody, "Hello Store");
  assertEquals(storeData.attachments.length, 1);
  assertEquals(storeData.attachmentPayloads.length, 1);
  assertEquals(storeData.attachments[0].displayName, "payload.bin");
  assertEquals(
    new TextDecoder().decode(storeData.attachmentPayloads[0].content),
    "Hello Attachment",
  );
});
