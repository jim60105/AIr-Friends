import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import * as acp from "@agentclientprotocol/sdk";
import { ChatbotClient, type SessionGateContext } from "@acp/client.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { TrustedSkillsSource } from "@acp/filesystem-policy.ts";
import type { CriticalSkillReference } from "@acp/filesystem-roots.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { SessionAuditWriter } from "@core/audit-logger.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { createFilesystemTestCalls } from "./filesystem-test-calls.ts";

interface FilesystemFixture {
  base: string;
  workspace: string;
  shared: string;
  staging: string;
  skills: string;
  sibling: string;
  instruction: string;
  client: ChatbotClient;
  register: (context?: Partial<SessionGateContext>) => void;
  mint: () => void;
  trusted: TrustedSkillsSource;
  contentCalls: string[];
  reference: { -readonly [K in keyof CriticalSkillReference]: CriticalSkillReference[K] };
}

function fixture(beforeOpen?: (path: string) => void): FilesystemFixture {
  const base = Deno.makeTempDirSync();
  const workspace = join(base, "workspace");
  const shared = join(workspace, "shared");
  const staging = join(workspace, "tmp", "skill-1");
  const skills = join(base, "owned-skills");
  const sibling = join(base, "workspace-sibling");
  for (const path of [workspace, shared, staging, skills, sibling]) {
    Deno.mkdirSync(path, { recursive: true });
  }
  const instruction = join(skills, "SKILL.md");
  Deno.writeTextFileSync(instruction, "owned instruction");
  const logger = new Logger("test", { level: LogLevel.FATAL });
  const registry = new SkillRegistry(
    new MemoryStore(
      new WorkspaceManager({
        repoPath: base,
        workspacesDir: "workspaces",
      }),
      {},
    ),
  );
  const calls = createFilesystemTestCalls(beforeOpen);
  const contentCalls: string[] = [];
  const client = new ChatbotClient(registry, logger, {
    workingDir: workspace,
    platform: "discord",
    userId: "u",
    channelId: "c",
    isDM: false,
    agentWorkspacePath: shared,
    nativeCalls: {
      ...calls,
      read: (fd, buffer) => {
        contentCalls.push("read");
        return calls.read(fd, buffer);
      },
      write: (fd, buffer) => {
        contentCalls.push("write");
        return calls.write(fd, buffer);
      },
      ftruncate: (fd, length) => {
        contentCalls.push("truncate");
        return calls.ftruncate(fd, length);
      },
    },
  });
  const register = (context: Partial<SessionGateContext> = {}) => {
    client.setSessionContext("acp-1", { cwd: workspace, shellSessionId: "skill-1", ...context });
  };
  const reference: FilesystemFixture["reference"] = {
    skillId: "send-reply",
    canonicalInstructionPath: instruction,
    sessionGenerationId: "",
    source: "deployment_owned",
  };
  // Stands in for the deployment-owned trusted-provenance producer: binds the critical
  // reference to the generation the client assigns at the next registration. The value is
  // obtained from the client (never fabricated), so a fresh client instance — a reconnect —
  // cannot admit it.
  const mint = () => {
    reference.sessionGenerationId = client.nextRegistrationGeneration();
  };
  const trusted: TrustedSkillsSource = {
    ownedRootPath: skills,
    canonicalOwnedRootPath: skills,
    source: "deployment_owned",
    criticalSkills: [reference],
  };
  return {
    base,
    workspace,
    shared,
    staging,
    skills,
    sibling,
    instruction,
    client,
    register,
    mint,
    trusted,
    contentCalls,
    reference,
  };
}

function permission(path: string, kind: "edit" | "read" = "edit"): acp.RequestPermissionRequest {
  return {
    sessionId: "acp-1",
    toolCall: { toolCallId: "t", title: path, kind, locations: [{ path }] },
    options: [
      { kind: "allow_once", optionId: "allow", name: "Allow" },
      { kind: "reject_once", optionId: "reject", name: "Reject" },
    ],
  };
}

