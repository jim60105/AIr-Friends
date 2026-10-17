// tests/core/email-bootstrap.test.ts
//
// Production composition, startup ordering and fail-closed activation for `email-activation`.
//
// Exercised layers: the REAL `composeEmailPlatform` composer, the REAL `SubmissionStore`,
// `MailboxStore`, `EmailMessageStore`, `EmailMailboxPoller`, `EmailMailService`, `EmailAdapter`
// and `EmailSessionReceipts` over isolated temporary state, the REAL `EmailImapClient` and
// `EmailSmtpClient` over certificate-validated TLS to the in-process protocol fixtures, and the
// REAL `PlatformRegistry` connection status. `EmailIntentRuntime` is constructed but never
// interpreted here; no model, ACP session or production credential is involved.
//
// The startup/shutdown ordering half follows the house static-wiring pattern: `bootstrap()`
// has no dependency-injection seam for `AgentCore`, so the exact anchors it must honor are
// asserted on the source.

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { ChannelConfig, Config, EmailConfig } from "../../src/types/config.ts";
import { ConfigError } from "../../src/types/errors.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { _resetSharedRegistryForTesting } from "../../src/platforms/email/submission-store.ts";
import {
  assertEmailActivationConfig,
  composeEmailPlatform,
  type EmailPlatformRuntime,
} from "../../src/platforms/email/activation.ts";
import { EmailImapClient } from "../../src/platforms/email/imap-client.ts";
import { EmailSmtpClient } from "../../src/platforms/email/smtp-client.ts";
import {
  getPlatformRegistry,
  resetPlatformRegistry,
} from "../../src/platforms/platform-registry.ts";
import { EmailImapTestService } from "../helpers/email-imap-service.ts";
import { EmailSmtpTestService } from "../helpers/email-smtp-service.ts";

const BOT = "bot@example.com";
const AUTHSERV = "mx.example.com";
const SENDER = "alice@allowed-domain.org";
const OWNER = normalizeEmailMailbox(SENDER).userId;
const IMAP_PASSWORD = "bootstrap-imap-secret";
const SMTP_PASSWORD = "bootstrap-smtp-secret";
const SIGNATURE = "AIr-Friends Bot";

const CHANNELS: ChannelConfig[] = [{ id: `email/account/${OWNER}`, enabled: true }];

const BOOTSTRAP_SOURCE = Deno.readTextFileSync(
  new URL("../../src/bootstrap.ts", import.meta.url),
);
const SHUTDOWN_SOURCE = Deno.readTextFileSync(
  new URL("../../src/shutdown.ts", import.meta.url),
);
const ACTIVATION_SOURCE = Deno.readTextFileSync(
  new URL("../../src/platforms/email/activation.ts", import.meta.url),
);

/** Locate one ordering anchor, failing loudly when it is refactored away. */
function anchor(source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert(index >= 0, `wiring anchor not found: ${needle}`);
  return index;
}

