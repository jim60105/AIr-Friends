// src/platforms/email/activation.ts
//
// Production composition root of the email platform (`email-activation`).
//
// Contract:
// - ONE function composes the real production stack: the durable submission journal, the
//   owner-scoped message store, the durable mailbox journal, the serialized IMAP poller, the
//   durable mail service, the platform adapter and the intent preflight. Nothing here is a
//   placeholder, and no second composition path exists.
// - The submission journal is recovered BEFORE any transport exists, so a corrupted or
//   unreadable journal blocks email activation instead of enabling ingress on unknown evidence.
//   The mailbox journal is recovered by the adapter's own `connect()` (see `EmailMailboxPoller`)
//   strictly before its first round admits work.
// - Configuration is revalidated on the typed config before any client is constructed: only
//   certificate-validated TLS/STARTTLS and a complete receiving-authentication trust
//   declaration may activate email. A missing or unattested configuration fails explicitly.
// - Both IMAP lanes get their OWN transport instance. The poller owns one mutable connection
//   and the mail service's sent-copy lane owns another, so receiving and APPEND can never
//   interleave on one connection.
// - Shutdown stops poll admission and settles the in-flight round first, then drains in-flight
//   submissions and their journal writes, then closes the protocol clients. It never resends.

import { join } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import type { Logger } from "@utils/logger.ts";
import { ConfigError, ErrorCode } from "../../types/errors.ts";
import type { ChannelConfig, Config, EmailConfig } from "../../types/config.ts";
import { getDefaultAgentType } from "@acp/agent-factory.ts";
import { resolveModel } from "@core/model-router.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";
import { buildMailboxFingerprint, MailboxStore } from "./mailbox-store.ts";
import { EmailMessageStore } from "./message-store.ts";
import { type SubmissionRecoveryResult, SubmissionStore } from "./submission-store.ts";
import { EmailSessionReceipts } from "./session-receipts.ts";
import { EmailAdapter } from "./email-adapter.ts";
import { EmailMailService } from "./mail-service.ts";
import { EmailImapClient, type ImapTransport } from "./imap-client.ts";
import { EmailSmtpClient, type SmtpTransport } from "./smtp-client.ts";
import { EmailIntentRuntime } from "@core/email-intent-runtime.ts";
import {
  EmailDestinationGrantPreflight,
  type EmailDestinationGrantSelection,
  type EmailDestinationGrantSelectionContext,
  type EmailForwardSourceResolver,
} from "@core/email-intent-preflight.ts";
import type { EmailComposeMailService, EmailForwardSourceStore } from "@skills/email-handler.ts";
import type { EmailSubmissionEvidenceSource } from "@core/email-response-accounting.ts";
import {
  createEmailAttachmentPreparation,
  type EmailAttachmentPreparation,
} from "./attachment-preparation.ts";
import {
  createEmailReplyEligibilityResolver,
  type EmailReplyEligibilityResolver,
} from "./reply-eligibility.ts";

const logger = createLogger("EmailActivation");

/** Injected protocol-seam transports. Production uses the real TLS clients. */
export interface EmailPlatformTransports {
  /** Receiving lane (poller). Defaults to a real `EmailImapClient`. */
  readonly imap?: ImapTransport;
  /** Submission lane. Defaults to a real `EmailSmtpClient`. */
  readonly smtp?: SmtpTransport;
  /** Sent-copy lane. Defaults to a real `EmailImapClient` of its own. */
  readonly sentCopyImap?: ImapTransport;
}

/** Construction inputs of the production email platform. */
export interface EmailPlatformOptions {
  /** Complete deployment configuration; `platforms.email.enabled` MUST be true. */
  readonly config: Config;
  /**
   * Protocol transports. Any omitted transport is constructed from `platforms.email` as the
   * real TLS client. Tests point the real clients at local protocol fixtures this way.
   */
  readonly transports?: EmailPlatformTransports;
  /** Logger for the intent runtime (tests may inject a quiet one). */
  readonly intentLogger?: Logger;
}

/**
 * Services installed on `AgentCore` so the session lifecycle, retry/accounting decisions, the
 * read-only grant surface and the `send-email` skill all see the SAME durable state.
 */
