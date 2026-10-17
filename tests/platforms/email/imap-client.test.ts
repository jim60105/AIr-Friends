// tests/platforms/email/imap-client.test.ts
//
// Deterministic regression and smoke tests for EmailImapClient.
// Exercises TLS direct mode, mandatory STARTTLS, invalid certificate rejection,
// missing STARTTLS rejection, UID incremental retrieval ignoring \Seen,
// byte bounds, size preflight, and streaming overflow protection.

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  DEFAULT_MAX_MESSAGE_BYTES,
  EmailImapClient,
  ImapDiagnosticCode,
  ImapTransportError,
} from "../../../src/platforms/email/imap-client.ts";
import { EmailImapTestService, getOrCreateFixtureCert } from "../../helpers/email-imap-service.ts";

Deno.test({
  name: "EmailImapClient - config validation and rejection of invalid tlsMode",
  fn() {
    // Missing host
    assertRejects(
      async () => {
        const client = new EmailImapClient({
          config: {
            host: "",
            username: "user",
            password: "password",
          },
        });
        await client.connect();
      },
      ImapTransportError,
      "[INVALID_CONFIG]",
    );

    // Invalid tlsMode (plaintext attempt)
    assertRejects(
      async () => {
        const client = new EmailImapClient({
          config: {
            host: "127.0.0.1",
            username: "user",
            password: "password",
            tlsMode: "plaintext" as unknown as "tls",
          },
        });
        await client.connect();
      },
      ImapTransportError,
      "[TLS_REQUIRED]",
    );
  },
});

