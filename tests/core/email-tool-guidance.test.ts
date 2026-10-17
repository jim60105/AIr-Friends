// tests/core/email-tool-guidance.test.ts
//
// Regression matrix for `email-tool-guidance` (row 28):
//   * the delivered message/reminder/spontaneous prompts render the email
//     capability contract for BOTH engines, name the literal payload paths,
//     never render the configured signature, and leave non-email renderings
//     byte-compatible (no email fragment, reaction/edit guidance retained);
//   * the email missing-response corrective turn is built without any
//     reaction/edit material in both spawn strategies, while ordinary
//     platforms keep the full three-skill prompt;
//   * the ACP permission gate refuses a hidden `send-email` invocation in BOTH
//     backend shapes — a registered skill call and a direct script command —
//     and the refusal is per SESSION on a shared client;
//   * the hidden set is derived from the durable session record: an email
//     request exposes `send-email` only with a destination grant, while
//     reminder/spontaneous/ordinary sessions hide it (or hide nothing).
//
// These assertions prove delivered TEXT, gate decisions and prompt wiring.
// They never prove that a model obeyed the text, that SMTP accepted a message
// or that any production credential exists; the Skill API handler refusal
// itself is exercised by the predecessor email suites.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";
import { ChatbotClient } from "@acp/client.ts";
import { getRetryPromptStrategy } from "@acp/agent-factory.ts";
import { buildSkillAutoApproveList } from "@acp/skill-inventory.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { EMAIL_HIDDEN_SKILLS, hiddenEmailSkillsFor } from "@core/email-tool-policy.ts";
import type {
  DestinationGrant,
  EmailDestinationGrantPreflight,
} from "@core/email-intent-preflight.ts";
import { SkillRegistry } from "@skills/registry.ts";
import type { EmailComposeMailService } from "@skills/email-handler.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { AgentConnector, AgentProcessEvidence } from "../../src/acp/agent-connector.ts";
import type { AgentConnectorOptions, ClientConfig } from "../../src/acp/types.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent, PlatformMessage } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformCapabilities, ReplyResult } from "../../src/types/platform.ts";
import { createTemplateEngine, renderTemplate } from "@core/template-renderer.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import * as acp from "@agentclientprotocol/sdk";

const PROMPTS_DIR = join(import.meta.dirname ?? ".", "..", "..", "prompts");
const SKILLS_ROOT = Deno.realPathSync(join(import.meta.dirname ?? ".", "..", "..", "skills"));
const SESSION_ID = "sess_guidance_1";
const STAGING_DIR = "/data/workspaces/email/owner/tmp/sess_guidance_1";
/** A value that MUST never appear in any rendered prompt. */
const SIGNATURE_SENTINEL = "SIG-SENTINEL-do-not-render";
const OWNER = `e_${"0123456789abcdef".repeat(4)}`;

const env = createTemplateEngine(PROMPTS_DIR);

function baseVars(platform: string): Record<string, unknown> {
  return {
    isDm: true,
    platform,
    userId: platform === "email" ? OWNER : "u1",
    channelId: platform === "email" ? `mail:${OWNER}:rec1` : "c1",
    guildId: "",
    model: "test-model",
    skillsDir: SKILLS_ROOT,
    sessionId: SESSION_ID,
    tmpDir: STAGING_DIR,
    // Present in no template contract: proves nothing consumes it either.
    signature: SIGNATURE_SENTINEL,
  };
}

function render(template: string, vars: Record<string, unknown>): Promise<string> {
  return renderTemplate(env, join(PROMPTS_DIR, template), vars);
}

function renderReminder(vars: Record<string, unknown>): Promise<string> {
  return render("system_reminder.md", {
    ...vars,
    reminderMessage: "Team meeting in 30 minutes",
    reminderCreatedAt: "2026-10-18T00:00:00.000Z",
    reminderScheduledAt: "2026-10-18T01:00:00.000Z",
  });
}

const EMAIL_GRANT: DestinationGrant = {
  grantId: "grant_1",
  sessionId: SESSION_ID,
  workId: "work_1",
  owner: OWNER,
  action: "compose",
  canonicalRecipient: "friend@example.org",
  requestDigest: "digest",
};

