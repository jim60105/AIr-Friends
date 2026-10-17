// tests/platforms/email/smtp-transport-smoke.test.ts
//
// Controlled integration smoke test for `email-smtp-transport` with the real predecessor
// implementations: `OutgoingMimeBuilder` (email-mime-signature) constructs the message and
// `EmailSmtpClient` submits those exact bytes over a real TLS SMTP protocol service.
//
// Exercised layers: real MIME construction, real nodemailer SMTP engine over real sockets,
// real TLS handshakes with a locally generated CA, and the in-process SMTP protocol fixture.
// No ACP/model test doubles are involved. This row owns no durable state, so no persistence
// layer is involved and none is written by these scenarios.
//
// Scenarios mirror `openspec/changes/email-smtp-transport/specs/email-smtp-transport/spec.md`:
// accepted and rejected envelopes, an unsafe server, and a lost final reply.

import { assert, assertEquals } from "@std/assert";
import {
  type ConstructedOutgoingEmail,
  OutgoingMimeBuilder,
} from "../../../src/platforms/email/outgoing-mime.ts";
import { EmailSmtpClient, SmtpDiagnosticCode } from "../../../src/platforms/email/smtp-client.ts";
import { EmailSmtpTestService } from "../../helpers/email-smtp-service.ts";

const OWNER = "e_" + "a".repeat(64);
const FROM = "bot@example.com";
const TO = "user@example.com";
const PASSWORD = "smoke-fixture-secret-2f90";
const SIGNATURE = "AIr-Friends Bot\nSecond line";

function builder(): OutgoingMimeBuilder {
  return new OutgoingMimeBuilder({
    fromAddress: FROM,
    now: () => new Date("2026-10-17T00:00:00Z"),
  });
}

async function constructSmokeMessage(workId: string): Promise<ConstructedOutgoingEmail> {
  return await builder().construct({
    owner: OWNER,
    operationKey: { workId, actionSlot: "reply" },
    targetKind: "user",
    to: TO,
    subject: "Re: smoke",
    authoredBody: "Smoke body.\nDot line:\n.\n..double dot\nEnd.",
  }, SIGNATURE);
}

function smtpClient(
  service: EmailSmtpTestService,
  tlsMode: "tls" | "starttls",
  timeoutMs = 5_000,
): EmailSmtpClient {
  return new EmailSmtpClient({
    config: {
      host: "127.0.0.1",
      port: service.port,
      tlsMode,
      username: FROM,
      password: PASSWORD,
    },
    tlsCa: service.caCert,
    timeoutMs,
  });
}

async function withService(
  options: ConstructorParameters<typeof EmailSmtpTestService>[0],
  body: (service: EmailSmtpTestService) => Promise<void>,
): Promise<void> {
  const service = new EmailSmtpTestService(options);
  await service.start();
  try {
    await body(service);
  } finally {
    await service.stop();
  }
}

Deno.test("Smoke: constructed bytes reach the wire verbatim with one envelope recipient", async () => {
  await withService({ tlsMode: "tls", username: FROM, password: PASSWORD }, async (service) => {
    const constructed = await constructSmokeMessage("smoke-smtp-accepted");
    const result = await smtpClient(service, "tls").submit(constructed);

    assertEquals(result.phase, "submitted");
    assertEquals(result.safeCode, SmtpDiagnosticCode.ACCEPTED);
    assertEquals(result.responseCode, 250);
    assertEquals(result.accepted, [TO]);
    assertEquals(result.sizeBytes, constructed.sizeBytes);

    // Exactly one DATA transaction, one envelope recipient, byte-identical message reuse.
    assertEquals(service.dataTransactionCount, 1);
    const transaction = service.dataTransactions[0];
    assertEquals(transaction.recipients, [TO]);
    assertEquals(transaction.envelopeFrom, constructed.envelope.from);
    assertEquals(transaction.decoded, constructed.emlBytes);

    // The wire copy carries the signature once and the constructed Message-ID.
    const wire = new TextDecoder().decode(transaction.decoded);
    const wireSignature = SIGNATURE.replace(/\n/g, "\r\n");
    assertEquals(wire.split(wireSignature).length - 1, 1);
    assert(wire.includes(`Message-ID: ${constructed.messageId}`));
    assert(wire.includes("Auto-Submitted: auto-generated"));

    // Credential redaction: neither the result nor the emitted diagnostics carry secrets.
    const serialized = JSON.stringify(result);
    assert(!serialized.includes(PASSWORD));
    assertEquals(service.authAttempts.filter((attempt) => attempt.secure).length, 1);
  });
});

