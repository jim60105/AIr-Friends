// tests/acp/agent-connector-omp-artifacts.test.ts
//
// Connector/mock lifecycle coverage for the current-session OMP bash-artifact
// capability (change `admit-current-omp-bash-artifacts`, task 3.3).
//
// A REAL AgentConnector drives a scripted in-process ACP connection (no
// subprocess, no timers) over a REAL temporary native tree, so the assertions
// cover registration, context merge, sibling isolation, reconnect/load
// re-resolution, prior-epoch revocation and failed discovery.
//
// Evidence limit: this is mock-transport consumer evidence. It says nothing
// about the official OMP binary.

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import * as acp from "@agentclientprotocol/sdk";
import { AgentConnector } from "@acp/agent-connector.ts";
import { ChatbotClient, type SessionGateContext } from "@acp/client.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { createFilesystemTestCalls } from "./filesystem-test-calls.ts";
import { emptySkillList } from "./skill-inventory-fixture.ts";
import { createMockAcpConnection } from "../mocks/mock-acp-connection.ts";

const UUID_A = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const UUID_B = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const UUID_MISSING = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d";
const SKILL_API_ID = "skill-1";
const SPILL = "spill line one\nspill line two\n";

function writeJournal(path: string, uuid: string, cwd: string): void {
  const titleSlot = JSON.stringify({
    type: "title",
    v: 1,
    title: "synthetic",
    updatedAt: "2026-01-02T03-04-05-678Z",
    pad: " ".repeat(24),
  });
  Deno.writeTextFileSync(
    path,
    `${titleSlot}\n${JSON.stringify({ type: "session", version: 3, id: uuid, cwd })}\n`,
  );
}

interface ConnectorFixture {
  readonly base: string;
  readonly workspace: string;
  readonly shared: string;
  readonly staging: string;
  readonly dataRoot: string;
  readonly sessionsRoot: string;
  readonly bucket: string;
  readonly artifactDirFor: (uuid: string) => string;
  readonly journalPathFor: (uuid: string) => string;
  readonly connector: AgentConnector;
  readonly client: ChatbotClient;
  readonly contentCalls: string[];
  readonly scriptNewSession: (sessionId: string) => void;
  readonly contextOf: (sessionId: string) => SessionGateContext | undefined;
  /** Swap the connector's client for a fresh one, as a reconnect does. */
  readonly freshClient: () => ChatbotClient;
}