// ---------------------------------------------------------------------------
// Delivered prompt matrix (both engines, both platform shapes)
// ---------------------------------------------------------------------------

for (const agentType of ["opencode", "omp"] as const) {
  for (
    const [label, _template, renderer] of [
      ["reply", "system_reply.md", (v: Record<string, unknown>) => render("system_reply.md", v)],
      ["reminder", "system_reminder.md", (v: Record<string, unknown>) => renderReminder(v)],
      [
        "spontaneous",
        "system_spontaneous.md",
        (v: Record<string, unknown>) => render("system_spontaneous.md", v),
      ],
    ] as const
  ) {
    Deno.test(`prompt - email ${label} ${agentType} carries the email contract`, async () => {
      const rendered = await renderer({
        ...baseVars("email"),
        agentType,
        yolo: false,
        emailSessionKind: label === "reminder"
          ? "reminder"
          : label === "spontaneous"
          ? "spontaneous"
          : "request",
        emailSendGrants: [EMAIL_GRANT],
      });
      assertStringIncludes(rendered, "## Email Session Capabilities");
      assertStringIncludes(rendered, 'never attempt skill({ name: "edit-reply" })');
      assertStringIncludes(rendered, "never claim that you are typing");
      assertStringIncludes(rendered, "NEVER write a signature");
      // The configured signature is never rendered into the prompt.
      assertFalse(rendered.includes(SIGNATURE_SENTINEL));
      // The email contract supersedes the generic reaction guidance.
      assertFalse(rendered.includes('You may also use skill({ name: "react-message" })'));
      assertFalse(rendered.includes("**Edit your reply**"));
      // The literal staging directory is named for the payload file, only on
      // the request shape (reminders/spontaneous never expose send-email).
      if (label === "reply") {
        assertStringIncludes(rendered, `${STAGING_DIR}/compose.json`);
        assertStringIncludes(rendered, "--grant-id");
      }
      if (label === "reply") {
        assertStringIncludes(
          rendered,
          "counts as the response and you may exit immediately without manufacturing an unnecessary user reply",
        );
        assertStringIncludes(
          rendered,
          "When a granted third-party send succeeds, that delivery completes your work for the turn: you may exit immediately without sending an additional user reply.",
        );
      }

      if (label === "reminder") {
        assertStringIncludes(rendered, "as an email reply into its original thread");
        assertStringIncludes(rendered, "scheduled reminder session");
      } else if (label === "spontaneous") {
        assertStringIncludes(rendered, "spontaneous session");
      }
    });

    Deno.test(`prompt - non-email ${label} ${agentType} stays unchanged`, async () => {
      // A reminder renders only for Discord; the other two are message shapes.
      const vars = {
        ...baseVars("discord"),
        agentType,
        yolo: false,
        // Even if email-only variables leak in, a non-email render must ignore them.
        emailSessionKind: "request",
        emailSendGrants: [EMAIL_GRANT],
        ...(label === "spontaneous" ? { rssItems: "- one" } : {}),
      };
      const rendered = label === "reminder"
        ? await renderReminder(vars)
        : label === "reply"
        ? await render("system_reply.md", vars)
        : await render("system_spontaneous.md", vars);

      assertFalse(rendered.includes("## Email Session Capabilities"));
      assertFalse(rendered.includes(`${STAGING_DIR}/compose.json`));
      assertFalse(rendered.includes(SIGNATURE_SENTINEL));
      if (label === "reminder") {
        assertStringIncludes(rendered, "via DM");
      }
      if (label === "reply") {
        assertStringIncludes(rendered, 'You may also use skill({ name: "react-message" })');
        assertStringIncludes(rendered, "**Edit your reply**");
        assertStringIncludes(rendered, "`edit-reply`");
      }
    });
  }
}