/** Base deployment config; the caller supplies the enabled email section. */
function deploymentConfig(root: string, email: EmailConfig): Config {
  return {
    platforms: {
      discord: { token: "", enabled: false },
      misskey: { host: "", token: "", enabled: false },
      email,
    },
    agent: {
      model: "openrouter/fixture/model",
      systemPromptPath: join(root, "prompts", "system_reply.md"),
      tokenLimit: 20000,
      defaultAgentType: "opencode",
    },
    workspace: { repoPath: root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: CHANNELS,
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
  } as unknown as Config;
}

/** Enabled email configuration for explicit local fixture ports. */
function fixtureEmailConfig(imapPort: number, smtpPort: number): EmailConfig {
  return {
    enabled: true,
    address: BOT,
    imap: {
      host: "127.0.0.1",
      port: imapPort,
      tlsMode: "tls",
      username: BOT,
      password: IMAP_PASSWORD,
    },
    smtp: {
      host: "127.0.0.1",
      port: smtpPort,
      tlsMode: "tls",
      username: BOT,
      password: SMTP_PASSWORD,
    },
    incomingFolder: "INBOX",
    sentFolder: "Sent",
    pollIntervalMs: 300_000,
    receivingAuth: { authservId: AUTHSERV, attestedStripping: true },
    maxMessageBytes: 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: SIGNATURE,
  };
}

/** Enabled email configuration pointing at started local protocol fixtures. */
function emailConfig(imap: EmailImapTestService, smtp: EmailSmtpTestService): EmailConfig {
  return fixtureEmailConfig(imap.port, smtp.port);
}

/** One admitted inbound message: trusted DMARC pass plus the allowlist channel. */
function rawMessage(messageId: string): string {
  const domain = SENDER.split("@")[1];
  return [
    `From: ${SENDER}`,
    `To: ${BOT}`,
    "Subject: Hello",
    `Message-ID: ${messageId}`,
    `Authentication-Results: ${AUTHSERV}; dmarc=pass header.from=${domain}`,
    "",
    "Authored body text.",
  ].join("\r\n");
}

async function withFixtures(
  fn: (imap: EmailImapTestService, smtp: EmailSmtpTestService) => Promise<void>,
): Promise<void> {
  const imap = new EmailImapTestService({
    tlsMode: "tls",
    username: BOT,
    password: IMAP_PASSWORD,
    uidValidity: 4242,
    uidNext: 101,
    initialMessages: [{ uid: 100, rawMime: rawMessage("<preexisting-100@x>") }],
  });
  const smtp = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: SMTP_PASSWORD,
  });
  await imap.start();
  await smtp.start();
  try {
    await fn(imap, smtp);
  } finally {
    await imap.stop();
    await smtp.stop();
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "email-bootstrap-test-" });
  try {
    _resetSharedRegistryForTesting();
    resetPlatformRegistry();
    await fn(dir);
  } finally {
    resetPlatformRegistry();
    _resetSharedRegistryForTesting();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** Build the real production stack over the local fixtures through the composer only. */
async function composeFixtureRuntime(
  base: string,
  imap: EmailImapTestService,
  smtp: EmailSmtpTestService,
): Promise<EmailPlatformRuntime> {
  const config = deploymentConfig(base, emailConfig(imap, smtp));
  const email = config.platforms.email!;
  return await composeEmailPlatform({
    config,
    transports: {
      imap: new EmailImapClient({
        config: email.imap,
        defaultFolder: email.incomingFolder,
        defaultSentFolder: email.sentFolder,
        tlsCa: imap.caCert,
      }),
      smtp: new EmailSmtpClient({ config: email.smtp, tlsCa: smtp.caCert }),
      sentCopyImap: new EmailImapClient({
        config: email.imap,
        defaultFolder: email.incomingFolder,
        defaultSentFolder: email.sentFolder,
        tlsCa: imap.caCert,
      }),
    },
  });
}

Deno.test("bootstrap wiring - recover, reclaim, compose, install and register precede every ingress", () => {
  const reclamation = anchor(
    BOOTSTRAP_SOURCE,
    "await agentCore.getWorkspaceManager().reclaimOrphanTmpDirs(",
  );
  const composition = anchor(BOOTSTRAP_SOURCE, "composeEmailPlatform({ config })");
  const install = anchor(BOOTSTRAP_SOURCE, "agentCore.setEmailPlatform(emailPlatform.services)");
  const registryRegistration = anchor(
    BOOTSTRAP_SOURCE,
    "platformRegistry.register(emailPlatform.adapter)",
  );
  const coreRegistration = anchor(
    BOOTSTRAP_SOURCE,
    "agentCore.registerPlatform(emailPlatform.adapter)",
  );
  const ingress = anchor(BOOTSTRAP_SOURCE, "export async function startPlatforms(");

  // The awaited workspace reclamation finishes before email is composed, and every email seam
  // is installed before the adapter can be connected by `startPlatforms()`.
  assert(reclamation < composition, "workspace reclamation must precede email composition");
  assert(composition < install, "durable composition must precede seam installation");
  assert(install < registryRegistration, "receipts/evidence/skill must exist before registration");
  assert(registryRegistration < ingress, "email must be registered before any platform connects");
  assert(coreRegistration < ingress, "AgentCore must own the adapter before any connection");

  // No dashboard or scheduler can start before the registration code above (they all appear
  // later), and the composer recovers the submission journal before it builds any component.
  assert(
    composition < anchor(BOOTSTRAP_SOURCE, "dashboardServer.start();"),
    "email registration must finish before the dashboard starts",
  );
  assert(
    composition < anchor(BOOTSTRAP_SOURCE, "spontaneousScheduler.start("),
    "email registration must finish before schedulers start",
  );
  const recovery = anchor(ACTIVATION_SOURCE, "await submissionStore.recover()");
  const adapterConstruction = anchor(ACTIVATION_SOURCE, "const adapter = new EmailAdapter(");
  assert(recovery < adapterConstruction, "submission recovery must precede adapter construction");
});

Deno.test("shutdown wiring - poll admission, drain and client close precede platform disconnect", () => {
  const schedulersStopped = anchor(SHUTDOWN_SOURCE, "this.context.reminderScheduler.stop();");
  const emailShutdown = anchor(SHUTDOWN_SOURCE, "await this.context.emailPlatform.shutdown();");
  const coreShutdown = anchor(SHUTDOWN_SOURCE, "await agentCore.shutdown();");
  const platformDisconnect = anchor(SHUTDOWN_SOURCE, "await platformRegistry.disconnectAll();");

  assert(schedulersStopped < emailShutdown, "schedulers stop before email ingress");
  assert(emailShutdown < coreShutdown, "email drains before the Skill API stops");
  assert(emailShutdown < platformDisconnect, "email closes before the registry disconnects all");

  // The runtime's own order: stop receiving, drain submissions, close the sent-copy client.
  const stopAdmission = anchor(ACTIVATION_SOURCE, "mailService.stopAdmission();");
  const drain = anchor(ACTIVATION_SOURCE, "await mailService.drain();");
  const closeCopy = anchor(ACTIVATION_SOURCE, "await sentCopyImap.disconnect();");
  assert(stopAdmission < drain, "poll admission stops before the submission drain");
  assert(drain < closeCopy, "in-flight journals drain before protocol clients close");
});

Deno.test("composition - registration status, preexisting-mail exclusion and shutdown", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (imap, smtp) => {
      const runtime = await composeFixtureRuntime(base, imap, smtp);
      const registry = getPlatformRegistry();
      registry.register(runtime.adapter);

      const events: string[] = [];
      runtime.adapter.onEvent((event) => {
        events.push(event.messageId);
        return Promise.resolve();
      });

      // Recovered state is empty and complete; the real stack is one unit.
      assertEquals(runtime.submissionRecovery.totalTracked, 0);
      assert(runtime.services.receipts);
      assert(runtime.services.mailService === runtime.mailService);
      assert(runtime.services.submissionStore === runtime.submissionStore);
      assert(runtime.services.submissionEvidence === runtime.mailService);
      assert(runtime.services.forwardSourceStore === runtime.messageStore);
      assert(runtime.services.preflight);

      // Registration is visible through the existing connection-status surface.
      assertEquals(registry.getAdapter("email")?.platform, "email");
      assertEquals(registry.getStatus().get("email")?.state, "disconnected");

      await registry.connectAll();
      assertEquals(runtime.adapter.getConnectionStatus().state, "connected");
      assertEquals(registry.isAllConnected(), true);

      // The first-activation boundary excludes the preexisting message.
      assertEquals(events, []);

      imap.addMessage({ uid: 101, rawMime: rawMessage("<new-101@x>") });
      const round = await runtime.adapter.poll();
      assertEquals(round.accepted, 1);
      assertEquals(events.length, 1);

      // Shutdown stops new work before closing the client; a later round accepts nothing.
      await runtime.shutdown();
      assertEquals(runtime.adapter.getConnectionStatus().state, "disconnected");
      await assertRejects(() => runtime.adapter.connect(), Error, "shut down");
      await assertRejects(
        () => runtime.mailService.send({} as never),
        Error,
        "admission is closed",
      );
      assertEquals(smtp.dataTransactionCount, 0);
      const afterStop = await runtime.adapter.poll();
      assertEquals(afterStop.accepted, 0);
      assertEquals(events.length, 1);

      // Idempotent shutdown: the registry's own disconnect still completes.
      await runtime.shutdown();
      await registry.disconnectAll();
    });
  });
});

