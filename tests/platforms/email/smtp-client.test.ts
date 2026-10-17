// tests/platforms/email/smtp-client.test.ts
//
// Deterministic regression tests for EmailSmtpClient against an in-process SMTP fixture.
// Exercises fail-closed TLS (missing STARTTLS, invalid certificate), authenticated
// submission over direct TLS and mandatory STARTTLS, the submission outcome taxonomy
// (submitted / failed / unknown), pre-submit size enforcement, envelope binding, single
// DATA transaction per submission, no retry after a lost acknowledgement, and credential
// redaction in results and diagnostics.

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_MAX_MESSAGE_BYTES,
  EmailSmtpClient,
  SmtpDiagnosticCode,
  SmtpTransportError,
} from "../../../src/platforms/email/smtp-client.ts";
import { EmailSmtpTestService } from "../../helpers/email-smtp-service.ts";
import { getOrCreateFixtureCert } from "../../helpers/email-imap-service.ts";
import type { EmailSmtpConfig } from "../../../src/types/config.ts";

const HOST = "127.0.0.1";
const USERNAME = "bot@example.com";
const PASSWORD = "smtp-fixture-secret-4b71";
const RECIPIENT = "user@example.com";

/** CRLF-terminated synthetic message containing dot-leading body lines. */
const EML_BYTES = new TextEncoder().encode(
  "From: bot@example.com\r\n" +
    "To: user@example.com\r\n" +
    "Subject: fixture\r\n" +
    "\r\n" +
    "Hello\r\n" +
    ".\r\n" +
    "..dot-leading line\r\n",
);

function submission(overrides: Partial<Parameters<EmailSmtpClient["submit"]>[0]> = {}) {
  return {
    emlBytes: EML_BYTES,
    envelope: { from: USERNAME, to: [RECIPIENT] },
    sizeBytes: EML_BYTES.byteLength,
    ...overrides,
  };
}

function client(
  service: EmailSmtpTestService,
  overrides: {
    config?: Partial<EmailSmtpConfig>;
    maxMessageBytes?: number;
    timeoutMs?: number;
    tlsCa?: string | string[] | Buffer | Buffer[];
  } = {},
): EmailSmtpClient {
  return new EmailSmtpClient({
    config: {
      host: HOST,
      port: service.port,
      tlsMode: "tls",
      username: USERNAME,
      password: PASSWORD,
      ...overrides.config,
    },
    tlsCa: overrides.tlsCa ?? service.caCert,
    maxMessageBytes: overrides.maxMessageBytes,
    timeoutMs: overrides.timeoutMs,
  });
}

/** Run a service-backed body with bounded shutdown regardless of outcome. */
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

Deno.test("EmailSmtpClient - config validation rejects unusable and plaintext configuration", () => {
  assertThrows(
    () =>
      new EmailSmtpClient({
        config: { host: "", username: USERNAME, password: PASSWORD },
      }),
    SmtpTransportError,
    "[INVALID_CONFIG]",
  );
  assertThrows(
    () =>
      new EmailSmtpClient({
        config: { host: HOST, username: "", password: PASSWORD },
      }),
    SmtpTransportError,
    "[INVALID_CONFIG]",
  );
  assertThrows(
    () =>
      new EmailSmtpClient({
        config: { host: HOST, username: USERNAME, password: "" },
      }),
    SmtpTransportError,
    "[INVALID_CONFIG]",
  );
  assertThrows(
    () =>
      new EmailSmtpClient({
        config: {
          host: HOST,
          username: USERNAME,
          password: PASSWORD,
          tlsMode: "plaintext" as unknown as "tls",
        },
      }),
    SmtpTransportError,
    "[TLS_REQUIRED]",
  );
  assertThrows(
    () =>
      new EmailSmtpClient({
        config: { host: HOST, port: 70000, username: USERNAME, password: PASSWORD },
      }),
    SmtpTransportError,
    "[INVALID_CONFIG]",
  );

  // Omitted tlsMode keeps the predecessor default (direct TLS on port 465).
  const defaults = new EmailSmtpClient({
    config: { host: HOST, username: USERNAME, password: PASSWORD },
  });
  assertEquals(defaults.messageSizeLimit, DEFAULT_MAX_MESSAGE_BYTES);
});