export interface EmailPlatformServices {
  /** Durable work receipts of the mailbox journal. */
  readonly receipts: EmailSessionReceipts;
  /** Recovered submission journal used as durable submission evidence. */
  readonly submissionStore: SubmissionStore;
  /** Durable lookup of one logical operation, satisfied by the mail service. */
  readonly submissionEvidence: EmailSubmissionEvidenceSource;
  /** Durable mail service; the only outbound path. */
  readonly mailService: EmailComposeMailService;
  /**
   * Durable explicit-reply-anchor eligibility, shared by the adapter and the
   * scheduled-reminder preflight so both resolve a retained anchor the same way.
   */
  readonly replyEligibility: EmailReplyEligibilityResolver;
  /** Owner-scoped store a forward reads its designated source through. */
  readonly forwardSourceStore?: EmailForwardSourceStore;
  /**
   * Session-bound staging of owner-scoped attachment references. The adapter
   * stays session-neutral; the host seams install this capability and supply
   * the authenticated session's own owner/staging boundary per call.
   */
  readonly attachmentPreparation: EmailAttachmentPreparation;
  /** Host-side destination authorization producer. */
  readonly preflight: EmailDestinationGrantPreflight;
}

/** Fully composed production email platform. */
export interface EmailPlatformRuntime {
  readonly emailRoot: string;
  readonly adapter: EmailAdapter;
  readonly mailService: EmailMailService;
  readonly submissionStore: SubmissionStore;
  readonly submissionRecovery: SubmissionRecoveryResult;
  readonly mailboxStore: MailboxStore;
  readonly messageStore: EmailMessageStore;
  readonly services: EmailPlatformServices;
  /**
   * Stop poll admission, drain in-flight work and journals, then close protocol clients.
   * Idempotent: a repeated call waits on the same shutdown.
   */
  shutdown(): Promise<void>;
}

/**
 * Revalidate the typed email configuration before any client or connection exists.
 *
 * This is deliberately a second check after config loading: a deployment may be composed from
 * an already-parsed configuration, and email activation must never depend on the loader having
 * been the only producer. Only secure transport and a complete trust declaration may pass.
 *
 * @throws ConfigError when activation is not allowed.
 */
export function assertEmailActivationConfig(config: Config): EmailConfig {
  const email = config.platforms.email;
  if (!email || email.enabled !== true) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "Email activation requires platforms.email.enabled: true",
      { field: "platforms.email.enabled" },
    );
  }

  if (!email.address || typeof email.address !== "string" || email.address.trim() === "") {
    throw new ConfigError(
      ErrorCode.CONFIG_MISSING_FIELD,
      "platforms.email.address is required when email platform is enabled",
      { field: "platforms.email.address" },
    );
  }
  try {
    normalizeEmailMailbox(email.address);
  } catch (error) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Invalid platforms.email.address: ${error instanceof Error ? error.message : String(error)}`,
      { field: "platforms.email.address" },
    );
  }

  assertSecureTransport("imap", email.imap);
  assertSecureTransport("smtp", email.smtp);

  if (
    !email.receivingAuth?.authservId ||
    typeof email.receivingAuth.authservId !== "string" ||
    email.receivingAuth.authservId.trim() === ""
  ) {
    throw new ConfigError(
      ErrorCode.CONFIG_MISSING_FIELD,
      "platforms.email.receivingAuth.authservId is required when email is enabled",
      { field: "platforms.email.receivingAuth.authservId" },
    );
  }
  if (email.receivingAuth.attestedStripping !== true) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "platforms.email.receivingAuth.attestedStripping must be true when email is enabled " +
        "(requires attested MTA authentication header stripping)",
      { field: "platforms.email.receivingAuth.attestedStripping" },
    );
  }

  assertNonEmptyString(email.incomingFolder, "platforms.email.incomingFolder");
  assertNonEmptyString(email.sentFolder, "platforms.email.sentFolder");
  assertPositiveInteger(email.pollIntervalMs, "platforms.email.pollIntervalMs");
  assertPositiveInteger(email.maxMessageBytes, "platforms.email.maxMessageBytes");
  assertPositiveInteger(email.maxIncomingAttachments, "platforms.email.maxIncomingAttachments");
  if (typeof email.signature !== "string") {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "platforms.email.signature must be a string when email is enabled",
      { field: "platforms.email.signature" },
    );
  }

  return email;
}

/** Require a secure transport mode and complete credentials for one mail protocol. */
function assertSecureTransport(
  kind: "imap" | "smtp",
  transport: { host?: string; username?: string; password?: string; tlsMode?: string } | undefined,
): void {
  const field = `platforms.email.${kind}`;
  if (!transport || typeof transport !== "object") {
    throw new ConfigError(
      ErrorCode.CONFIG_MISSING_FIELD,
      `${field} is required when email is enabled`,
      { field },
    );
  }
  assertNonEmptyString(transport.host, `${field}.host`);
  assertNonEmptyString(transport.username, `${field}.username`);
  assertNonEmptyString(transport.password, `${field}.password`);
  if (
    transport.tlsMode !== undefined && transport.tlsMode !== "tls" &&
    transport.tlsMode !== "starttls"
  ) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Invalid ${field}.tlsMode "${String(transport.tlsMode)}": must be "tls" or "starttls" ` +
        "(plaintext and opportunistic TLS are prohibited)",
      { field: `${field}.tlsMode` },
    );
  }
}