Deno.test("composition - a corrupt submission journal blocks email instead of enabling ingress", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (imap, smtp) => {
      // A torn/corrupt submission journal is not evidence of absence.
      const emailRoot = join(base, "email");
      await Deno.mkdir(emailRoot, { recursive: true, mode: 0o700 });
      await Deno.writeTextFile(join(emailRoot, "submissions.jsonl"), "not-a-journal-record\n");

      const config = deploymentConfig(base, emailConfig(imap, smtp));
      await assertRejects(
        () =>
          composeEmailPlatform({
            config,
            transports: {
              imap: new EmailImapClient({ config: config.platforms.email!.imap }),
            },
          }),
        Error,
      );
      // No transport was ever contacted: recovery happens before any client exists.
      assertEquals(imap.authAttempts.length, 0);
    });
  });
});

Deno.test("activation config - insecure transport and missing authority fail closed", async () => {
  const base = await Deno.makeTempDir({ prefix: "email-bootstrap-config-" });
  try {
    const valid = fixtureEmailConfig(993, 465);

    const cases: Array<{ label: string; mutate: (email: EmailConfig) => void; match: string }> = [
      {
        label: "plaintext IMAP",
        mutate: (email) => {
          email.imap.tlsMode = "plaintext" as unknown as "tls";
        },
        match: "plaintext and opportunistic TLS are prohibited",
      },
      {
        label: "plaintext SMTP",
        mutate: (email) => {
          email.smtp.tlsMode = "none" as unknown as "tls";
        },
        match: "plaintext and opportunistic TLS are prohibited",
      },
      {
        label: "missing authserv",
        mutate: (email) => {
          email.receivingAuth.authservId = "";
        },
        match: "receivingAuth.authservId is required",
      },
      {
        label: "unattested stripping",
        mutate: (email) => {
          email.receivingAuth.attestedStripping = false;
        },
        match: "attestedStripping must be true",
      },
      {
        label: "missing IMAP credential",
        mutate: (email) => {
          email.imap.password = "";
        },
        match: "platforms.email.imap.password is required",
      },
      {
        label: "blank incoming folder",
        mutate: (email) => {
          email.incomingFolder = "";
        },
        match: "platforms.email.incomingFolder is required",
      },
    ];

    for (const testCase of cases) {
      const email = structuredClone(valid);
      testCase.mutate(email);
      const config = deploymentConfig(base, email);
      assertThrows(
        () => assertEmailActivationConfig(config),
        ConfigError,
        testCase.match,
      );
      // The composer refuses before constructing a client or recovering state.
      await assertRejects(
        () => composeEmailPlatform({ config }),
        ConfigError,
        testCase.match,
      );
    }

    const disabled = deploymentConfig(base, { ...structuredClone(valid), enabled: false });
    assertThrows(
      () => assertEmailActivationConfig(disabled),
      ConfigError,
      "platforms.email.enabled",
    );
  } finally {
    await Deno.remove(base, { recursive: true }).catch(() => {});
  }
});

Deno.test("composition - damaged mailbox evidence refuses activation before protocol authentication", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (imap, smtp) => {
      const root = join(base, "email");
      await Deno.mkdir(root, { recursive: true });
      await Deno.writeTextFile(join(root, "mailbox.json"), "corrupt");
      await assertRejects(() => composeFixtureRuntime(base, imap, smtp));
      assertEquals(imap.authAttempts.length, 0);
      assertEquals(smtp.dataTransactionCount, 0);
    });
  });
});