Deno.test("EmailSmtpClient - direct TLS submission is accepted with one DATA transaction", async () => {
  await withService({ tlsMode: "tls", username: USERNAME, password: PASSWORD }, async (service) => {
    const result = await client(service).submit(submission());

    assertEquals(result.phase, "submitted");
    assertEquals(result.safeCode, SmtpDiagnosticCode.ACCEPTED);
    assertEquals(result.responseCode, 250);
    assertEquals(result.accepted, [RECIPIENT]);
    assertEquals(result.rejected, []);
    assertEquals(result.sizeBytes, EML_BYTES.byteLength);

    assertEquals(service.dataTransactionCount, 1);
    const transaction = service.dataTransactions[0];
    assertEquals(transaction.envelopeFrom, USERNAME);
    assertEquals(transaction.recipients, [RECIPIENT]);
    assertEquals(transaction.decoded, EML_BYTES);

    assertEquals(service.authAttempts.length, 1);
    assertEquals(service.authAttempts[0].secure, true);
    assertEquals(service.authAttempts[0].user, USERNAME);

    // Credentials never appear in the result or its diagnostics.
    const serialized = JSON.stringify(result);
    assert(!serialized.includes(PASSWORD));
    assert(!serialized.includes(USERNAME));
  });
});

Deno.test("EmailSmtpClient - mandatory STARTTLS submission authenticates only after the upgrade", async () => {
  await withService(
    {
      tlsMode: "starttls",
      username: USERNAME,
      password: PASSWORD,
      supportStartTls: true,
    },
    async (service) => {
      const result = await client(service, { config: { tlsMode: "starttls" } }).submit(
        submission(),
      );

      assertEquals(result.phase, "submitted");
      assertEquals(service.dataTransactionCount, 1);
      assertEquals(service.dataTransactions[0].decoded, EML_BYTES);

      const startTlsIndex = service.executedCommands.findIndex((command) =>
        command.toUpperCase().startsWith("STARTTLS")
      );
      const authIndex = service.executedCommands.findIndex((command) =>
        command.toUpperCase().startsWith("AUTH")
      );
      assert(startTlsIndex !== -1, "STARTTLS was not attempted");
      assert(authIndex > startTlsIndex, "authentication was attempted before STARTTLS");
      assertEquals(service.authAttempts.length, 1);
      assertEquals(service.authAttempts[0].secure, true);
    },
  );
});

Deno.test("EmailSmtpClient - missing and refused STARTTLS fail closed without credentials or bytes", async () => {
  await withService(
    {
      tlsMode: "starttls",
      username: USERNAME,
      password: PASSWORD,
      supportStartTls: false,
    },
    async (service) => {
      const result = await client(service, {
        config: { tlsMode: "starttls" },
        timeoutMs: 5_000,
      }).submit(submission());

      assertEquals(result.phase, "failed");
      assert(
        [
          SmtpDiagnosticCode.TLS_HANDSHAKE_FAILED,
          SmtpDiagnosticCode.CONNECTION_FAILED,
          SmtpDiagnosticCode.PROTOCOL_ERROR,
        ].includes(result.safeCode),
        `unexpected safe code ${result.safeCode}`,
      );
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

Deno.test("EmailSmtpClient - certificate validation failure fails closed with zero auth attempts", async () => {
  await withService({ tlsMode: "tls", username: USERNAME, password: PASSWORD }, async (service) => {
    const bogusCa = getOrCreateFixtureCert().cert.replace("MII", "XXX");
    const result = await client(service, { tlsCa: bogusCa, timeoutMs: 5_000 }).submit(
      submission(),
    );

    assertEquals(result.phase, "failed");
    assert(
      [
        SmtpDiagnosticCode.TLS_HANDSHAKE_FAILED,
        SmtpDiagnosticCode.CONNECTION_FAILED,
      ].includes(result.safeCode),
      `unexpected safe code ${result.safeCode}`,
    );
    assertEquals(service.authAttempts.length, 0);
    assertEquals(service.dataTransactionCount, 0);
  });
});

Deno.test("EmailSmtpClient - certificate validation failure during STARTTLS fails closed", async () => {
  await withService(
    { tlsMode: "starttls", username: USERNAME, password: PASSWORD, supportStartTls: true },
    async (service) => {
      const bogusCa = getOrCreateFixtureCert().cert.replace("MII", "XXX");
      const result = await client(service, {
        config: { tlsMode: "starttls" },
        tlsCa: bogusCa,
        timeoutMs: 5_000,
      }).submit(submission());

      assertEquals(result.phase, "failed");
      assertEquals(service.authAttempts.length, 0);
      assertEquals(service.dataTransactionCount, 0);
    },
  );
});

Deno.test("EmailSmtpClient - authentication rejection is a definite failure", async () => {
  await withService(
    { tlsMode: "tls", username: USERNAME, password: PASSWORD, rejectAuth: true },
    async (service) => {
      const result = await client(service).submit(submission());

      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.AUTH_FAILED);
      assertEquals(result.responseCode, 535);
      assertEquals(service.dataTransactionCount, 0);
    },
  );
});

Deno.test("EmailSmtpClient - envelope rejections are failures with zero DATA transactions", async () => {
  await withService(
    { tlsMode: "tls", username: USERNAME, password: PASSWORD, rejectRecipient: true },
    async (service) => {
      const result = await client(service).submit(submission());

      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.REJECTED);
      assertEquals(result.responseCode, 550);
      assertEquals(service.dataTransactionCount, 0);
    },
  );

  await withService(
    { tlsMode: "tls", username: USERNAME, password: PASSWORD, rejectMailFrom: true },
    async (service) => {
      const result = await client(service).submit(submission());

      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.REJECTED);
      assertEquals(service.dataTransactionCount, 0);
    },
  );

  await withService(
    { tlsMode: "tls", username: USERNAME, password: PASSWORD, rejectDataCommand: true },
    async (service) => {
      const result = await client(service).submit(submission());

      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.REJECTED);
      assertEquals(result.responseCode, 554);
      assertEquals(service.dataTransactionCount, 0);
    },
  );
});