function connectorFixture(params: {
  mode: "restricted" | "native-yolo";
  agentType?: "omp" | "opencode";
  journalCases?: readonly string[];
  beforeOpen?: (path: string) => void;
}): ConnectorFixture {
  const agentType = params.agentType ?? "omp";
  const base = Deno.makeTempDirSync();
  const workspace = join(base, "workspace");
  const shared = join(workspace, "shared");
  const staging = join(workspace, "tmp", SKILL_API_ID);
  const skills = join(base, "trusted-skills");
  for (const path of [workspace, shared, staging, skills]) {
    Deno.mkdirSync(path, { recursive: true });
  }
  Deno.writeTextFileSync(join(skills, "helper.ts"), "owned helper");

  const dataRoot = join(workspace, "tmp", "omp-agent", params.mode, "xdg-data");
  const sessionsRoot = join(dataRoot, "omp", "sessions");
  const bucket = join(sessionsRoot, "-tmp-workspace");
  Deno.mkdirSync(bucket, { recursive: true });
  const journalNames = new Map<string, string>();
  for (const uuid of params.journalCases ?? [UUID_A, UUID_B]) {
    const name = `2026-01-02T03-04-05-678Z_${uuid}.jsonl`;
    journalNames.set(uuid, name);
    writeJournal(join(bucket, name), uuid, workspace);
    const artifactDir = join(bucket, name.slice(0, -".jsonl".length));
    Deno.mkdirSync(artifactDir, { recursive: true });
    Deno.writeTextFileSync(join(artifactDir, "17.bash.log"), SPILL);
  }

  const logger = new Logger("test", { level: LogLevel.FATAL });
  const registry = new SkillRegistry(
    new MemoryStore(new WorkspaceManager({ repoPath: base, workspacesDir: "workspaces" }), {}),
  );
  const calls = createFilesystemTestCalls(params.beforeOpen);
  const contentCalls: string[] = [];
  const skillsInfo = Deno.lstatSync(skills);
  const clientConfig = {
    workingDir: workspace,
    platform: "discord",
    userId: "u",
    channelId: "c",
    isDM: false,
    sessionId: SKILL_API_ID,
    agentWorkspacePath: shared,
    yolo: params.mode === "native-yolo",
    nativeCalls: {
      ...calls,
      read: (fd: number, buffer: Uint8Array) => {
        contentCalls.push("read");
        return calls.read(fd, buffer);
      },
      write: (fd: number, buffer: Uint8Array) => {
        contentCalls.push("write");
        return calls.write(fd, buffer);
      },
      ftruncate: (fd: number, length: bigint) => {
        contentCalls.push("truncate");
        return calls.ftruncate(fd, length);
      },
    },
  };
  const makeClient = () =>
    new ChatbotClient(registry, logger, { ...clientConfig }, emptySkillList());

  const connector = new AgentConnector({
    agentConfig: {
      command: "true",
      args: [],
      cwd: workspace,
      // The factory-produced mode data root is the connector's only native
      // provenance input.
      env: { XDG_DATA_HOME: dataRoot },
      skillsRoot: {
        root: skills,
        identity: { dev: skillsInfo.dev!, ino: skillsInfo.ino! },
      },
    },
    clientConfig,
    skillRegistry: registry,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    agentType,
    idleTimeoutConfig: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
  });

  let nextSessionId = UUID_A;
  const connection = createMockAcpConnection({
    newSession: { response: undefined, times: 0 },
  });
  // Every `newSession` returns whatever the test last selected.
  connection.connection["newSession"] = (() => {
    connection.calls.push({ method: "newSession", params: undefined });
    return Promise.resolve({ sessionId: nextSessionId, configOptions: [] });
  }) as unknown as (params: never) => Promise<unknown>;
  const client = makeClient();
  connector["connection"] = connection.connection as unknown as typeof connector["connection"];
  connector["client"] = client;
  connector["capabilities"] = { loadSession: true } as typeof connector["capabilities"];

  return {
    base,
    workspace,
    shared,
    staging,
    dataRoot,
    sessionsRoot,
    bucket,
    artifactDirFor: (uuid: string) =>
      join(bucket, (journalNames.get(uuid) ?? "").slice(0, -".jsonl".length)),
    journalPathFor: (uuid: string) => join(bucket, journalNames.get(uuid) ?? ""),
    connector,
    client,
    contentCalls,
    scriptNewSession: (sessionId: string) => {
      nextSessionId = sessionId;
    },
    contextOf: (sessionId: string) => connector["sessionGateContexts"].get(sessionId),
    freshClient: () => {
      const fresh = makeClient();
      connector["client"] = fresh;
      connector["connection"] = connection.connection as unknown as typeof connector["connection"];
      return fresh;
    },
  };
}

Deno.test("OMP connector: new-session registration carries provenance and reads its own spill", async () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    const f = connectorFixture({ mode });
    try {
      const sessionId = await f.connector.createSession([]);
      assertEquals(sessionId, UUID_A);
      const registered = f.contextOf(UUID_A);
      assertEquals(registered?.ompNativeState?.cwd, f.workspace);
      assertEquals(registered?.ompNativeState?.nativeDataRoot, f.dataRoot);
      assertEquals(
        registered?.ompNativeState?.artifacts?.journalPath,
        f.journalPathFor(UUID_A),
        mode,
      );
      assertEquals(
        (await f.client.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        })).content,
        SPILL,
        mode,
      );
      // Writes and permissions stay denied in both modes.
      await assertRejects(
        () =>
          f.client.writeTextFile({
            sessionId: UUID_A,
            path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
            content: "mutated",
          }),
        acp.RequestError,
        "Filesystem request denied: rejected_omp_native_state",
        mode,
      );
      assertEquals(Deno.readTextFileSync(join(f.artifactDirFor(UUID_A), "17.bash.log")), SPILL);
    } finally {
      Deno.removeSync(f.base, { recursive: true });
    }
  }
});