async function denied(
  f: FilesystemFixture,
  reason: string,
  operation: () => Promise<unknown>,
) {
  f.client.clearPermissionRejections();
  const count = f.contentCalls.length;
  const error = await assertRejects(operation, acp.RequestError);
  assertEquals(error.message, `Filesystem request denied: ${reason}`);
  assertEquals(f.client.getRecentPermissionRejections().map((item) => item.reason), [reason]);
  assertEquals(f.contentCalls.length, count, "denial must precede all content IO");
}

Deno.test("Filesystem callbacks: physical roles, independent write policy and readback", async () => {
  const f = fixture();
  try {
    f.register();
    const path = join(f.staging, "reply.md");
    await f.client.writeTextFile({
      sessionId: "acp-1",
      path: "$TMPDIR/$SESSION_ID/reply.md",
      content: "定價 $0.435",
    });
    assertEquals(Deno.readTextFileSync(path), "定價 $0.435");
    await f.client.writeTextFile({ sessionId: "acp-1", path, content: "short" });
    assertEquals(Deno.readTextFileSync(path), "short", "overwrite must truncate old content");
    assertEquals((await f.client.readTextFile({ sessionId: "acp-1", path })).content, "short");
    const memory = join(f.workspace, "memory.public.jsonl");
    Deno.writeTextFileSync(memory, "memory");
    assertEquals(
      (await f.client.readTextFile({ sessionId: "acp-1", path: memory })).content,
      "memory",
    );
    const ordinary = join(f.workspace, "notes.md");
    Deno.writeTextFileSync(ordinary, "sentinel");
    await denied(f, "rejected_workspace_write_restricted", () =>
      f.client.writeTextFile({
        sessionId: "acp-1",
        path: ordinary,
        content: "mutated",
      }));
    assertEquals(Deno.readTextFileSync(ordinary), "sentinel");
    const request = await f.client.requestPermission(permission(ordinary));
    assertEquals(request.outcome, { outcome: "selected", optionId: "reject" });
    assertEquals(
      f.client.getRecentPermissionRejections().at(-1)?.reason,
      "rejected_workspace_write_restricted",
    );
    const shared = join(f.shared, "note.md");
    await denied(f, "rejected_agent_workspace_write_unauthorized", () =>
      f.client.writeTextFile({
        sessionId: "acp-1",
        path: shared,
        content: "denied",
      }));
    f.register({ canWriteAgentWorkspace: true });
    await f.client.writeTextFile({ sessionId: "acp-1", path: shared, content: "shared" });
    assertEquals(Deno.readTextFileSync(shared), "shared");
    assertEquals(
      (await f.client.readTextFile({ sessionId: "acp-1", path: shared })).content,
      "shared",
    );
    for (const extensions of [[".md", ".txt"], []]) {
      f.register({ canWriteAgentWorkspace: true, allowedWriteExtensions: extensions });
      const script = join(f.shared, "script.ts");
      await denied(f, "rejected_write_extension", () =>
        f.client.writeTextFile({
          sessionId: "acp-1",
          path: script,
          content: "denied",
        }));
      assertEquals((await f.client.requestPermission(permission(script))).outcome, {
        outcome: "selected",
        optionId: "reject",
      });
      assertEquals(
        f.client.getRecentPermissionRejections().at(-1)?.reason,
        "rejected_write_extension",
      );
    }
    const json = join(f.staging, "secret.json");
    Deno.writeTextFileSync(json, "secret content");
    await denied(
      f,
      "rejected_read_extension",
      () => f.client.readTextFile({ sessionId: "acp-1", path: json }),
    );
    f.register({ yolo: true, canWriteAgentWorkspace: false, allowedWriteExtensions: [] });
    for (const path of [join(f.workspace, "script.py"), join(f.shared, "script.py")]) {
      await f.client.writeTextFile({ sessionId: "acp-1", path, content: "yolo" });
      assertEquals(Deno.readTextFileSync(path), "yolo");
    }
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Filesystem callbacks: sibling, escaping/contained links and observation failures", async () => {
  const f = fixture();
  try {
    f.register({ yolo: true });
    const sentinel = join(f.sibling, "sentinel.md");
    Deno.writeTextFileSync(sentinel, "external sentinel");
    const final = join(f.workspace, "final.md");
    const parent = join(f.workspace, "parent");
    Deno.symlinkSync(sentinel, final);
    Deno.symlinkSync(f.sibling, parent);
    for (const path of [sentinel, final, join(parent, "sentinel.md")]) {
      await denied(f, "rejected_write_path_outside_workspace", () =>
        f.client.writeTextFile({
          sessionId: "acp-1",
          path,
          content: "mutated",
        }));
      await denied(
        f,
        "rejected_filesystem_path_unavailable",
        () => f.client.readTextFile({ sessionId: "acp-1", path }),
      );
      assertEquals(Deno.readTextFileSync(sentinel), "external sentinel");
    }
    const contained = join(f.workspace, "contained.md");
    const target = join(f.workspace, "target.md");
    Deno.writeTextFileSync(target, "contained sentinel");
    Deno.symlinkSync(target, contained);
    await denied(
      f,
      "rejected_filesystem_access",
      () => f.client.writeTextFile({ sessionId: "acp-1", path: contained, content: "mutated" }),
    );
    assertEquals(Deno.readTextFileSync(target), "contained sentinel");
    for (const path of [join(f.workspace, "missing.md"), f.workspace, "$OTHER/private.md"]) {
      await denied(
        f,
        "rejected_filesystem_path_unavailable",
        () => f.client.readTextFile({ sessionId: "acp-1", path }),
      );
    }
    f.register({ shellSessionId: "unprovisioned", yolo: false });
    await denied(f, "rejected_filesystem_access", () =>
      f.client.writeTextFile({
        sessionId: "acp-1",
        path: "$TMPDIR/$SESSION_ID/out.md",
        content: "denied",
      }));
    assertEquals(
      await Deno.lstat(join(f.workspace, "tmp", "unprovisioned")).catch(() => null),
      null,
    );
    await denied(
      f,
      "rejected_filesystem_context",
      () => f.client.writeTextFile({ sessionId: "unknown", path: sentinel, content: "denied" }),
    );
    await denied(
      f,
      "rejected_filesystem_context",
      () => f.client.readTextFile({ sessionId: "unknown", path: target }),
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Trusted skills: root-wide reads require canonical current-generation critical provenance", async () => {
  for (const mode of [false, true]) {
    const f = fixture();
    try {
      f.mint();
      f.register({ yolo: mode, trustedSkills: f.trusted });
      const script = join(f.skills, "helper.ts");
      Deno.writeTextFileSync(script, "owned helper");
      assertEquals(
        (await f.client.readTextFile({ sessionId: "acp-1", path: script })).content,
        "owned helper",
      );
      await denied(
        f,
        "rejected_trusted_skills_read_only",
        () => f.client.writeTextFile({ sessionId: "acp-1", path: script, content: "mutated" }),
      );
      assertEquals(Deno.readTextFileSync(script), "owned helper");
      if (!mode) {
        assertEquals((await f.client.requestPermission(permission(script, "read"))).outcome, {
          outcome: "selected",
          optionId: "allow",
        });
      }
      // The same references under a new registration are stale and never fall back.
      f.register({ trustedSkills: f.trusted });
      await denied(
        f,
        "rejected_trusted_skills_identity",
        () => f.client.readTextFile({ sessionId: "acp-1", path: script }),
      );
    } finally {
      Deno.removeSync(f.base, { recursive: true });
    }
  }
  for (const failure of ["source", "root", "instruction", "overlap", "stale", "absent"] as const) {
    const f = fixture();
    try {
      f.mint();
      const provenance: TrustedSkillsSource = {
        ...f.trusted,
        criticalSkills: f.trusted.criticalSkills.map((reference) => ({
          ...reference,
          source: failure === "source" ? "workspace_project" : reference.source,
          sessionGenerationId: failure === "stale" ? "stale" : reference.sessionGenerationId,
          canonicalInstructionPath: failure === "instruction"
            ? join(f.skills, "missing.md")
            : reference.canonicalInstructionPath,
        })),
        canonicalOwnedRootPath: failure === "root" ? f.sibling : f.skills,
        ownedRootPath: failure === "overlap" ? f.workspace : f.skills,
      };
      f.register({ trustedSkills: failure === "absent" ? undefined : provenance });
      await denied(
        f,
        failure === "absent"
          ? "rejected_filesystem_path_unavailable"
          : "rejected_trusted_skills_identity",
        () => f.client.readTextFile({ sessionId: "acp-1", path: f.instruction }),
      );
      assertEquals((await f.client.requestPermission(permission(f.instruction, "read"))).outcome, {
        outcome: "selected",
        optionId: "reject",
      });
    } finally {
      Deno.removeSync(f.base, { recursive: true });
    }
  }
});

Deno.test("Trusted permission classification denies HOME copies, workspace names and escaping links", async () => {
  const f = fixture();
  try {
    f.mint();
    f.register({ trustedSkills: f.trusted });
    const copy = join(f.workspace, "SKILL.md");
    Deno.writeTextFileSync(copy, "unowned");
    const escape = join(f.skills, "escape.md");
    Deno.symlinkSync(copy, escape);
    for (
      const path of [
        copy,
        escape,
        join(Deno.env.get("HOME") ?? f.base, ".agents/skills/send-reply/SKILL.md"),
      ]
    ) {
      assertEquals((await f.client.requestPermission(permission(path, "read"))).outcome, {
        outcome: "selected",
        optionId: "reject",
      });
    }
    f.register({ trustedSkills: undefined });
    assertEquals((await f.client.requestPermission(permission(f.instruction, "read"))).outcome, {
      outcome: "selected",
      optionId: "reject",
    });
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Filesystem callbacks: deterministic observed-file replacement denies before truncate", async () => {
  let replaced = false;
  let watched = "";
  const f = fixture((path) => {
    if (!replaced && path === watched) {
      replaced = true;
      Deno.renameSync(path, `${path}.old`);
      Deno.writeTextFileSync(path, "replacement sentinel");
    }
  });
  try {
    f.register();
    watched = join(f.staging, "replace.md");
    Deno.writeTextFileSync(watched, "original sentinel");
    await denied(
      f,
      "rejected_filesystem_access",
      () => f.client.writeTextFile({ sessionId: "acp-1", path: watched, content: "mutated" }),
    );
    assertEquals(replaced, true);
    assertEquals(Deno.readTextFileSync(watched), "replacement sentinel");
    assertEquals(Deno.readTextFileSync(`${watched}.old`), "original sentinel");
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Filesystem registration: immutable policy and revocation while observations await", async () => {
  for (const operation of ["read", "write", "permission-read", "permission-edit"] as const) {
    const f = fixture();
    const original = Deno.realPath;
    try {
      const withProvenance = operation === "permission-read";
      if (withProvenance) f.mint();
      f.register({ trustedSkills: withProvenance ? f.trusted : undefined });
      const path = operation === "permission-read" ? f.instruction : join(f.staging, "file.md");
      Deno.writeTextFileSync(path, "sentinel");
      let revoked = false;
      Deno.realPath = async (value) => {
        const result = await original(value);
        if (!revoked) {
          revoked = true;
          f.register({ canWriteAgentWorkspace: false });
        }
        return result;
      };
      if (operation.startsWith("permission")) {
        assertEquals(
          (await f.client.requestPermission(
            permission(path, operation === "permission-read" ? "read" : "edit"),
          )).outcome,
          { outcome: "selected", optionId: "reject" },
        );
      } else {
        await denied(
          f,
          "rejected_trusted_skills_identity",
          () =>
            operation === "read"
              ? f.client.readTextFile({ sessionId: "acp-1", path })
              : f.client.writeTextFile({ sessionId: "acp-1", path, content: "mutated" }),
        );
      }
      assertEquals(Deno.readTextFileSync(path), "sentinel");
    } finally {
      Deno.realPath = original;
      Deno.removeSync(f.base, { recursive: true });
    }
  }
  const f = fixture();
  try {
    const extensions = [".md"];
    f.mint();
    f.register({
      canWriteAgentWorkspace: true,
      allowedWriteExtensions: extensions,
      trustedSkills: f.trusted,
    });
    extensions.push(".ts");
    f.reference.source = "workspace_project";
    assertEquals(
      (await f.client.readTextFile({ sessionId: "acp-1", path: f.instruction })).content,
      "owned instruction",
    );
    await denied(
      f,
      "rejected_write_extension",
      () =>
        f.client.writeTextFile({
          sessionId: "acp-1",
          path: join(f.shared, "script.ts"),
          content: "denied",
        }),
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Filesystem denial: bounded buffer and exactly-once audit mirroring", async () => {
  const f = fixture();
  try {
    f.register();
    const writer = new SessionAuditWriter(f.base, "discord", "u", "audit", {
      enabled: true,
      retentionDays: 1,
      hashContent: false,
      includedPhases: ["permission_denied"],
    });
    f.client.setAuditWriter(writer);
    const entries: unknown[] = [];
    writer.write = (_phase, data) => {
      entries.push(data);
      return Promise.resolve();
    };
    await denied(f, "rejected_filesystem_path_unavailable", () =>
      f.client.readTextFile({
        sessionId: "acp-1",
        path: "$OTHER/\n" + "x".repeat(500),
      }));
    assertEquals(entries.length, 1);
    const rejection = f.client.getRecentPermissionRejections()[0];
    assertEquals((rejection.commandOrPath?.length ?? 0) <= 200, true);
    assertEquals(rejection.commandOrPath?.includes("\n"), false);
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Filesystem lifecycle: dedicated creation and pooled restore register the actual owner", async () => {
  const f = fixture();
  try {
    const config = { ...f.client["config"], sessionId: "skill-1", canWriteAgentWorkspace: false };
    const connector = new AgentConnector({
      agentConfig: { command: "mock", args: [], cwd: f.workspace },
      clientConfig: config,
      skillRegistry: f.client["skillRegistry"],
      logger: f.client["logger"],
    });
    connector["client"] = f.client;
    let nextSession = "acp-1";
    const connection = {
      newSession: () => Promise.resolve({ sessionId: nextSession }),
      loadSession: () => Promise.resolve({}),
    } as unknown as typeof connector["connection"];
    connector["connection"] = connection;
    connector["capabilities"] = { loadSession: true };
    await connector.createSession([]);
    await f.client.writeTextFile({
      sessionId: "acp-1",
      path: "$TMPDIR/$SESSION_ID/dedicated.md",
      content: "dedicated",
    });
    assertEquals(Deno.readTextFileSync(join(f.staging, "dedicated.md")), "dedicated");
    const otherStaging = join(f.sibling, "tmp", "skill-2");
    Deno.mkdirSync(otherStaging, { recursive: true });
    nextSession = "acp-2";
    await connector.createSession([], f.sibling);
    connector.setSessionGateContext("acp-2", {
      cwd: f.sibling,
      shellSessionId: "skill-2",
      yolo: false,
      canWriteAgentWorkspace: true,
      allowedWriteExtensions: [".txt"],
    });
    connector.disconnect = () => Promise.resolve();
    let restored: ChatbotClient | undefined;
    connector.connect = () => {
      restored = new ChatbotClient(f.client["skillRegistry"], f.client["logger"], config);
      connector["client"] = restored;
      connector["connection"] = connection;
      return Promise.resolve();
    };
    assertEquals(await connector.reconnectAndResumeSession("acp-2", f.sibling, []), true);
    await restored!.writeTextFile({
      sessionId: "acp-2",
      path: "$TMPDIR/$SESSION_ID/restored.md",
      content: "restored",
    });
    assertEquals(Deno.readTextFileSync(join(otherStaging, "restored.md")), "restored");
    assertEquals(await Deno.lstat(join(f.staging, "restored.md")).catch(() => null), null);
    await restored!.writeTextFile({
      sessionId: "acp-2",
      path: join(f.shared, "restored.txt"),
      content: "authorized",
    });
    await assertRejects(
      () =>
        restored!.writeTextFile({
          sessionId: "acp-2",
          path: join(f.shared, "restored.md"),
          content: "denied",
        }),
      acp.RequestError,
      "rejected_write_extension",
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Trusted provenance: generations never repeat across re-registration or reconnect", async () => {
  const f = fixture();
  try {
    const config = { ...f.client["config"], sessionId: "skill-1", trustedSkills: f.trusted };
    const connector = new AgentConnector({
      agentConfig: { command: "mock", args: [], cwd: f.workspace },
      clientConfig: config,
      skillRegistry: f.client["skillRegistry"],
      logger: f.client["logger"],
    });
    connector["client"] = f.client;
    const connection = {
      loadSession: () => Promise.resolve({}),
    } as unknown as typeof connector["connection"];
    connector["connection"] = connection;
    connector["capabilities"] = { loadSession: true };

    const script = join(f.skills, "helper.ts");
    Deno.writeTextFileSync(script, "owned helper");

    // Trusted producer mints the reference for the registration the connector is about to
    // perform; that registration is the only one this generation is admitted by.
    f.mint();
    const minted = f.reference.sessionGenerationId;
    connector.setSessionGateContext("acp-1", {
      cwd: f.workspace,
      shellSessionId: "skill-1",
      trustedSkills: f.trusted,
    });
    assertEquals(
      (await f.client.readTextFile({ sessionId: "acp-1", path: script })).content,
      "owned helper",
    );
    assertEquals((await f.client.requestPermission(permission(script, "read"))).outcome, {
      outcome: "selected",
      optionId: "allow",
    });

    // The same references are stale under a re-registration: denied on both paths.
    connector.setSessionGateContext("acp-1", {
      cwd: f.workspace,
      shellSessionId: "skill-1",
      trustedSkills: f.trusted,
    });
    await denied(
      f,
      "rejected_trusted_skills_identity",
      () => f.client.readTextFile({ sessionId: "acp-1", path: script }),
    );
    const staleContentCalls = f.contentCalls.length;
    assertEquals((await f.client.requestPermission(permission(script, "read"))).outcome, {
      outcome: "selected",
      optionId: "reject",
    });
    assertEquals(f.contentCalls.length, staleContentCalls);

    // Reconnect: a fresh client instance replays the cached context verbatim but assigns its
    // own registration generation, so the previously minted reference stays denied.
    const replayed: { session?: string; reference?: string } = {};
    let restored: ChatbotClient | undefined;
    connector.connect = () => {
      restored = new ChatbotClient(f.client["skillRegistry"], f.client["logger"], config);
      connector["client"] = restored;
      connector["connection"] = connection;
      connector["capabilities"] = { loadSession: true };
      connector["replaySessionGateContexts"]();
      const replayedContext = restored["sessionContexts"].get("acp-1");
      replayed.session = replayedContext?.generation;
      replayed.reference = replayedContext?.trustedSkills?.criticalSkills[0]?.sessionGenerationId;
      return Promise.resolve();
    };
    assertEquals(await connector.reconnectAndResumeSession("acp-1", f.workspace, []), true);
    assertEquals(replayed.reference, minted, "replay preserves supplied references verbatim");
    assertEquals(replayed.session === minted, false, "replay never rebinds to the new epoch");

    const replayedContentCalls = f.contentCalls.length;
    restored!.clearPermissionRejections();
    const error = await assertRejects(
      () => restored!.readTextFile({ sessionId: "acp-1", path: script }),
      acp.RequestError,
    );
    assertEquals(error.message, "Filesystem request denied: rejected_trusted_skills_identity");
    assertEquals(
      restored!.getRecentPermissionRejections().map((item) => item.reason),
      ["rejected_trusted_skills_identity"],
    );
    assertEquals((await restored!.requestPermission(permission(script, "read"))).outcome, {
      outcome: "selected",
      optionId: "reject",
    });
    assertEquals(f.contentCalls.length, replayedContentCalls, "replay must not authorize IO");
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});