Deno.test("EmailSmtpClient - explicit final rejections are failures after exactly one DATA", async () => {
  for (const finalResponseCode of [550, 451]) {
    await withService(
      {
        tlsMode: "tls",
        username: USERNAME,
        password: PASSWORD,
        finalResponseCode,
      },
      async (service) => {
        const result = await client(service).submit(submission());

        assertEquals(result.phase, "failed");
        assertEquals(result.safeCode, SmtpDiagnosticCode.REJECTED);
        assertEquals(result.responseCode, finalResponseCode);
        assertEquals(service.dataTransactionCount, 1);
      },
    );
  }
});

Deno.test("EmailSmtpClient - lost acknowledgement after DATA is unknown and never retried", async () => {
  for (
    const options of [
      { closeAfterPayload: true },
      { stallAfterPayload: true },
    ]
  ) {
    await withService(
      { tlsMode: "tls", username: USERNAME, password: PASSWORD, ...options },
      async (service) => {
        const result = await client(service, { timeoutMs: 800 }).submit(submission());

        assertEquals(result.phase, "unknown");
        assert(
          [
            SmtpDiagnosticCode.CONNECTION_LOST,
            SmtpDiagnosticCode.CONNECTION_TIMEOUT,
          ].includes(result.safeCode),
          `unexpected safe code ${result.safeCode}`,
        );
        assertEquals(service.dataTransactionCount, 1);
        // No retry: nothing beyond the consumed DATA transaction reaches the server.
        assertEquals(service.postDataCommands, []);
      },
    );
  }
});

Deno.test("EmailSmtpClient - truncated acknowledgement is unknown, not failure", async () => {
  await withService(
    {
      tlsMode: "tls",
      username: USERNAME,
      password: PASSWORD,
      truncatedResponseAfterPayload: "250 2.0.0 Ok: queued as FIXTURE",
    },
    async (service) => {
      const result = await client(service, { timeoutMs: 800 }).submit(submission());

      assertEquals(result.phase, "unknown");
      assertEquals(result.safeCode, SmtpDiagnosticCode.MALFORMED_RESPONSE);
      assertEquals(result.responseCode, 250);
      assertEquals(service.dataTransactionCount, 1);
    },
  );
});

Deno.test("EmailSmtpClient - unparseable final reply is unknown", async () => {
  await withService(
    {
      tlsMode: "tls",
      username: USERNAME,
      password: PASSWORD,
      truncatedResponseAfterPayload: "not-a-status\r\n",
    },
    async (service) => {
      const result = await client(service, { timeoutMs: 800 }).submit(submission());

      assertEquals(result.phase, "unknown");
      assertEquals(result.safeCode, SmtpDiagnosticCode.MALFORMED_RESPONSE);
      assertEquals(service.dataTransactionCount, 1);
    },
  );
});