Deno.test({
  name:
    "EmailImapClient - direct TLS connect, position, listAfter, fetchHeaders, fetchSource, and appendSent",
  async fn() {
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: "bot@example.com",
      password: "secretpassword",
      uidValidity: 98765,
      uidNext: 105,
      initialMessages: [
        {
          uid: 101,
          flags: ["\\Seen"], // Marked as seen by another client
          rawMime: "From: alice@example.com\r\nSubject: Hello Seen\r\n\r\nBody 101",
        },
        {
          uid: 102,
          flags: [], // Unseen
          rawMime: "From: bob@example.com\r\nSubject: Unread\r\n\r\nBody 102",
        },
      ],
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "tls",
          username: "bot@example.com",
          password: "secretpassword",
        },
        tlsCa: service.caCert,
      });

      await client.connect();

      // Check auth attempt was over direct TLS
      assertEquals(service.authAttempts.length, 1);
      assertEquals(service.authAttempts[0].secure, true);
      assertEquals(service.authAttempts[0].user, "bot@example.com");

      // Check position
      const pos = await client.position();
      assertEquals(pos.uidValidity, 98765);
      assertEquals(pos.uidNext, 105);

      // Check status without select
      const stat = await client.status();
      assertEquals(stat.uidValidity, 98765);
      assertEquals(stat.uidNext, 105);

      // Check listAfter: should return both 101 (Seen) and 102 (Unseen) for uidSince 100
      const uids = await client.listAfter(100);
      assertEquals(uids, [101, 102]);

      // Incremental discovery: uidSince 101 returns only 102
      const uidsAfter101 = await client.listAfter(101);
      assertEquals(uidsAfter101, [102]);

      // Past uidNext: returns empty
      const uidsPast = await client.listAfter(105);
      assertEquals(uidsPast, []);

      // Check fetchHeaders
      const headers = await client.fetchHeaders(101);
      assert(headers.includes("Subject: Hello Seen"));

      // Check fetchSource
      const msg = await client.fetchSource(101);
      assertEquals(msg.uid, 101);
      const bytes = await msg.bytes();
      const text = new TextDecoder().decode(bytes);
      assert(text.includes("Body 101"));

      // Check appendSent
      await client.appendSent("From: bot@example.com\r\nTo: alice@example.com\r\n\r\nSent Copy");
      assertEquals(service.appendedMessages.length, 1);
      assertEquals(service.appendedMessages[0].folder, "Sent");
      assert(
        new TextDecoder().decode(service.appendedMessages[0].content).includes("Sent Copy"),
      );

      await client.disconnect();
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name: "EmailImapClient - mandatory STARTTLS success and upgrade",
  async fn() {
    const service = new EmailImapTestService({
      tlsMode: "starttls",
      username: "starttls-user@example.com",
      password: "starttls-secret",
      uidValidity: 5555,
      uidNext: 200,
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "starttls",
          username: "starttls-user@example.com",
          password: "starttls-secret",
        },
        tlsCa: service.caCert,
      });

      await client.connect();

      // Ensure authentication occurred ONLY AFTER TLS was established
      assertEquals(service.authAttempts.length, 1);
      assertEquals(service.authAttempts[0].secure, true);
      assertEquals(service.authAttempts[0].user, "starttls-user@example.com");

      const pos = await client.status();
      assertEquals(pos.uidValidity, 5555);

      await client.disconnect();
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name:
    "EmailImapClient - invalid certificate failure fails closed with zero authentication attempts",
  async fn() {
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: "user@example.com",
      password: "secret",
    });

    const port = await service.start();

    try {
      // Intentionally provide invalid CA root
      const otherCert = getOrCreateFixtureCert().cert.replace("MII", "ABC");
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "tls",
          username: "user@example.com",
          password: "secret",
        },
        tlsCa: otherCert,
      });

      const err = await assertRejects(
        async () => {
          await client.connect();
        },
        ImapTransportError,
      );

      assertEquals(err.diagnosticCode, ImapDiagnosticCode.TLS_HANDSHAKE_FAILED);
      // Zero authentication attempts sent to server!
      assertEquals(service.authAttempts.length, 0);
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name: "EmailImapClient - STARTTLS downgrade rejection: server omits STARTTLS capability",
  async fn() {
    const service = new EmailImapTestService({
      tlsMode: "starttls",
      omitStartTlsCapability: true,
      username: "downgrade-user@example.com",
      password: "secret",
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "starttls",
          username: "downgrade-user@example.com",
          password: "secret",
        },
        tlsCa: service.caCert,
      });

      const err = await assertRejects(
        async () => {
          await client.connect();
        },
        ImapTransportError,
      );

      assertEquals(err.diagnosticCode, ImapDiagnosticCode.TLS_HANDSHAKE_FAILED);
      // Ensure zero credentials were sent over plaintext!
      assertEquals(service.authAttempts.length, 0);
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name: "EmailImapClient - STARTTLS downgrade rejection: server rejects STARTTLS command",
  async fn() {
    const service = new EmailImapTestService({
      tlsMode: "starttls",
      rejectStartTlsCommand: true,
      username: "downgrade-user@example.com",
      password: "secret",
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "starttls",
          username: "downgrade-user@example.com",
          password: "secret",
        },
        tlsCa: service.caCert,
      });

      const err = await assertRejects(
        async () => {
          await client.connect();
        },
        ImapTransportError,
      );

      assertEquals(err.diagnosticCode, ImapDiagnosticCode.TLS_HANDSHAKE_FAILED);
      // Zero credentials sent over plaintext!
      assertEquals(service.authAttempts.length, 0);
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name: "EmailImapClient - preflight size check aborts before streaming oversized message",
  async fn() {
    const service = new EmailImapTestService({
      tlsMode: "tls",
      initialMessages: [
        {
          uid: 50,
          rawMime: "From: big@example.com\r\n\r\nOversized message body",
          advertisedSize: DEFAULT_MAX_MESSAGE_BYTES + 100, // Advertises > 25 MiB
        },
      ],
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "tls",
          username: "test@example.com",
          password: "secret123",
        },
        tlsCa: service.caCert,
      });

      await client.connect();

      const err = await assertRejects(
        async () => {
          await client.fetchSource(50);
        },
        ImapTransportError,
      );

      assertEquals(err.diagnosticCode, ImapDiagnosticCode.SIZE_PREFLIGHT_EXCEEDED);

      // Verify server never received a full BODY[] or RFC822 command, only preflight size check
      const bodyCommands = service.executedCommands.filter((cmd) =>
        cmd.includes("BODY[]") || cmd.includes("RFC822 ")
      );
      assertEquals(bodyCommands.length, 0);

      await client.disconnect();
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name: "EmailImapClient - streaming size limit errors if server understates size in preflight",
  async fn() {
    const actualBytes = new Uint8Array(10_000);
    actualBytes.fill(65); // 'A'

    const service = new EmailImapTestService({
      tlsMode: "tls",
      initialMessages: [
        {
          uid: 77,
          rawMime: actualBytes,
          advertisedSize: 100, // Lies: claims size is 100 bytes, but actually sends 10,000 bytes
        },
      ],
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "tls",
          username: "test@example.com",
          password: "secret123",
        },
        tlsCa: service.caCert,
      });

      await client.connect();

      // Request with maxBytes: 500
      const msg = await client.fetchSource(77, { maxBytes: 500 });
      assertEquals(msg.uid, 77);

      // Streaming should throw MESSAGE_TOO_LARGE as soon as bytes exceed 500
      const err = await assertRejects(
        async () => {
          await msg.bytes();
        },
        ImapTransportError,
      );

      assertEquals(err.diagnosticCode, ImapDiagnosticCode.MESSAGE_TOO_LARGE);

      await client.disconnect();
    } finally {
      await service.stop();
    }
  },
});

Deno.test({
  name: "EmailImapClient - authentication failure does not leak password in error",
  async fn() {
    const secretPassword = "SUPER_SECRET_PLAINTEXT_PASSWORD_12345";
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: "legit@example.com",
      password: "correctpassword",
    });

    const port = await service.start();

    try {
      const client = new EmailImapClient({
        config: {
          host: "127.0.0.1",
          port,
          tlsMode: "tls",
          username: "legit@example.com",
          password: secretPassword, // Wrong password
        },
        tlsCa: service.caCert,
      });

      const err = await assertRejects(
        async () => {
          await client.connect();
        },
        ImapTransportError,
      );

      assertEquals(err.diagnosticCode, ImapDiagnosticCode.AUTH_FAILED);
      // Ensure secret password is not leaked in message or json representation
      assert(!err.message.includes(secretPassword));
      assert(!JSON.stringify(err.toJSON()).includes(secretPassword));
    } finally {
      await service.stop();
    }
  },
});