/** Require a present, non-blank string. */
function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(
      ErrorCode.CONFIG_MISSING_FIELD,
      `${field} is required when email is enabled`,
      { field },
    );
  }
}

/** Require a positive integer setting. */
function assertPositiveInteger(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `${field} must be a positive integer when email is enabled`,
      { field },
    );
  }
}

/**
 * Compose the production email platform.
 *
 * Recovery of the durable submission journal happens FIRST, before a transport is constructed
 * or any server is contacted. Any failure leaves no adapter and no partially enabled path: the
 * caller can then keep email blocked while the remaining platforms continue.
 */
export async function composeEmailPlatform(
  options: EmailPlatformOptions,
): Promise<EmailPlatformRuntime> {
  const config = options.config;
  const email = assertEmailActivationConfig(config);

  const emailRoot = join(config.workspace.repoPath, "email");
  const workspacesRoot = join(config.workspace.repoPath, "workspaces");
  const channels: ChannelConfig[] = config.channels ?? [];

  // Durable submission evidence first: no connection, no session admission, no SMTP exists
  // until the journal has been fully replayed and its unclosed submissions are absorbed.
  const submissionStore = new SubmissionStore(emailRoot);
  const submissionRecovery = await submissionStore.recover();
  logger.info("Recovered email submission journal: {Total} operation(s), {Unknown} unknown", {
    Total: submissionRecovery.totalTracked,
    Unknown: submissionRecovery.unknownRecovered.length,
  });

  const mailboxStore = new MailboxStore({
    emailRoot,
    fingerprint: buildMailboxFingerprint(email.imap.host, email.address, email.incomingFolder),
  });
  const messageStore = new EmailMessageStore({ workspacesRoot });
  const mailboxRecovery = await mailboxStore.recover();

  const imap = options.transports?.imap ?? new EmailImapClient({
    config: email.imap,
    defaultFolder: email.incomingFolder,
    defaultSentFolder: email.sentFolder,
    defaultMaxBytes: email.maxMessageBytes,
  });
  const smtp = options.transports?.smtp ?? new EmailSmtpClient({
    config: email.smtp,
    maxMessageBytes: email.maxMessageBytes,
  });
  // Receiving and sent-copy never share one mutable connection.
  const sentCopyImap = options.transports?.sentCopyImap ?? new EmailImapClient({
    config: email.imap,
    defaultFolder: email.incomingFolder,
    defaultSentFolder: email.sentFolder,
    defaultMaxBytes: email.maxMessageBytes,
  });

  const mailService = new EmailMailService({
    config: email,
    emailRoot,
    submissionStore,
    messageStore,
    smtp,
    imap: sentCopyImap,
    channels,
    recoveryResult: submissionRecovery,
  });

  const replyEligibility = createEmailReplyEligibilityResolver(messageStore);

  const adapter = new EmailAdapter({
    config: email,
    transport: imap,
    mailboxStore,
    mailboxRecovery,
    messageStore,
    mailService,
    replyEligibility,
    channels,
    onReviewRequired: (item) => {
      // Safe reason code only: never message content, addresses or header values.
      logger.warn("Email mailbox entry requires operator review: {Reason}", {
        Reason: item.reason,
      });
    },
    onCycleError: (code) => {
      logger.warn("Email poll round halted with safe code {SafeCode}", { SafeCode: code });
    },
  });

  const intentRuntime = new EmailIntentRuntime({
    config,
    logger: options.intentLogger ?? createLogger("EmailIntentRuntime"),
  });
  const preflight = new EmailDestinationGrantPreflight({
    interpreter: intentRuntime,
    selection: resolveIntentSelection(config),
    select: (context: EmailDestinationGrantSelectionContext) =>
      resolveIntentSelection(config, context),
    resolveForwardSource: forwardSourceResolver(messageStore),
  });

  const services: EmailPlatformServices = {
    receipts: new EmailSessionReceipts(mailboxStore),
    submissionStore,
    submissionEvidence: mailService,
    mailService,
    replyEligibility,
    forwardSourceStore: messageStore,
    attachmentPreparation: createEmailAttachmentPreparation(messageStore),
    preflight,
  };

  const runtime: EmailPlatformRuntime = {
    emailRoot,
    adapter,
    mailService,
    submissionStore,
    submissionRecovery,
    mailboxStore,
    messageStore,
    services,
    shutdown: shutdownOnce(async () => {
      // 1. Stop accepting work and settle the in-flight round (and its session hand-off).
      mailService.stopAdmission();
      await adapter.shutdown();
      // 2. Drain every in-flight submission and its durable journal write.
      await mailService.drain();
      // 3. Close the sent-copy protocol client. The poller already closed its own transport.
      try {
        await sentCopyImap.disconnect();
      } catch {
        logger.warn("Email sent-copy transport closed with an error during shutdown");
      }
    }),
  };
  return runtime;
}