Deno.test("EmailSmtpClient - greeting refusal is a definite connection failure", async () => {
  await withService(
    { tlsMode: "tls", username: USERNAME, password: PASSWORD, refuseGreeting: true },
    async (service) => {
      const result = await client(service, { timeoutMs: 5_000 }).submit(submission());

      assertEquals(result.phase, "failed");
      assert(
        [
          SmtpDiagnosticCode.CONNECTION_FAILED,
          SmtpDiagnosticCode.PROTOCOL_ERROR,
          SmtpDiagnosticCode.TLS_HANDSHAKE_FAILED,
        ].includes(result.safeCode),
        `unexpected safe code ${result.safeCode}`,
      );
      assertEquals(service.dataTransactionCount, 0);
    },
  );
});

Deno.test("EmailSmtpClient - unreachable server is a definite failure", async () => {
  const probe = new EmailSmtpTestService({ tlsMode: "tls" });
  await probe.start();
  const deadPort = probe.port;
  await probe.stop();

  const unreachable = new EmailSmtpClient({
    config: { host: HOST, port: deadPort, tlsMode: "tls", username: USERNAME, password: PASSWORD },
    timeoutMs: 5_000,
  });
  const result = await unreachable.submit(submission());

  assertEquals(result.phase, "failed");
  assertEquals(result.safeCode, SmtpDiagnosticCode.CONNECTION_FAILED);
  assertEquals(result.accepted, []);
});

Deno.test("EmailSmtpClient - oversize message is refused before any connection", async () => {
  await withService({ tlsMode: "tls", username: USERNAME, password: PASSWORD }, async (service) => {
    const result = await client(service, { maxMessageBytes: 16 }).submit(submission());

    assertEquals(result.phase, "failed");
    assertEquals(result.safeCode, SmtpDiagnosticCode.MESSAGE_TOO_LARGE);
    assertEquals(result.sizeBytes, EML_BYTES.byteLength);
    assertEquals(service.executedCommands.length, 0);
    assertEquals(service.dataTransactionCount, 0);
  });
});

Deno.test("EmailSmtpClient - stale size metadata cannot bypass the size bound", async () => {
  await withService({ tlsMode: "tls", username: USERNAME, password: PASSWORD }, async (service) => {
    const result = await client(service, { maxMessageBytes: 16 }).submit(
      submission({ sizeBytes: 1 }),
    );

    assertEquals(result.phase, "failed");
    assertEquals(result.safeCode, SmtpDiagnosticCode.MESSAGE_TOO_LARGE);
    assertEquals(service.executedCommands.length, 0);
  });
});

Deno.test("EmailSmtpClient - provider SIZE limit rejection is a failure with zero DATA", async () => {
  await withService(
    {
      tlsMode: "tls",
      username: USERNAME,
      password: PASSWORD,
      announceMaxSize: 32,
    },
    async (service) => {
      const result = await client(service).submit(submission());

      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.PROVIDER_SIZE_REJECTED);
      assertEquals(service.dataTransactionCount, 0);
    },
  );
});

Deno.test("EmailSmtpClient - invalid envelopes are refused before any connection", async () => {
  await withService({ tlsMode: "tls", username: USERNAME, password: PASSWORD }, async (service) => {
    const invalidEnvelopes = [
      { from: USERNAME, to: [] },
      { from: USERNAME, to: [RECIPIENT, "second@example.com"] },
      { from: USERNAME, to: [""] },
      { from: "", to: [RECIPIENT] },
      { from: USERNAME, to: ["user@example.com\r\nRCPT TO:<evil@example.com>"] },
    ];
    for (const envelope of invalidEnvelopes) {
      const result = await client(service).submit(submission({ envelope }));
      assertEquals(result.phase, "failed");
      assertEquals(result.safeCode, SmtpDiagnosticCode.INVALID_ENVELOPE);
    }

    const empty = await client(service).submit(
      submission({ emlBytes: new Uint8Array(0), sizeBytes: 0 }),
    );
    assertEquals(empty.safeCode, SmtpDiagnosticCode.EMPTY_MESSAGE);

    assertEquals(service.executedCommands.length, 0);
    assertEquals(service.dataTransactionCount, 0);
  });
});

Deno.test("EmailSmtpClient - a second submission opens its own connection and DATA transaction", async () => {
  await withService({ tlsMode: "tls", username: USERNAME, password: PASSWORD }, async (service) => {
    const smtp = client(service);
    const first = await smtp.submit(submission());
    const second = await smtp.submit(submission());

    assertEquals(first.phase, "submitted");
    assertEquals(second.phase, "submitted");
    assertEquals(service.dataTransactionCount, 2);
    assertEquals(service.authAttempts.length, 2);
  });
});