Deno.test("prompt - an email session without a grant refuses send-email", async () => {
  const rendered = await render("system_reply.md", {
    ...baseVars("email"),
    emailSessionKind: "request",
    emailSendGrants: [],
  });
  assertStringIncludes(rendered, "`send-email` is not available in this session");
  assertStringIncludes(rendered, "recorded no third-party destination grant");
  assertFalse(rendered.includes("### Authorized third-party sends"));
});

// ---------------------------------------------------------------------------
// Corrective-turn guidance (both spawn shapes)
// ---------------------------------------------------------------------------

const RETRY_CTX = {
  sharedProcess: false,
  sessionId: SESSION_ID,
  stagingDir: STAGING_DIR,
  skillsDir: SKILLS_ROOT,
} as const;

for (const agentType of ["opencode", "omp"] as const) {
  Deno.test(`retry - email corrective turn (${agentType}) has no reaction guidance`, () => {
    const strategy = getRetryPromptStrategy(agentType, { ...RETRY_CTX, email: true }, undefined);
    assertEquals(strategy.maxRetries, 1);
    // The supported literal send-reply recipe and the send-file document remain.
    assertStringIncludes(strategy.retryPromptMessage, "send-reply.ts");
    assertStringIncludes(strategy.retryPromptMessage, "# Send File Skill");
    assertStringIncludes(strategy.retryPromptMessage, `${STAGING_DIR}/reply.md`);
    // No unsupported reaction/edit material is read or rendered.
    assertFalse(strategy.retryPromptMessage.includes("# React Message Skill"));
    assertFalse(strategy.retryPromptMessage.includes("react-message"));
    assertFalse(strategy.retryPromptMessage.includes("edit-reply"));
    // Submission/uncertainty evidence forbids another send.
    assertStringIncludes(strategy.retryPromptMessage, "do NOT send again");
    assertStringIncludes(strategy.retryPromptMessage, "outcome is unknown");
    assertStringIncludes(strategy.retryPromptMessage, "Never write a signature");
  });

  Deno.test(`retry - ordinary platform keeps the full prompt (${agentType})`, () => {
    const strategy = getRetryPromptStrategy(agentType, RETRY_CTX, undefined);
    assertStringIncludes(strategy.retryPromptMessage, "# React Message Skill");
    assertStringIncludes(strategy.retryPromptMessage, "# Send Reply Skill");
    assertStringIncludes(strategy.retryPromptMessage, "# Send File Skill");
  });
}

// ---------------------------------------------------------------------------
// Hidden-skill policy (input to the ACP gate)
// ---------------------------------------------------------------------------

Deno.test("policy - only an email request with a grant exposes send-email", () => {
  assertEquals(
    hiddenEmailSkillsFor({ platform: "email" }, 0),
    EMAIL_HIDDEN_SKILLS,
  );
  assertEquals(hiddenEmailSkillsFor({ platform: "email" }, 2), undefined);
  assertEquals(
    hiddenEmailSkillsFor({ platform: "email", emailReminder: { reminderId: "r1" } }, 1),
    EMAIL_HIDDEN_SKILLS,
  );
  assertEquals(
    hiddenEmailSkillsFor({ platform: "email", emailSpontaneous: { tickId: "t1" } }, 1),
    EMAIL_HIDDEN_SKILLS,
  );
  assertEquals(hiddenEmailSkillsFor({ platform: "discord" }, 0), undefined);
});

// ---------------------------------------------------------------------------
// ACP permission gate: registered skill call + direct script, both backends
// ---------------------------------------------------------------------------

const createTestLogger = (): Logger => new Logger("test", { level: LogLevel.FATAL });

function fixtureRoot(scriptSkills: string[]): string {
  const root = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-guidance-skills-" }));
  for (const name of scriptSkills) {
    Deno.mkdirSync(`${root}/${name}/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${root}/${name}/SKILL.md`, `# ${name}`);
    Deno.writeTextFileSync(`${root}/${name}/scripts/${name}.ts`, "#!/usr/bin/env deno\n");
  }
  return root;
}