Deno.test("OMP connector: a later full re-registration keeps the proven provenance", async () => {
  const f = connectorFixture({ mode: "restricted" });
  try {
    await f.connector.createSession([]);
    const before = f.client["sessionContexts"].get(UUID_A)?.generation;
    // The orchestrator's per-session registration supplies no provenance; the
    // connector's merge retains the proven one and rebinds the generation.
    f.connector.setSessionGateContext(UUID_A, {
      cwd: f.workspace,
      shellSessionId: SKILL_API_ID,
      yolo: false,
      canWriteAgentWorkspace: false,
      allowedWriteExtensions: [".md"],
    });
    const after = f.client["sessionContexts"].get(UUID_A)?.generation;
    assertEquals(after !== before, true);
    assertEquals(
      f.contextOf(UUID_A)?.ompNativeState?.artifacts?.journalPath,
      f.journalPathFor(UUID_A),
    );
    assertEquals(
      (await f.client.readTextFile({
        sessionId: UUID_A,
        path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
      })).content,
      SPILL,
    );
    // A re-registration that MOVES the session drops the old provenance instead
    // of carrying it into the new cwd.
    const moved = join(f.base, "moved-workspace");
    Deno.mkdirSync(moved, { recursive: true });
    f.connector.setSessionGateContext(UUID_A, { cwd: moved, shellSessionId: SKILL_API_ID });
    assertEquals(f.client["sessionContexts"].get(UUID_A)?.ompNativeState, undefined);
    await assertRejects(
      () =>
        f.client.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: sibling sessions on one connection stay isolated", async () => {
  const f = connectorFixture({ mode: "native-yolo" });
  try {
    await f.connector.createSession([]);
    f.scriptNewSession(UUID_B);
    await f.connector.createSession([]);
    for (const [reader, other] of [[UUID_A, UUID_B], [UUID_B, UUID_A]] as const) {
      assertEquals(
        (await f.client.readTextFile({
          sessionId: reader,
          path: join(f.artifactDirFor(reader), "17.bash.log"),
        })).content,
        SPILL,
        reader,
      );
      await assertRejects(
        () =>
          f.client.readTextFile({
            sessionId: reader,
            path: join(f.artifactDirFor(other), "17.bash.log"),
          }),
        acp.RequestError,
        "Filesystem request denied: rejected_omp_native_state",
        reader,
      );
      // A sibling journal is denied too, even though it ends in `.jsonl`.
      await assertRejects(
        () => f.client.readTextFile({ sessionId: reader, path: f.journalPathFor(other) }),
        acp.RequestError,
        "Filesystem request denied: rejected_omp_native_state",
        reader,
      );
    }
    assertEquals(Deno.readTextFileSync(join(f.artifactDirFor(UUID_B), "17.bash.log")), SPILL);
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: failed optional discovery keeps the session usable", async () => {
  const f = connectorFixture({ mode: "restricted" });
  try {
    f.scriptNewSession(UUID_MISSING);
    const sessionId = await f.connector.createSession([]);
    assertEquals(sessionId, UUID_MISSING);
    const registered = f.contextOf(UUID_MISSING);
    // The reservation is attached even when discovery proves nothing.
    assertEquals(registered?.ompNativeState?.cwd, f.workspace);
    assertEquals(registered?.ompNativeState?.nativeDataRoot, f.dataRoot);
    assertEquals(registered?.ompNativeState?.artifacts, undefined);
    await assertRejects(
      () =>
        f.client.readTextFile({
          sessionId: UUID_MISSING,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
      "Filesystem request denied: rejected_omp_native_state",
    );
    // Unrelated operations are unaffected (the session is still available).
    const memory = join(f.workspace, "memory.public.jsonl");
    Deno.writeTextFileSync(memory, "memory");
    assertEquals(
      (await f.client.readTextFile({ sessionId: UUID_MISSING, path: memory })).content,
      "memory",
    );
    await f.client.writeTextFile({
      sessionId: UUID_MISSING,
      path: "$TMPDIR/$SESSION_ID/reply.md",
      content: "staged",
    });
    assertEquals(Deno.readTextFileSync(join(f.staging, "reply.md")), "staged");
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: disconnect revokes prior-epoch artifact authority and replay denies", async () => {
  const f = connectorFixture({ mode: "native-yolo" });
  try {
    await f.connector.createSession([]);
    assertEquals(
      f.contextOf(UUID_A)?.ompNativeState?.artifacts !== undefined,
      true,
    );
    await f.connector.disconnect();
    // The cached context keeps the reservation but loses artifact authority.
    const cached = f.contextOf(UUID_A);
    assertEquals(cached?.ompNativeState?.artifacts, undefined);
    assertEquals(cached?.ompNativeState?.nativeDataRoot, f.dataRoot);
    // A reconnect replays context identity onto a fresh client, never artifact
    // authority from the discarded epoch.
    const fresh = f.freshClient();
    f.connector["replaySessionGateContexts"]();
    await assertRejects(
      () =>
        fresh.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
      "Filesystem request denied: rejected_omp_native_state",
    );
    const memory = join(f.workspace, "memory.public.jsonl");
    Deno.writeTextFileSync(memory, "memory");
    assertEquals(
      (await fresh.readTextFile({ sessionId: UUID_A, path: memory })).content,
      "memory",
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: a successful session/load re-resolves fresh provenance", async () => {
  const f = connectorFixture({ mode: "restricted" });
  try {
    await f.connector.createSession([]);
    const oldJournal = f.journalPathFor(UUID_A);
    const oldArtifact = join(f.artifactDirFor(UUID_A), "17.bash.log");
    // The native runtime now persists the same session elsewhere: move the
    // journal and its artifact directory to a new bucket.
    const movedBucket = join(f.sessionsRoot, "-tmp-workspace-moved");
    Deno.renameSync(f.bucket, movedBucket);
    const newJournal = join(movedBucket, oldJournal.split("/").pop()!);
    const newArtifact = join(
      movedBucket,
      newJournal.split("/").pop()!.slice(0, -".jsonl".length),
      "17.bash.log",
    );

    const reconnect = f.connector;
    reconnect.disconnect = () => Promise.resolve();
    let restored: ChatbotClient | undefined;
    reconnect.connect = () => {
      restored = f.freshClient();
      return Promise.resolve();
    };
    const gateContext: SessionGateContext = {
      cwd: f.workspace,
      shellSessionId: SKILL_API_ID,
      yolo: false,
    };
    assertEquals(
      await reconnect.reconnectAndResumeSession(UUID_A, f.workspace, [], { gateContext }),
      true,
    );
    const provenance = f.contextOf(UUID_A)?.ompNativeState?.artifacts;
    assertEquals(provenance?.journalPath, newJournal);
    assertEquals(provenance?.artifactDirectoryIdentity !== undefined, true);
    // The recovered session reads its CURRENT spill...
    assertEquals(
      (await restored!.readTextFile({ sessionId: UUID_A, path: newArtifact })).content,
      SPILL,
    );
    // ...and the pre-load location no longer carries authority.
    await assertRejects(
      () => restored!.readTextFile({ sessionId: UUID_A, path: oldArtifact }),
      acp.RequestError,
      "Filesystem request denied: rejected_omp_native_state",
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: OpenCode callbacks gain no reservation and keep their outcomes", async () => {
  const f = connectorFixture({ mode: "restricted", agentType: "opencode" });
  try {
    await f.connector.createSession([]);
    assertEquals(f.contextOf(UUID_A)?.ompNativeState, undefined);
    // A `.log` stays denied by the ordinary extension rule, exactly as before.
    await assertRejects(
      () =>
        f.client.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
      "Filesystem request denied: rejected_read_extension",
    );
    // Without a reservation the ordinary workspace rule still applies to the
    // native tree: a `.jsonl` journal stays readable exactly as before, and the
    // reservation is what changes that for OMP contexts.
    assertEquals(
      (await f.client.readTextFile({ sessionId: UUID_A, path: f.journalPathFor(UUID_A) })).content
        .includes('"type":"session"'),
      true,
    );
    // Literal staging still works.
    await f.client.writeTextFile({
      sessionId: UUID_A,
      path: join(f.staging, "reply.md"),
      content: "opencode staged",
    });
    assertEquals(Deno.readTextFileSync(join(f.staging, "reply.md")), "opencode staged");
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: a context replaced mid-observation never authorizes the request", async () => {
  const f = connectorFixture({ mode: "restricted" });
  const originalRealPath = Deno.realPath;
  try {
    await f.connector.createSession([]);
    let revoked = false;
    Deno.realPath = async (value) => {
      const result = await originalRealPath(value);
      if (!revoked) {
        revoked = true;
        f.connector.setSessionGateContext(UUID_A, {
          cwd: f.workspace,
          shellSessionId: SKILL_API_ID,
          yolo: true,
        });
      }
      return result;
    };
    await assertRejects(
      () =>
        f.client.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
      "Filesystem request denied: rejected_trusted_skills_identity",
    );
    assertEquals(revoked, true);
    // The fresh registration still reads its own current session.
    assertEquals(
      (await f.client.readTextFile({
        sessionId: UUID_A,
        path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
      })).content,
      SPILL,
    );
  } finally {
    Deno.realPath = originalRealPath;
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: restricted generic commands keep their per-spawn reach", async () => {
  const f = connectorFixture({ mode: "restricted" });
  try {
    await f.connector.createSession([]);
    const request: acp.RequestPermissionRequest = {
      sessionId: UUID_A,
      toolCall: {
        toolCallId: "cmd",
        title: "bash",
        kind: "execute",
        rawInput: { command: `cat ${f.journalPathFor(UUID_A)}` },
        locations: [],
      },
      options: [
        { kind: "allow_once", optionId: "allow", name: "Allow" },
        { kind: "reject_once", optionId: "reject", name: "Reject" },
      ],
    };
    // The reserved-state guard never applies to the command path: this decision
    // is the unchanged generic-command workspace grant.
    const response = await f.client.requestPermission(request);
    assertEquals(response.outcome.outcome, "selected");
    assertEquals(f.client.getRecentPermissionRejections().length, 0);
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP connector: a disconnect during an in-flight artifact read denies it", async () => {
  const f = connectorFixture({ mode: "restricted" });
  const originalRealPath = Deno.realPath;
  try {
    await f.connector.createSession([]);
    const callsBefore = f.contentCalls.length;
    let disconnected = false;
    Deno.realPath = async (value) => {
      const result = await originalRealPath(value);
      if (!disconnected) {
        disconnected = true;
        // The connection is torn down while the callback is still observing.
        await f.connector.disconnect();
      }
      return result;
    };
    await assertRejects(
      () =>
        f.client.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
      "Filesystem request denied: rejected_trusted_skills_identity",
    );
    assertEquals(disconnected, true);
    // The discarded client read no content, and its registrations are gone.
    assertEquals(f.contentCalls.length, callsBefore);
    assertEquals(f.client["sessionContexts"].size, 0);
    await assertRejects(
      () =>
        f.client.readTextFile({
          sessionId: UUID_A,
          path: join(f.artifactDirFor(UUID_A), "17.bash.log"),
        }),
      acp.RequestError,
      "Filesystem request denied: rejected_filesystem_context",
    );
    assertEquals(f.contentCalls.length, callsBefore);
  } finally {
    Deno.realPath = originalRealPath;
    Deno.removeSync(f.base, { recursive: true });
  }
});
