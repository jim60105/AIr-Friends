import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import * as acp from "@agentclientprotocol/sdk";
import { ChatbotClient, type SessionGateContext } from "@acp/client.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { TrustedSkillsSource } from "@acp/filesystem-policy.ts";
import { observeOwnedSkills } from "@acp/omp/owned-skills.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { SessionAuditWriter } from "@core/audit-logger.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { createFilesystemTestCalls } from "./filesystem-test-calls.ts";
import { emptySkillList } from "./skill-inventory-fixture.ts";
import {
  decodeDestructiveIntent,
  DESTRUCTIVE_CONFORMANCE_FIXTURES,
  destructiveDenialReason,
  normalizeDestructiveIntent,
} from "@acp/destructive-policy.ts";

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
  /** The shared canonical root observation the connector derives for OMP callbacks. */
  trusted: TrustedSkillsSource;
  contentCalls: string[];
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
  // One owned instruction plus one ordinary owned helper under the shared root.
  const instruction = join(skills, "owned-skill", "SKILL.md");
  Deno.mkdirSync(join(skills, "owned-skill"), { recursive: true });
  Deno.writeTextFileSync(instruction, "owned instruction");
  const helper = join(skills, "helper.ts");
  Deno.writeTextFileSync(helper, "owned helper");
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
  }, emptySkillList());
  const register = (context: Partial<SessionGateContext> = {}) => {
    client.setSessionContext("acp-1", { cwd: workspace, shellSessionId: "skill-1", ...context });
  };
  // The shared canonical root observation the connector derives for OMP callbacks: the
  // real deployment root with its dev/ino identity. The daemon callback contract carries
  // no critical-skill metadata, so none is fabricated here.
  const skillsInfo = Deno.lstatSync(skills);
  const trusted: TrustedSkillsSource = {
    ownedRootPath: skills,
    canonicalOwnedRootPath: skills,
    source: "deployment_owned",
    rootIdentity: { dev: skillsInfo.dev!, ino: skillsInfo.ino! },
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
    trusted,
    contentCalls,
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

Deno.test("Destructive permission routing: complete ACP endpoints only; native patches fail closed", async () => {
  const f = fixture();
  try {
    f.register();
    const source = join(f.staging, "a.md");
    const destination = join(f.staging, "b.md");
    const outside = join(f.sibling, "outside.md");
    for (const path of [source, destination, outside]) Deno.writeTextFileSync(path, "sentinel");
    const request = async (
      kind: "delete" | "move" | "edit",
      rawInput: Record<string, unknown> | undefined,
      paths: string[],
      expectedReason?: string,
      title: string = source,
    ) => {
      f.client.clearPermissionRejections();
      const response = await f.client.requestPermission({
        ...permission(source),
        toolCall: {
          toolCallId: "destructive",
          title,
          kind,
          rawInput,
          locations: paths.map((path) => ({ path })),
        },
      });
      assertEquals(response.outcome, {
        outcome: "selected",
        optionId: expectedReason ? "reject" : "allow",
      });
      assertEquals(
        f.client.getRecentPermissionRejections().map((item) => item.reason),
        expectedReason ? [expectedReason] : [],
      );
      for (const path of [source, destination, outside]) {
        assertEquals(Deno.readTextFileSync(path), "sentinel");
      }
      assertEquals(f.contentCalls, []);
    };
    await request("delete", { path: source }, [source]);
    await request("move", { source, destination }, [source, destination]);
    await request(
      "move",
      { source, destination: outside },
      [source, outside],
      "rejected_write_path_outside_workspace",
    );
    assertEquals(
      f.client.getRecentPermissionRejections()[0].commandOrPath?.startsWith("target[1]:"),
      true,
    );
    await request(
      "delete",
      { path: source, operations: [{ path: outside }] },
      [source],
      "rejected_destructive_incomplete",
    );
    await request(
      "edit",
      { operations: [{ kind: "delete", path: source }, { kind: "delete", path: outside }] },
      [source],
      "rejected_destructive_incomplete",
    );
    await request(
      "edit",
      { edits: [{ path: source }, { path: outside }] },
      [source],
      "rejected_destructive_incomplete",
    );
    await request(
      "edit",
      { patch: "*** Begin Patch\n*** Delete File: " + source },
      [source],
      "rejected_destructive_incomplete",
    );
    await request("delete", undefined, [source], "rejected_destructive_incomplete");
    await request("delete", { path: source }, [], "rejected_destructive_incomplete");
    await request("delete", { path: source }, [source, outside], "rejected_destructive_binding");
    await request("move", { source }, [source], "rejected_destructive_incomplete");
    await request("delete", { path: join(f.staging, "missing", "a.md") }, [
      join(f.staging, "missing", "a.md"),
    ], "rejected_filesystem_path_unavailable");
    await request("move", { source: join(f.staging, "missing", "a.md"), destination }, [
      join(f.staging, "missing", "a.md"),
      destination,
    ], "rejected_filesystem_path_unavailable");
    assertEquals([...Deno.readDirSync(f.staging)].map((entry) => entry.name).sort(), [
      "a.md",
      "b.md",
    ]);
    await request("edit", { path: source, content: "ordinary" }, [source]);
    await request(
      "edit",
      undefined,
      [source],
      "rejected_destructive_incomplete",
      "Delete allowed-looking title",
    );
    f.register({ yolo: true });
    await request("delete", { path: outside }, [outside]);
    await request("edit", { edits: [] }, [source]);
    f.register({ yolo: true, trustedSkills: f.trusted });
    await denied(
      f,
      "rejected_write_path_outside_workspace",
      () => f.client.writeTextFile({ sessionId: "acp-1", path: outside, content: "mutated" }),
    );
    await denied(
      f,
      "rejected_trusted_skills_read_only",
      () => f.client.writeTextFile({ sessionId: "acp-1", path: f.instruction, content: "mutated" }),
    );
    assertEquals(Deno.readTextFileSync(f.instruction), "owned instruction");
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Destructive ACP and mock adapter conformance: same actual callback provenance", async () => {
  const f = fixture();
  try {
    f.register();
    for (const name of ["a.md", "b.md"]) Deno.writeTextFileSync(join(f.staging, name), "sentinel");
    for (const fixture of DESTRUCTIVE_CONFORMANCE_FIXTURES) {
      // Synthetic fixture provenance is NOT conveyed by ACP. Both wire consumers must
      // reject it, rather than trusting metadata supplied by an agent.
      const nativeTool = fixture.input.nativeTool;
      let raw: unknown;
      try {
        raw = JSON.parse(fixture.input.rawInput);
      } catch {
        raw = fixture.input.rawInput;
      }
      if (raw && typeof raw === "object") {
        const record = raw as Record<string, unknown>;
        for (const key of ["path", "source", "destination"]) {
          if (typeof record[key] === "string") record[key] = join(f.staging, record[key]);
        }
      }
      const snapshot = typeof raw === "string" ? raw : JSON.stringify(raw);
      const input = {
        nativeTool,
        rawInput: snapshot,
        executionInputBinding: snapshot,
        parserProvenance: nativeTool === "edit" || nativeTool === "apply_patch"
          ? "unknown" as const
          : "supported_full_parser" as const,
      };
      const decoded = decodeDestructiveIntent(input);
      const locations = fixture.locations.map((path) => join(f.staging, path));
      const normalized = normalizeDestructiveIntent(
        input,
        decoded.targets.map((target) => target.path),
        locations,
      );
      f.client.clearPermissionRejections();
      const response = await f.client.requestPermission({
        ...permission(f.staging),
        toolCall: {
          toolCallId: fixture.id,
          title: "native fixture",
          kind: nativeTool === "apply_patch" ? "edit" : nativeTool,
          rawInput: raw as Record<string, unknown>,
          locations: locations.map((path) => ({ path })),
        },
      });
      assertEquals(response.outcome, {
        outcome: "selected",
        optionId: normalized.ok ? "allow" : "reject",
      }, fixture.id);
      assertEquals(
        f.client.getRecentPermissionRejections().map((item) => item.reason),
        normalized.ok ? [] : [destructiveDenialReason(normalized.reason)],
        fixture.id,
      );
      for (const name of ["a.md", "b.md"]) {
        assertEquals(Deno.readTextFileSync(join(f.staging, name)), "sentinel");
      }
    }
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Destructive denials: one sanitized bounded audit and retry record per request", async () => {
  const f = fixture();
  try {
    f.register();
    const path = join(f.staging, "a.md");
    Deno.writeTextFileSync(path, "sentinel");
    const writer = new SessionAuditWriter(f.base, "discord", "u", "destructive-audit", {
      enabled: true,
      retentionDays: 1,
      hashContent: false,
      includedPhases: ["permission_denied"],
    });
    f.client.setAuditWriter(writer);
    const entries: Record<string, unknown>[] = [];
    writer.write = (_phase, data) => {
      entries.push(data as Record<string, unknown>);
      return Promise.resolve();
    };
    for (const locations of [[], [{ path }, { path: join(f.sibling, "outside") }]]) {
      f.client.clearPermissionRejections();
      const before = entries.length;
      await f.client.requestPermission({
        ...permission(path),
        toolCall: {
          toolCallId: "audit",
          title: "delete\n" + "x".repeat(500),
          kind: "delete",
          rawInput: { path },
          locations,
        },
      });
      const records = f.client.getRecentPermissionRejections();
      assertEquals(records.length, 1);
      assertEquals(entries.length, before + 1);
      assertEquals(entries[before].toolName, records[0].toolName);
      assertEquals(entries[before].reason, records[0].reason);
      assertEquals(records[0].toolName.length <= 200, true);
      assertEquals(records[0].toolName.includes("\n"), false);
      assertEquals(Deno.readTextFileSync(path), "sentinel");
    }
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

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

Deno.test("Trusted skills: the shared canonical root admits root-wide reads and stays read-only", async () => {
  for (const mode of [false, true]) {
    const f = fixture();
    try {
      f.register({ yolo: mode, trustedSkills: f.trusted });
      const script = join(f.skills, "helper.ts");
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
    } finally {
      Deno.removeSync(f.base, { recursive: true });
    }
  }
});

Deno.test("Trusted skills: a mismatching, overlapping or absent root observation never admits", async () => {
  for (const failure of ["root", "identity", "overlap", "absent"] as const) {
    const f = fixture();
    try {
      const workspaceInfo = Deno.lstatSync(f.workspace);
      const provenance: TrustedSkillsSource = failure === "root"
        ? { ...f.trusted, ownedRootPath: f.sibling, canonicalOwnedRootPath: f.sibling }
        : failure === "identity"
        ? { ...f.trusted, rootIdentity: { dev: f.trusted.rootIdentity!.dev, ino: -1 } }
        : failure === "overlap"
        ? {
          ownedRootPath: f.workspace,
          canonicalOwnedRootPath: f.workspace,
          source: "deployment_owned",
          rootIdentity: { dev: workspaceInfo.dev!, ino: workspaceInfo.ino! },
        }
        : f.trusted;
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

Deno.test("OMP connector registration derives the callback root from agentConfig.skillsRoot", async () => {
  const f = fixture();
  try {
    const skillsInfo = Deno.lstatSync(f.skills);
    const conflicting: TrustedSkillsSource = {
      ownedRootPath: f.sibling,
      canonicalOwnedRootPath: f.sibling,
      source: "deployment_owned",
      rootIdentity: { dev: skillsInfo.dev!, ino: skillsInfo.ino! },
    };
    const outside = join(f.sibling, "outside.md");
    Deno.writeTextFileSync(outside, "sibling sentinel");
    const mkConnector = (skillsRoot: { root: string; identity?: { dev: number; ino: number } }) =>
      new AgentConnector({
        agentConfig: { command: "mock", args: [], cwd: f.workspace, skillsRoot },
        clientConfig: { ...f.client["config"], sessionId: "skill-1" },
        skillRegistry: f.client["skillRegistry"],
        logger: f.client["logger"],
        agentType: "omp",
      });

    // A conflicting caller-supplied source must NOT override the shared observation.
    const connector = mkConnector({
      root: f.skills,
      identity: { dev: skillsInfo.dev!, ino: skillsInfo.ino! },
    });
    connector["client"] = f.client;
    connector.setSessionGateContext("acp-1", {
      cwd: f.workspace,
      shellSessionId: "skill-1",
      trustedSkills: conflicting,
    });
    const script = join(f.skills, "helper.ts");
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
    await denied(
      f,
      "rejected_filesystem_path_unavailable",
      () => f.client.readTextFile({ sessionId: "acp-1", path: outside }),
    );

    // An observation without identity is passed through and denied, never widened.
    const identityLess = mkConnector({ root: f.skills });
    identityLess["client"] = f.client;
    identityLess.setSessionGateContext("acp-1", {
      cwd: f.workspace,
      shellSessionId: "skill-1",
      trustedSkills: conflicting,
    });
    const contentCalls = f.contentCalls.length;
    await denied(
      f,
      "rejected_trusted_skills_identity",
      () => f.client.readTextFile({ sessionId: "acp-1", path: f.instruction }),
    );
    assertEquals(f.contentCalls.length, contentCalls);
    assertEquals((await f.client.requestPermission(permission(f.instruction, "read"))).outcome, {
      outcome: "selected",
      optionId: "reject",
    });
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("Trusted permission classification denies workspace copies and escaping links", async () => {
  const f = fixture();
  try {
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
      f.register({ trustedSkills: withProvenance ? f.trusted : undefined });
      const path = operation === "permission-read" ? f.instruction : join(f.staging, "file.md");
      if (!withProvenance) Deno.writeTextFileSync(path, "sentinel");
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
      assertEquals(
        Deno.readTextFileSync(path),
        withProvenance ? "owned instruction" : "sentinel",
      );
    } finally {
      Deno.realPath = original;
      Deno.removeSync(f.base, { recursive: true });
    }
  }
  const f = fixture();
  try {
    const extensions = [".md"];
    f.register({
      canWriteAgentWorkspace: true,
      allowedWriteExtensions: extensions,
      trustedSkills: f.trusted,
    });
    extensions.push(".ts");
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
      agentType: "opencode",
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
      restored = new ChatbotClient(
        f.client["skillRegistry"],
        f.client["logger"],
        config,
        emptySkillList(),
      );
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

// ---------------------------------------------------------------------------
// `align-omp-skill-trust-to-shared-root` 1.1/1.4 — the admitted shared root
// ---------------------------------------------------------------------------

Deno.test("producer - a 775 shared root admits ordinary skills and mints no critical authority", () => {
  const root = Deno.makeTempDirSync({ prefix: "omp-shared-root-" });
  const pinnedDirectory = join(root, "review");
  try {
    const instruction = join(pinnedDirectory, "SKILL.md");
    const helper = join(root, "helper.ts");
    Deno.mkdirSync(pinnedDirectory, { recursive: true });
    Deno.writeTextFileSync(instruction, "planted pinned layout");
    Deno.writeTextFileSync(helper, "ordinary owned helper");
    // The deployment-resolved shared root's posture: non-root-owned,
    // agent-writable AND group/world-writable (the packaged personal tree is
    // `uid 1000:0`, mode 0775).
    for (const path of [root, pinnedDirectory]) Deno.chmodSync(path, 0o775);
    for (const path of [instruction, helper]) Deno.chmodSync(path, 0o664);

    const writable = observeOwnedSkills(
      { ownedSkillRoots: [root] },
      "acp-1",
      "gen-1",
      null,
    )!;
    // Ordinary admission is identity-only: the writable tree is accepted on
    // canonical path, link-free components, real type and identity.
    assertEquals(writable.ownedRootPath, root);
    assertEquals(writable.rootIdentity?.dev !== undefined, true);
    // The planted pinned `review/SKILL.md` layout supplies NO critical
    // authority: the read-only fact is OBSERVED from the root, never asserted.
    assertEquals(writable.criticalSkills.length, 0);

    // Seal the SAME tree (root + pinned directory read-only): the flag follows
    // that observation, so the pinned identifier mints.
    Deno.chmodSync(root, 0o555);
    Deno.chmodSync(pinnedDirectory, 0o555);
    const sealed = observeOwnedSkills({ ownedSkillRoots: [root] }, "acp-1", "gen-1", null)!;
    assertEquals(sealed.criticalSkills.map((reference) => reference.skillId), ["review"]);

    // Retained denials are unchanged by the relaxation: a LINKED root is never
    // admitted (no source, no fallback root), and a LINKED pinned directory
    // cannot satisfy the identifier through an escaping link.
    Deno.chmodSync(root, 0o755);
    Deno.chmodSync(pinnedDirectory, 0o755);
    const linkedParent = Deno.makeTempDirSync({ prefix: "omp-shared-link-" });
    const foreign = Deno.makeTempDirSync({ prefix: "omp-shared-foreign-" });
    try {
      const linked = join(linkedParent, "skills");
      Deno.symlinkSync(root, linked);
      assertEquals(
        observeOwnedSkills({ ownedSkillRoots: [linked] }, "acp-1", "gen-1", null),
        null,
        "a linked root mints no source at all",
      );
      Deno.removeSync(linked);

      const foreignReview = join(foreign, "review");
      Deno.mkdirSync(foreignReview);
      Deno.writeTextFileSync(join(foreignReview, "SKILL.md"), "foreign instruction");
      Deno.removeSync(pinnedDirectory, { recursive: true });
      Deno.symlinkSync(foreignReview, pinnedDirectory);
      const escaped = observeOwnedSkills({ ownedSkillRoots: [root] }, "acp-1", "gen-1", null)!;
      assertEquals(
        escaped.criticalSkills.length,
        0,
        "a linked pinned directory never satisfies the identifier",
      );
    } finally {
      Deno.removeSync(pinnedDirectory, { recursive: true });
      Deno.mkdirSync(pinnedDirectory, { recursive: true });
      Deno.removeSync(linkedParent, { recursive: true });
      Deno.removeSync(foreign, { recursive: true });
    }
  } finally {
    Deno.chmodSync(root, 0o755);
    Deno.chmodSync(pinnedDirectory, 0o755);
    Deno.removeSync(root, { recursive: true });
  }
});