function registryWithEmailSkill(workspaceRoot: string): SkillRegistry {
  const workspaceManager = new WorkspaceManager({
    repoPath: workspaceRoot,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {});
  return new SkillRegistry(
    memoryStore,
    undefined,
    undefined,
    undefined,
    undefined,
    { mailService: {} as unknown as EmailComposeMailService },
  );
}

function permissionRequest(
  sessionId: string,
  toolCall: acp.ToolCall,
): acp.RequestPermissionRequest {
  return {
    sessionId,
    toolCall,
    options: [
      { kind: "allow_once", optionId: "allow-1", name: "Allow once" },
      { kind: "reject_once", optionId: "reject-1", name: "Reject once" },
    ],
  };
}

function skillCall(skill: string): acp.ToolCall {
  return {
    title: skill,
    status: "pending" as const,
    rawInput: { skill },
    content: [],
    toolCallId: `tc-${skill}`,
  };
}

function execCall(command: string): acp.ToolCall {
  return {
    title: "Execute shell command",
    kind: "execute",
    status: "pending" as const,
    content: [],
    toolCallId: "tc-exec",
    rawInput: { commands: [command] },
  };
}

async function verdict(
  client: ChatbotClient,
  sessionId: string,
  toolCall: acp.ToolCall,
): Promise<string> {
  const response = await client.requestPermission(permissionRequest(sessionId, toolCall));
  return response.outcome.outcome === "selected" ? response.outcome.optionId : "none";
}

for (const agentType of ["opencode", "omp"] as const) {
  Deno.test(`gate - hidden send-email is denied in both invocation shapes (${agentType})`, async () => {
    const tempDir = Deno.makeTempDirSync();
    try {
      const root = fixtureRoot(["send-email", "memory-save"]);
      const registry = registryWithEmailSkill(tempDir);
      const inventory = buildSkillAutoApproveList({
        rootObservation: observeTrustedSkillsRoot(agentType, root),
      });
      const config: ClientConfig = {
        workingDir: tempDir,
        platform: "email",
        userId: OWNER,
        channelId: `mail:${OWNER}:rec1`,
        isDM: true,
        agentType,
        sessionId: SESSION_ID,
        hiddenSkills: EMAIL_HIDDEN_SKILLS, // Client-level config hides send-email
      };
      const client = new ChatbotClient(registry, createTestLogger(), config, inventory);
      client.setSessionContext(SESSION_ID, {
        cwd: tempDir,
        shellSessionId: SESSION_ID,
        hiddenSkills: EMAIL_HIDDEN_SKILLS,
      });
      // A second, grant-bearing session on the SAME client hides nothing.
      client.setSessionContext("sess_granted", {
        cwd: tempDir,
        shellSessionId: "sess_granted",
        hiddenSkills: undefined, // Per-session hides nothing: must override client config!
      });
      client.setSessionContext("sess_yolo_hidden", {
        cwd: tempDir,
        shellSessionId: "sess_yolo_hidden",
        hiddenSkills: EMAIL_HIDDEN_SKILLS,
        yolo: true, // YOLO mode must NOT bypass hidden skill enforcement!
      });

      // Registered-skill shape.
      assertEquals(await verdict(client, SESSION_ID, skillCall("send-email")), "reject-1");
      assertEquals(await verdict(client, "sess_yolo_hidden", skillCall("send-email")), "reject-1");
      assertEquals(await verdict(client, "sess_granted", skillCall("send-email")), "allow-1");
      // Unrelated skills are unaffected.
      assertEquals(await verdict(client, SESSION_ID, skillCall("memory-save")), "allow-1");

      // Direct/interpreted script shape.
      const command = `deno run --allow-net ${root}/send-email/scripts/send-email.ts ` +
        `--session-id ${SESSION_ID}`;
      assertEquals(await verdict(client, SESSION_ID, execCall(command)), "reject-1");
      assertEquals(await verdict(client, "sess_yolo_hidden", execCall(command)), "reject-1");
      assertEquals(await verdict(client, "sess_granted", execCall(command)), "allow-1");
      // The rejection is recorded with its own cause, not a generic one.
      assertEquals(
        client.getRecentPermissionRejections().some((r) => r.reason === "rejected_hidden_skill"),
        true,
      );

      // Approval-only options list fails closed to cancelled when hidden
      const noRejectReq: acp.RequestPermissionRequest = {
        sessionId: SESSION_ID,
        toolCall: skillCall("send-email"),
        options: [
          { kind: "allow_once", optionId: "allow-only", name: "Allow" },
        ],
      };
      assertEquals(
        (await client.requestPermission(noRejectReq)).outcome.outcome,
        "cancelled",
      );
    } finally {
      Deno.removeSync(tempDir, { recursive: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Orchestrator wiring smoke: real templates, registry, gate config, retry
// ---------------------------------------------------------------------------

interface RecordedConnector {
  connector: AgentConnector;
  prompts: string[];
  clientConfig: ClientConfig;
}

class RecordingConnector {
  readonly prompts: string[] = [];
  readonly clientConfig: ClientConfig;
  private connected = false;
  constructor(options: AgentConnectorOptions) {
    this.clientConfig = options.clientConfig as ClientConfig;
  }
  get isConnected(): boolean {
    return this.connected;
  }
  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }
  getProcessPid(): number | undefined {
    return undefined;
  }
  supportsImageContent(): boolean {
    return false;
  }
  createSession(): Promise<string> {
    return Promise.resolve("acp-session-1");
  }
  setSessionModel(): Promise<void> {
    return Promise.resolve();
  }
  setSessionMode(): Promise<void> {
    return Promise.resolve();
  }
  setReasoningEffort(): Promise<string> {
    return Promise.resolve("applied");
  }
  setSessionGateContext(): void {}
  getClient(): null {
    return null;
  }
  prompt(...params: unknown[]): Promise<PromptResponse> {
    // ACP prompts the session with (sessionId, text); record the TEXT.
    this.prompts.push(typeof params[1] === "string" ? params[1] : JSON.stringify(params));
    return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  getProcessEvidence(): AgentProcessEvidence {
    return { generations: 0, pid: undefined };
  }
}

class RecordingOrchestrator extends SessionOrchestrator {
  recorded: RecordedConnector[] = [];
  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    const connector = new RecordingConnector(options);
    this.recorded.push({
      connector: connector as unknown as AgentConnector,
      prompts: connector.prompts,
      clientConfig: connector.clientConfig,
    });
    return connector as unknown as AgentConnector;
  }
}

class MockPlatformAdapter {
  capabilities: PlatformCapabilities = {
    canFetchHistory: false,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: false,
    supportsReactions: false,
    maxMessageLength: 20000,
  };
  constructor(readonly platform: string) {}
  sendReply(): Promise<ReplyResult> {
    return Promise.resolve({ success: true, messageId: "mock_1" });
  }
  fetchRecentMessages(): Promise<PlatformMessage[]> {
    return Promise.resolve([]);
  }
  getUsername(userId: string): Promise<string> {
    return Promise.resolve(`user_${userId}`);
  }
  isSelf(): boolean {
    return false;
  }
  onEvent(): void {}
  offEvent(): void {}
  supportsTypingIndicator(): boolean {
    return false;
  }
  sendTyping(): Promise<void> {
    return Promise.resolve();
  }
  hasBotMention(): Promise<boolean> {
    return Promise.resolve(false);
  }
  hasBotReaction(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

function smokeConfig(root: string): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "", token: "", enabled: false },
      email: { enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: join(PROMPTS_DIR, "system_reply.md"),
      skillsDir: SKILLS_ROOT,
      tokenLimit: 20000,
      defaultAgentType: "opencode",
      opencodeApiKey: "test-opencode-key",
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: [],
    conversationSummary: { enabled: false },
  } as unknown as Config;
}

function emailEvent(content: string): NormalizedEvent {
  return {
    platform: "email",
    channelId: `mail:${OWNER}:rec1`,
    userId: OWNER,
    messageId: "msg-1",
    isDm: true,
    guildId: "",
    content,
    timestamp: new Date(),
    emailWork: {
      kind: "email-work",
      workId: "work_1",
      mailboxKey: { fingerprint: "fp", uidValidity: 1, uid: 1 },
      recordId: "rec1",
    },
    emailAuthoredRequest: { authoredText: content, provenanceStatus: "clean" },
  };
}

function discordEvent(): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "discord-channel",
    userId: "discord-user",
    messageId: "msg-d",
    isDm: true,
    guildId: "",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

async function runSmoke(
  options: { event: NormalizedEvent; grant?: DestinationGrant },
): Promise<{
  orchestrator: RecordingOrchestrator;
  prompts: string[];
  clientConfig: ClientConfig;
  dispose: () => Promise<void>;
}> {
  const root = await Deno.makeTempDir({ prefix: "email-tool-guidance-smoke-" });
  const config = smokeConfig(root);
  const workspaceManager = new WorkspaceManager(config.workspace);
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);
  const sessionRegistry = new SessionRegistry();
  const assembler = new ContextAssembler(memoryStore, {
    systemPromptPath: config.agent.systemPromptPath,
    skillsDir: SKILLS_ROOT,
    recentMessageLimit: 20,
    tokenLimit: 20000,
  });
  const orchestrator = new RecordingOrchestrator(
    workspaceManager,
    assembler,
    skillRegistry,
    config,
    sessionRegistry,
    memoryStore,
  );
  orchestrator.setEmailDestinationGrantPreflight({
    derive: () =>
      Promise.resolve(
        options.grant === undefined
          ? { decision: "none" as const }
          : { decision: "grant" as const, grants: [options.grant] },
      ),
  } as unknown as EmailDestinationGrantPreflight);
  await orchestrator.processMessage(
    options.event,
    new MockPlatformAdapter(options.event.platform) as unknown as PlatformAdapter,
  );
  sessionRegistry.stop();
  const recorded = orchestrator.recorded[0];
  assert(recorded, "the session must have created a connector");
  return {
    orchestrator,
    prompts: recorded.prompts,
    clientConfig: recorded.clientConfig,
    dispose: async () => {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("wiring - granted email request renders grants and keeps send-email visible", async () => {
  const smoke = await runSmoke({
    event: emailEvent(`Send a note to friend@example.org saying hello`),
    grant: { ...EMAIL_GRANT, sessionId: "unused", workId: "work_1" },
  });
  try {
    assertEquals(smoke.prompts.length, 2, "main turn + email corrective turn");
    const main = smoke.prompts[0];
    assertStringIncludes(main, "## Email Session Capabilities");
    assertStringIncludes(main, "grant_1");
    assertStringIncludes(main, "friend@example.org");
    assertStringIncludes(main, "/compose.json");
    assertStringIncludes(main, "--grant-id");
    assertStringIncludes(main, "--session-id");
    assertFalse(main.includes(SIGNATURE_SENTINEL));
    // The corrective turn is the email contract, never the generic one.
    assertFalse(smoke.prompts[1].includes("react-message"));
    assertEquals(smoke.clientConfig.hiddenSkills, undefined);
  } finally {
    await smoke.dispose();
  }
});

Deno.test("wiring - ungranted email session hides send-email from the gate", async () => {
  const smoke = await runSmoke({
    event: emailEvent("Hello bot, what is the weather?"),
  });
  try {
    assertEquals(smoke.prompts.length, 2);
    assertStringIncludes(smoke.prompts[0], "`send-email` is not available in this session");
    assertEquals(smoke.clientConfig.hiddenSkills, EMAIL_HIDDEN_SKILLS);
    assertFalse(smoke.prompts[1].includes("# React Message Skill"));
  } finally {
    await smoke.dispose();
  }
});

Deno.test("wiring - ordinary Discord session keeps its prompts and hides nothing", async () => {
  const smoke = await runSmoke({ event: discordEvent() });
  try {
    assertEquals(smoke.prompts.length, 2);
    assertFalse(smoke.prompts[0].includes("## Email Session Capabilities"));
    assertStringIncludes(smoke.prompts[0], 'You may also use skill({ name: "react-message" })');
    assertStringIncludes(smoke.prompts[1], "# React Message Skill");
    assertEquals(smoke.clientConfig.hiddenSkills, undefined);
  } finally {
    await smoke.dispose();
  }
});