Deno.test("Smoke: accepted and rejected envelopes stay distinct with one DATA each", async () => {
  const rejected = await constructSmokeMessage("smoke-smtp-rejected");

  await withService(
    {
      tlsMode: "tls",
      username: FROM,
      password: PASSWORD,
      finalResponseCode: 550,
    },
    async (service) => {
      const result = await smtpClient(service, "tls").submit(rejected);

      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.REJECTED);
      assertEquals(result.responseCode, 550);
      assertEquals(result.accepted, []);
      assertEquals(service.dataTransactionCount, 1);
      assertEquals(service.dataTransactions[0].decoded, rejected.emlBytes);
    },
  );

  await withService(
    { tlsMode: "starttls", username: FROM, password: PASSWORD, supportStartTls: true },
    async (service) => {
      const accepted = await constructSmokeMessage("smoke-smtp-starttls");
      const result = await smtpClient(service, "starttls").submit(accepted);

      assertEquals(result.phase, "submitted");
      assertEquals(service.dataTransactionCount, 1);
      assertEquals(service.dataTransactions[0].recipients, [TO]);

      const startTlsIndex = service.executedCommands.findIndex((command) =>
        command.toUpperCase().startsWith("STARTTLS")
      );
      const authIndex = service.executedCommands.findIndex((command) =>
        command.toUpperCase().startsWith("AUTH")
      );
      assert(startTlsIndex !== -1 && authIndex > startTlsIndex);
      assertEquals(service.authAttempts[0].secure, true);
    },
  );
});

Deno.test("Smoke: unsafe server receives no credentials and no message bytes", async () => {
  await withService(
    {
      tlsMode: "starttls",
      username: FROM,
      password: PASSWORD,
      supportStartTls: false,
    },
    async (service) => {
      const constructed = await constructSmokeMessage("smoke-smtp-unsafe");
      const result = await smtpClient(service, "starttls", 2_000).submit(constructed);

      assertEquals(result.phase, "failed");
      assertEquals(service.authAttempts.length, 0);
      assertEquals(service.dataTransactionCount, 0);
      const commands = service.executedCommands.map((command) => command.toUpperCase());
      assert(!commands.some((command) => command.startsWith("MAIL FROM")));
      assert(!commands.some((command) => command.startsWith("RCPT TO")));
      assert(!commands.some((command) => command.startsWith("DATA")));
      assert(!service.executedCommands.some((command) => command.includes(PASSWORD)));
    },
  );
});

Deno.test("Smoke: lost final reply is unknown with no internal retry", async () => {
  await withService(
    {
      tlsMode: "tls",
      username: FROM,
      password: PASSWORD,
      closeAfterPayload: true,
    },
    async (service) => {
      const constructed = await constructSmokeMessage("smoke-smtp-unknown");
      const result = await smtpClient(service, "tls", 2_000).submit(constructed);

      assertEquals(result.phase, "unknown");
      assert(
        [
          SmtpDiagnosticCode.CONNECTION_LOST,
          SmtpDiagnosticCode.CONNECTION_TIMEOUT,
          SmtpDiagnosticCode.MALFORMED_RESPONSE,
        ].includes(result.safeCode),
        `unexpected safe code ${result.safeCode}`,
      );
      // The server saw exactly one DATA transaction and nothing after the payload.
      assertEquals(service.dataTransactionCount, 1);
      assertEquals(service.dataTransactions[0].decoded, constructed.emlBytes);
      assertEquals(service.postDataCommands, []);
    },
  );
});