/** Wrap one shutdown body so repeated calls observe the same completion. */
function shutdownOnce(body: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= body();
    return pending;
  };
}

/**
 * Prove one requested forward source belongs to the owner's accessible history.
 *
 * The resolver is owner-scoped by the store itself, so another owner's record is simply not
 * found. A store failure is treated as "unprovable" by the preflight (never a grant).
 */
function forwardSourceResolver(store: EmailMessageStore): EmailForwardSourceResolver {
  return async ({ owner, sourceRecordId }) =>
    (await store.getByOwnerRecord(owner, sourceRecordId)) !== undefined;
}

/**
 * The approved interpretation selection for one email account.
 *
 * The deployment's own model-routing rules decide which model an `email/account/<owner>`
 * session would use; the same rules therefore select the interpretation model. The backend is
 * the deployment's default agent type, which is also the backend whose deny-all intent profile
 * is built for the launch.
 */
function resolveIntentSelection(
  config: Config,
  context?: EmailDestinationGrantSelectionContext,
): EmailDestinationGrantSelection {
  const model = context === undefined ? config.agent.model : resolveModel(
    config.agent.modelRouting,
    {
      sessionType: "message",
      platform: context.platform,
      userId: context.userId,
      channelId: context.channelId,
    },
    config.agent.model,
  );
  return { model: parseProviderSelection(model), backend: getDefaultAgentType(config) };
}

/**
 * Split the deployment's `provider/model` identifier into the profile selection.
 *
 * The provider is the first path segment; everything after it is the model id, because model
 * ids may themselves contain slashes (`openrouter/deepseek/deepseek-v4-pro`).
 */
function parseProviderSelection(model: string): { providerID: string; modelID: string } {
  const trimmed = typeof model === "string" ? model.trim() : "";
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "Email intent interpretation requires agent.model in provider/model form",
      { field: "agent.model" },
    );
  }
  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}
