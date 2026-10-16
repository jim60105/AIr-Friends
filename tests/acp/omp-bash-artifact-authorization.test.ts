// tests/acp/omp-bash-artifact-authorization.test.ts
//
// Consumer regression matrix for the current-session OMP bash-artifact read
// exception (change `admit-current-omp-bash-artifacts`, tasks 3.1/3.2).
//
// Every scenario drives a REAL temporary native tree, the REAL resolver, the
// REAL client gate and the offline native-call model (`createFilesystemTestCalls`)
// that performs descriptor-bound opens on actual file content. Pooled and
// per-spawn data roots are exercised, each crossed with restricted and
// native-YOLO permission, and every denial asserts that no content IO happened
// and that outside/sibling sentinels are byte-identical.
//
// The ACP session id registered here IS the native UUID (`session/new` returns
// the native session id), while the owning Skill API id is a different string.
//
// Evidence limit: this certifies the callback authorization boundary only. It
// says nothing about the native OMP binary, which needs the pinned harness.

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import * as acp from "@agentclientprotocol/sdk";
import { ChatbotClient, type SessionGateContext } from "@acp/client.ts";
import type { TrustedSkillsSource } from "@acp/filesystem-policy.ts";
import type { OmpArtifactProvenance } from "@acp/filesystem-roots.ts";
import { resolveOmpSessionArtifacts } from "@acp/omp/session-artifacts.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { createFilesystemTestCalls } from "./filesystem-test-calls.ts";
import { emptySkillList } from "./skill-inventory-fixture.ts";

const NATIVE_UUID = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const SIBLING_UUID = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const SKILL_API_ID = "skill-1";
const TIMESTAMP_A = "2026-01-02T03-04-05-678Z";
const TIMESTAMP_B = "2026-01-02T03-04-06-678Z";
const SPILL = "line one\nline two\nline three\n";

function journalName(timestamp: string, uuid: string): string {
  return `${timestamp}_${uuid}.jsonl`;
}

function writeJournal(path: string, uuid: string, cwd: string): void {
  const titleSlot = JSON.stringify({
    type: "title",
    v: 1,
    title: "synthetic",
    updatedAt: TIMESTAMP_A,
    pad: " ".repeat(24),
  });
  Deno.writeTextFileSync(
    path,
    `${titleSlot}\n${JSON.stringify({ type: "session", version: 3, id: uuid, cwd })}\n`,
  );
}

interface ArtifactFixture {
  readonly base: string;
  readonly workspace: string;
  readonly siblingWorkspace: string;
  readonly shared: string;
  readonly skills: string;
  readonly dataRoot: string;
  /** The data-root spelling the connector's env would carry. */
  readonly configuredDataRoot: string;
  readonly otherModeRoot: string;
  readonly journalPath: string;
  readonly artifactDir: string;
  readonly siblingArtifactDir: string;
  readonly siblingJournalPath: string;
  readonly nativeAuth: string;
  readonly nativeDatabase: string;
  reservation: SessionGateContext["ompNativeState"];
  readonly client: ChatbotClient;
  readonly contentCalls: string[];
  register: (overrides?: Partial<SessionGateContext>, sessionId?: string) => void;
  /** Re-register a session id that never had native provenance. */
  registerWithoutProvenance: (sessionId: string) => void;
  /**
   * Re-run discovery over the CURRENT tree, as the connector does after a
   * `session/load`, and adopt the result as this fixture's reservation.
   */
  refreshArtifacts: () => Promise<void>;
}

async function artifactFixture(params: {
  pooled: boolean;
  mode: "restricted" | "native-yolo";
  yolo: boolean;
  beforeOpen?: (path: string) => void;
  /**
   * Build the native tree at `{workspace}/native-state` and link
   * `{workspace}/tmp/omp-agent` to it, so the configured state path is a link
   * inside the same workspace.
   */
  nativeStateLink?: boolean;
  /** Register reservation-only provenance, as a failed discovery would. */
  discoveryFails?: boolean;
}): Promise<ArtifactFixture> {
  const base = Deno.makeTempDirSync();
  const workspace = join(base, "workspace");
  const siblingWorkspace = join(base, "workspace-sibling");
  const shared = join(workspace, "shared");
  const staging = join(workspace, "tmp", SKILL_API_ID);
  const skills = join(base, "trusted-skills");
  for (const path of [workspace, siblingWorkspace, shared, staging, skills]) {
    Deno.mkdirSync(path, { recursive: true });
  }
  Deno.writeTextFileSync(join(skills, "helper.ts"), "owned helper");

  // The factory shape: pooled native state lives under the pool key, per-spawn
  // state under the session workspace's own tmp tree.
  const baseRoot = params.nativeStateLink
    ? join(workspace, "native-state")
    : params.pooled
    ? join(base, "omp-pools", "pool-key")
    : join(workspace, "tmp");
  const dataRoot = join(baseRoot, "omp-agent", params.mode, "xdg-data");
  const otherModeRoot = join(
    baseRoot,
    "omp-agent",
    params.mode === "restricted" ? "native-yolo" : "restricted",
    "xdg-data",
  );
  // The configured spelling the factory would hand the connector.
  const configuredDataRoot = params.nativeStateLink
    ? join(workspace, "tmp", "omp-agent", params.mode, "xdg-data")
    : dataRoot;
  const sessionsRoot = join(dataRoot, "omp", "sessions");
  const bucket = join(sessionsRoot, "-tmp-workspace");
  // Same-prefix sibling bucket: a lexically adjacent name must not widen.
  const siblingBucket = join(sessionsRoot, "-tmp-workspace-2");
  const otherModeBucket = join(otherModeRoot, "omp", "sessions", "-tmp-workspace");
  for (const path of [bucket, siblingBucket, otherModeBucket]) {
    Deno.mkdirSync(path, { recursive: true });
  }
  if (params.nativeStateLink === true) {
    // The factory's configured data root is reached through a link inside the
    // workspace; the real tree lives at `{workspace}/native-state`.
    Deno.mkdirSync(join(workspace, "tmp"), { recursive: true });
    Deno.symlinkSync(join(baseRoot, "omp-agent"), join(workspace, "tmp", "omp-agent"));
  }

  const journalPath = join(bucket, journalName(TIMESTAMP_A, NATIVE_UUID));
  writeJournal(journalPath, NATIVE_UUID, workspace);
  const artifactDir = journalPath.slice(0, -".jsonl".length);
  Deno.mkdirSync(artifactDir, { recursive: true });
  Deno.writeTextFileSync(join(artifactDir, "17.bash.log"), SPILL);
  Deno.writeTextFileSync(join(artifactDir, "17.read.log"), "read spill");
  Deno.writeTextFileSync(join(artifactDir, "other.log"), "other");
  Deno.writeTextFileSync(join(artifactDir, "17.bash.log.tmp"), "temp");
  Deno.writeTextFileSync(join(artifactDir, "state.jsonl"), "state sentinel");

  const siblingJournalPath = join(siblingBucket, journalName(TIMESTAMP_B, SIBLING_UUID));
  writeJournal(siblingJournalPath, SIBLING_UUID, siblingWorkspace);
  const siblingArtifactDir = siblingJournalPath.slice(0, -".jsonl".length);
  Deno.mkdirSync(siblingArtifactDir, { recursive: true });
  Deno.writeTextFileSync(join(siblingArtifactDir, "17.bash.log"), "sibling spill");

  // Sibling mode state and the native non-artifact state.
  writeJournal(
    join(otherModeBucket, journalName(TIMESTAMP_B, SIBLING_UUID)),
    SIBLING_UUID,
    workspace,
  );
  const nativeAuth = join(dataRoot, "omp", "auth.json");
  const nativeDatabase = join(dataRoot, "omp", "database.db");
  Deno.writeTextFileSync(nativeAuth, '{"credential":"sentinel"}');
  Deno.writeTextFileSync(nativeDatabase, "database sentinel");
  // A directory named after the Skill API id must never become readable.
  Deno.mkdirSync(join(sessionsRoot, SKILL_API_ID), { recursive: true });
  Deno.writeTextFileSync(join(sessionsRoot, SKILL_API_ID, "17.bash.log"), "skill-id spill");

  const dataInfo = Deno.lstatSync(configuredDataRoot);
  const resolution = await resolveOmpSessionArtifacts({
    agentType: "omp",
    xdgDataHome: configuredDataRoot,
    acpSessionId: NATIVE_UUID,
    sessionCwd: workspace,
    nativeCalls: createFilesystemTestCalls(),
  });
  if (!resolution.ok && params.nativeStateLink !== true) {
    throw new Error(`fixture discovery failed: ${resolution.reason}`);
  }
  const provenance: OmpArtifactProvenance | undefined = resolution.ok && !params.discoveryFails
    ? resolution.provenance
    : undefined;

  const logger = new Logger("test", { level: LogLevel.FATAL });
  const registry = new SkillRegistry(
    new MemoryStore(new WorkspaceManager({ repoPath: base, workspacesDir: "workspaces" }), {}),
  );
  const calls = createFilesystemTestCalls(params.beforeOpen);
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
  const skillsInfo = Deno.lstatSync(skills);

  const fixture: ArtifactFixture = {
    base,
    workspace,
    siblingWorkspace,
    shared,
    skills,
    dataRoot,
    configuredDataRoot,
    otherModeRoot,
    journalPath,
    artifactDir,
    siblingArtifactDir,
    siblingJournalPath,
    nativeAuth,
    nativeDatabase,
    reservation: {
      cwd: workspace,
      nativeDataRoot: configuredDataRoot,
      dataRootIdentity: { dev: dataInfo.dev!, ino: dataInfo.ino! },
      artifacts: provenance,
    },
    client,
    contentCalls,
    register: () => {},
    registerWithoutProvenance: () => {},
    refreshArtifacts: () => Promise.resolve(),
  };

  const trusted: TrustedSkillsSource = {
    ownedRootPath: skills,
    canonicalOwnedRootPath: skills,
    source: "deployment_owned",
    rootIdentity: { dev: skillsInfo.dev!, ino: skillsInfo.ino! },
  };
  fixture.register = (overrides: Partial<SessionGateContext> = {}, sessionId = NATIVE_UUID) => {
    client.setSessionContext(sessionId, {
      cwd: workspace,
      shellSessionId: SKILL_API_ID,
      yolo: params.yolo,
      trustedSkills: trusted,
      ompNativeState: fixture.reservation,
      ...overrides,
    });
  };
  fixture.registerWithoutProvenance = (sessionId: string) => {
    client.setSessionContext(sessionId, {
      cwd: workspace,
      shellSessionId: SKILL_API_ID,
      yolo: params.yolo,
      trustedSkills: trusted,
    });
  };
  fixture.refreshArtifacts = async () => {
    const refreshed = await resolveOmpSessionArtifacts({
      agentType: "omp",
      xdgDataHome: configuredDataRoot,
      acpSessionId: NATIVE_UUID,
      sessionCwd: workspace,
      nativeCalls: createFilesystemTestCalls(),
    });
    if (!refreshed.ok) throw new Error(`fixture rediscovery failed: ${refreshed.reason}`);
    fixture.reservation = {
      cwd: workspace,
      nativeDataRoot: configuredDataRoot,
      dataRootIdentity: fixture.reservation!.dataRootIdentity,
      artifacts: refreshed.provenance,
    };
  };
  return fixture;
}

function permission(path: string, kind: "edit" | "read" | "delete" = "edit") {
  return {
    sessionId: NATIVE_UUID,
    toolCall: { toolCallId: "t", title: path, kind, locations: [{ path }] },
    options: [
      { kind: "allow_once", optionId: "allow", name: "Allow" },
      { kind: "reject_once", optionId: "reject", name: "Reject" },
    ],
  } as acp.RequestPermissionRequest;
}

/** One denial with the exact bounded reason and zero content IO. */
async function denied(
  f: ArtifactFixture,
  reason: string,
  operation: () => Promise<unknown>,
  label?: string,
) {
  f.client.clearPermissionRejections();
  const before = f.contentCalls.length;
  const error = await assertRejects(operation, acp.RequestError, undefined, label);
  assertEquals(error.message, `Filesystem request denied: ${reason}`, label);
  assertEquals(
    f.client.getRecentPermissionRejections().map((item) => item.reason),
    [reason],
    label,
  );
  assertEquals(f.contentCalls.length, before, "denial must precede all content IO");
}

/**
 * One denial whose bounded reason depends on which layer observes a
 * deterministic replacement first (the root observation or the protected
 * opening); both are documented fail-closed denials. Content IO must still be
 * zero.
 */
async function deniedWithReasons(
  f: ArtifactFixture,
  reasons: readonly string[],
  operation: () => Promise<unknown>,
  label?: string,
) {
  f.client.clearPermissionRejections();
  const before = f.contentCalls.length;
  const error = await assertRejects(operation, acp.RequestError, undefined, label);
  const actual = error.message.replace("Filesystem request denied: ", "");
  assertEquals(reasons.includes(actual), true, `${label}: ${actual}`);
  assertEquals(f.contentCalls.length, before, "denial must precede all content IO");
}

Deno.test("OMP artifacts: pooled and per-spawn × restricted and YOLO read the current spill", async () => {
  for (const pooled of [false, true]) {
    for (const mode of ["restricted", "native-yolo"] as const) {
      const label = `${pooled ? "pooled" : "per-spawn"}/${mode}`;
      const f = await artifactFixture({ pooled, mode, yolo: mode === "native-yolo" });
      try {
        f.register();
        // The Skill API id differs from the native UUID, and only the native
        // journal selects the artifact directory.
        const spill = await f.client.readTextFile({
          sessionId: NATIVE_UUID,
          path: join(f.artifactDir, "17.bash.log"),
        });
        assertEquals(spill.content, SPILL, label);
        assertEquals(f.contentCalls.length > 0, true, label);
        // Existing line/limit semantics are unchanged: the client has no
        // windowing, so the whole spill text is returned.
        const windowed = await f.client.readTextFile({
          sessionId: NATIVE_UUID,
          path: join(f.artifactDir, "17.bash.log"),
          line: 2,
          limit: 1,
        });
        assertEquals(windowed.content, SPILL, label);
        // Reading is non-destructive.
        assertEquals(Deno.readTextFileSync(join(f.artifactDir, "17.bash.log")), SPILL, label);

        // The exception is read-only in BOTH modes.
        await denied(f, "rejected_omp_native_state", () =>
          f.client.writeTextFile({
            sessionId: NATIVE_UUID,
            path: join(f.artifactDir, "17.bash.log"),
            content: "mutated",
          }));
        assertEquals(Deno.readTextFileSync(join(f.artifactDir, "17.bash.log")), SPILL, label);

        // Ordinary non-state outcomes stay exactly as before.
        const ordinary = join(f.workspace, "notes.log");
        Deno.writeTextFileSync(ordinary, "ordinary");
        await denied(
          f,
          "rejected_read_extension",
          () => f.client.readTextFile({ sessionId: NATIVE_UUID, path: ordinary }),
        );
        const ordinaryMd = join(f.workspace, "notes.md");
        Deno.writeTextFileSync(ordinaryMd, "ordinary md");
        assertEquals(
          (await f.client.readTextFile({ sessionId: NATIVE_UUID, path: ordinaryMd })).content,
          "ordinary md",
          label,
        );
        // Staging writes are untouched by the reservation.
        await f.client.writeTextFile({
          sessionId: NATIVE_UUID,
          path: "$TMPDIR/$SESSION_ID/reply.md",
          content: "staged",
        });
        assertEquals(
          Deno.readTextFileSync(join(f.workspace, "tmp", SKILL_API_ID, "reply.md")),
          "staged",
        );
      } finally {
        Deno.removeSync(f.base, { recursive: true });
      }
    }
  }
});

Deno.test("OMP artifacts: the exception stays exact and never widens", async () => {
  const f = await artifactFixture({ pooled: false, mode: "native-yolo", yolo: true });
  try {
    f.register();
    const read = (path: string) => f.client.readTextFile({ sessionId: NATIVE_UUID, path });
    await denied(f, "rejected_read_extension", () => read(join(f.artifactDir, "other.log")));
    await denied(f, "rejected_read_extension", () => read(join(f.artifactDir, "17.read.log")));
    await denied(f, "rejected_read_extension", () => read(join(f.artifactDir, "17.bash.log.tmp")));
    await denied(f, "rejected_read_extension", () => read(join(f.artifactDir, "state.jsonl")));
    // The directory itself fails the regular-file expectation before the
    // filename rule is consulted.
    await denied(f, "rejected_filesystem_path_unavailable", () => read(f.artifactDir));
    // A nested child is not a direct child even when the leaf name matches.
    Deno.mkdirSync(join(f.artifactDir, "nested"), { recursive: true });
    Deno.writeTextFileSync(join(f.artifactDir, "nested", "18.bash.log"), "nested");
    await denied(
      f,
      "rejected_filesystem_path_unavailable",
      () => read(join(f.artifactDir, "nested", "18.bash.log")),
    );
    // A same-named symlink inside the artifact directory is rejected.
    const alias = join(f.artifactDir, "99.bash.log");
    Deno.symlinkSync(join(f.siblingArtifactDir, "17.bash.log"), alias);
    await denied(f, "rejected_omp_native_state", () => read(alias));
    assertEquals(Deno.readTextFileSync(join(f.siblingArtifactDir, "17.bash.log")), "sibling spill");
    // Every case above denied before any content IO.
    assertEquals(f.contentCalls.length, 0);
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: sibling sessions, sibling modes and native non-artifact state stay private", async () => {
  for (const pooled of [false, true]) {
    const label = pooled ? "pooled" : "per-spawn";
    const f = await artifactFixture({ pooled, mode: "native-yolo", yolo: true });
    try {
      f.register();
      const cases: Array<[string, string]> = [
        ["sibling session artifact", join(f.siblingArtifactDir, "17.bash.log")],
        ["sibling artifact jsonl", join(f.siblingArtifactDir, "state.jsonl")],
        ["native journal", f.journalPath],
        ["sibling journal", f.siblingJournalPath],
        ["native auth file", f.nativeAuth],
        ["native database", f.nativeDatabase],
        ["sessions directory", join(f.dataRoot, "omp", "sessions")],
        [
          "Skill-API-named directory",
          join(f.dataRoot, "omp", "sessions", SKILL_API_ID, "17.bash.log"),
        ],
      ];
      for (const [name, path] of cases) {
        await denied(
          f,
          "rejected_omp_native_state",
          () => f.client.readTextFile({ sessionId: NATIVE_UUID, path }),
          `${label}: ${name}`,
        );
        // The parent workspace role never authorizes a write there either.
        await denied(
          f,
          "rejected_omp_native_state",
          () => f.client.writeTextFile({ sessionId: NATIVE_UUID, path, content: "mutated" }),
          `${label}: ${name} write`,
        );
      }
      // A sibling MODE's state is outside every callback root for the pooled
      // shape (it sits under the pool key, not the workspace) and inside the
      // reserved per-spawn tree for the per-spawn shape; both deny, with the
      // mapped bounded reason for each shape.
      const siblingMode = join(f.otherModeRoot, "omp", "sessions", "-tmp-workspace");
      const siblingModeJournal = [...Deno.readDirSync(siblingMode)]
        .map((entry) => entry.name)
        .filter((name) => name.endsWith(".jsonl"))[0];
      await denied(
        f,
        pooled ? "rejected_filesystem_path_unavailable" : "rejected_omp_native_state",
        () =>
          f.client.readTextFile({
            sessionId: NATIVE_UUID,
            path: join(siblingMode, siblingModeJournal),
          }),
        `${label}: sibling mode`,
      );
      // Sentinels survived every denied attempt.
      assertEquals(
        Deno.readTextFileSync(join(f.siblingArtifactDir, "17.bash.log")),
        "sibling spill",
        label,
      );
      assertEquals(Deno.readTextFileSync(f.nativeAuth), '{"credential":"sentinel"}', label);
      assertEquals(Deno.readTextFileSync(f.nativeDatabase), "database sentinel", label);
      assertEquals(
        Deno.readTextFileSync(join(f.dataRoot, "omp", "sessions", SKILL_API_ID, "17.bash.log")),
        "skill-id spill",
        label,
      );
      assertEquals(Deno.readTextFileSync(f.journalPath).includes('"type":"session"'), true, label);
    } finally {
      Deno.removeSync(f.base, { recursive: true });
    }
  }
});

Deno.test("OMP artifacts: writes, edit permission and destructive requests deny before mutation", async () => {
  const f = await artifactFixture({ pooled: false, mode: "native-yolo", yolo: true });
  try {
    f.register();
    const targets = [
      join(f.artifactDir, "17.bash.log"),
      join(f.siblingArtifactDir, "17.bash.log"),
      f.journalPath,
      join(f.artifactDir, "19.bash.log"),
    ];
    for (const target of targets) {
      const before = f.contentCalls.length;
      await denied(
        f,
        "rejected_omp_native_state",
        () => f.client.writeTextFile({ sessionId: NATIVE_UUID, path: target, content: "mutated" }),
      );
      assertEquals(f.contentCalls.length, before);
      // Edit permission in YOLO mode denies too (no blanket auto-approval).
      f.client.clearPermissionRejections();
      const response = await f.client.requestPermission(permission(target));
      assertEquals(response.outcome, { outcome: "selected", optionId: "reject" });
      assertEquals(
        f.client.getRecentPermissionRejections().map((item) => item.reason),
        ["rejected_omp_native_state"],
      );
      // A destructive request with the same target denies as well.
      f.client.clearPermissionRejections();
      const destructive = await f.client.requestPermission({
        ...permission(target, "delete"),
        toolCall: {
          toolCallId: "d",
          title: target,
          kind: "delete",
          rawInput: { path: target },
          locations: [{ path: target }],
        },
      });
      assertEquals(destructive.outcome, { outcome: "selected", optionId: "reject" });
      assertEquals(
        f.client.getRecentPermissionRejections().map((item) => item.reason),
        ["rejected_omp_native_state"],
      );
    }
    // An edit permission whose raw input smuggles a registered skill name still
    // cannot authorize a native-state target.
    f.client.clearPermissionRejections();
    const smuggled = await f.client.requestPermission({
      ...permission(f.artifactDir),
      toolCall: {
        toolCallId: "smuggle",
        title: f.artifactDir,
        kind: "edit",
        rawInput: { skill: "send-reply", path: join(f.artifactDir, "17.bash.log") },
        locations: [{ path: join(f.artifactDir, "17.bash.log") }],
      },
    });
    assertEquals(smuggled.outcome, { outcome: "selected", optionId: "reject" });
    assertEquals(
      f.client.getRecentPermissionRejections().map((item) => item.reason),
      ["rejected_omp_native_state"],
    );
    // Native command execution and ordinary YOLO writes are unchanged.
    const ordinary = join(f.workspace, "yolo.md");
    await f.client.writeTextFile({ sessionId: NATIVE_UUID, path: ordinary, content: "yolo" });
    assertEquals(Deno.readTextFileSync(ordinary), "yolo");
    const edit = await f.client.requestPermission(permission(ordinary));
    assertEquals(edit.outcome, { outcome: "selected", optionId: "allow" });
    const shell = await f.client.requestPermission({
      ...permission("bash", "edit"),
      toolCall: {
        toolCallId: "s",
        title: "bash",
        kind: "execute",
        rawInput: { command: "ls" },
        locations: [{ path: join(f.artifactDir, "17.bash.log") }],
      },
    });
    assertEquals(shell.outcome.outcome, "selected");
    // Sentinels untouched.
    assertEquals(Deno.readTextFileSync(join(f.artifactDir, "17.bash.log")), SPILL);
    assertEquals(Deno.readTextFileSync(join(f.siblingArtifactDir, "17.bash.log")), "sibling spill");
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: an unavailable or revoked capability denies without a broad fallback", async () => {
  const f = await artifactFixture({ pooled: false, mode: "restricted", yolo: false });
  try {
    // Reservation without proven artifacts (a replay after reconnect, or a
    // malformed/over-limit discovery) keeps native state reserved and grants no
    // artifact read.
    f.register({
      ompNativeState: {
        cwd: f.workspace,
        nativeDataRoot: f.dataRoot,
        dataRootIdentity: f.reservation!.dataRootIdentity,
      },
    });
    await denied(f, "rejected_omp_native_state", () =>
      f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      }));
    // Unrelated workspace reads still work.
    const memory = join(f.workspace, "memory.public.jsonl");
    Deno.writeTextFileSync(memory, "memory");
    assertEquals(
      (await f.client.readTextFile({ sessionId: NATIVE_UUID, path: memory })).content,
      "memory",
    );
    // A context with no reservation at all (OpenCode, or an unregistered OMP
    // session) falls back to the existing extension rule: `.log` stays denied
    // and native state was never a broad grant to begin with.
    f.registerWithoutProvenance("no-provenance");
    await denied(f, "rejected_read_extension", () =>
      f.client.readTextFile({
        sessionId: "no-provenance",
        path: join(f.artifactDir, "17.bash.log"),
      }));
    assertEquals(
      (await f.client.readTextFile({ sessionId: "no-provenance", path: memory })).content,
      "memory",
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: a lazy directory binds on first use and a later replacement denies", async () => {
  const f = await artifactFixture({ pooled: false, mode: "restricted", yolo: false });
  try {
    Deno.removeSync(f.artifactDir, { recursive: true });
    // Re-discover with the directory absent: the capability is prospective and
    // carries no bound identity yet.
    await f.refreshArtifacts();
    f.register();
    await denied(f, "rejected_filesystem_path_unavailable", () =>
      f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      }));
    // The client never creates the directory for the agent.
    assertEquals(await Deno.lstat(f.artifactDir).catch(() => null), null);
    // Once the native runtime creates it, a later valid read is eligible and
    // binds the identity to this registration.
    Deno.mkdirSync(f.artifactDir, { recursive: true });
    Deno.writeTextFileSync(join(f.artifactDir, "17.bash.log"), SPILL);
    assertEquals(
      (await f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      })).content,
      SPILL,
    );
    // Any later replacement of that directory denies, even though the path,
    // owner and journal are unchanged.
    Deno.renameSync(f.artifactDir, `${f.artifactDir}.old`);
    Deno.mkdirSync(f.artifactDir, { recursive: true });
    Deno.writeTextFileSync(join(f.artifactDir, "17.bash.log"), "replacement spill");
    await denied(f, "rejected_omp_native_state", () =>
      f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      }));
    assertEquals(
      Deno.readTextFileSync(join(f.artifactDir, "17.bash.log")),
      "replacement spill",
    );
    assertEquals(Deno.readTextFileSync(join(`${f.artifactDir}.old`, "17.bash.log")), SPILL);
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: escaping links and journal/anchor/final replacement fail closed", async () => {
  // A workspace symlink aliased into reserved state never inherits authority.
  const linked = await artifactFixture({ pooled: false, mode: "native-yolo", yolo: true });
  try {
    linked.register();
    const escape = join(linked.workspace, "escape.log");
    Deno.symlinkSync(join(linked.siblingArtifactDir, "17.bash.log"), escape);
    await denied(
      linked,
      "rejected_omp_native_state",
      () => linked.client.readTextFile({ sessionId: NATIVE_UUID, path: escape }),
    );
    await denied(
      linked,
      "rejected_omp_native_state",
      () =>
        linked.client.writeTextFile({ sessionId: NATIVE_UUID, path: escape, content: "mutated" }),
    );
    assertEquals(
      Deno.readTextFileSync(join(linked.siblingArtifactDir, "17.bash.log")),
      "sibling spill",
    );
  } finally {
    Deno.removeSync(linked.base, { recursive: true });
  }

  // The journal replaced between observation and the protected open denies.
  let replacedJournal = false;
  let journalTarget = "";
  const journalSwap = await artifactFixture({
    pooled: false,
    mode: "restricted",
    yolo: false,
    beforeOpen: (path) => {
      if (replacedJournal || path !== journalTarget) return;
      replacedJournal = true;
      Deno.renameSync(path, `${path}.old`);
      Deno.writeTextFileSync(path, "replacement journal\n");
    },
  });
  try {
    journalSwap.register();
    journalTarget = journalSwap.journalPath;
    // Either layer may observe the swap first: the root observation reports
    // path_changed, the protected-opening anchor guard reports the same access
    // failure. Both deny before any content IO.
    await deniedWithReasons(
      journalSwap,
      ["rejected_filesystem_access", "rejected_filesystem_path_unavailable"],
      () =>
        journalSwap.client.readTextFile({
          sessionId: NATIVE_UUID,
          path: join(journalSwap.artifactDir, "17.bash.log"),
        }),
      "journal replacement",
    );
    assertEquals(replacedJournal, true);
    assertEquals(
      Deno.readTextFileSync(`${journalSwap.journalPath}.old`).includes('"type":"title"'),
      true,
    );
  } finally {
    Deno.removeSync(journalSwap.base, { recursive: true });
  }

  // The journal's parent (anchor) replaced before the protected open denies.
  let replacedAnchor = false;
  let anchorTarget = "";
  const anchorSwap = await artifactFixture({
    pooled: false,
    mode: "restricted",
    yolo: false,
    beforeOpen: (path) => {
      if (replacedAnchor || path !== anchorTarget) return;
      replacedAnchor = true;
      Deno.renameSync(path, `${path}-moved`);
      Deno.mkdirSync(path);
    },
  });
  try {
    anchorSwap.register();
    anchorTarget = join(anchorSwap.dataRoot, "omp", "sessions", "-tmp-workspace");
    await deniedWithReasons(
      anchorSwap,
      ["rejected_filesystem_access", "rejected_filesystem_path_unavailable"],
      () =>
        anchorSwap.client.readTextFile({
          sessionId: NATIVE_UUID,
          path: join(anchorSwap.artifactDir, "17.bash.log"),
        }),
      "anchor replacement",
    );
    assertEquals(replacedAnchor, true);
  } finally {
    Deno.removeSync(anchorSwap.base, { recursive: true });
  }

  // The artifact root replaced before the protected open denies.
  let replacedRoot = false;
  let rootTarget = "";
  const rootSwap = await artifactFixture({
    pooled: false,
    mode: "restricted",
    yolo: false,
    beforeOpen: (path) => {
      if (replacedRoot || path !== rootTarget) return;
      replacedRoot = true;
      Deno.renameSync(path, `${path}-moved`);
      Deno.mkdirSync(path);
    },
  });
  try {
    rootSwap.register();
    rootTarget = rootSwap.artifactDir;
    await denied(rootSwap, "rejected_filesystem_access", () =>
      rootSwap.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(rootSwap.artifactDir, "17.bash.log"),
      }));
    assertEquals(replacedRoot, true);
  } finally {
    Deno.removeSync(rootSwap.base, { recursive: true });
  }

  // The final artifact file replaced between observation and the protected open.
  let replacedFinal = false;
  let finalTarget = "";
  const finalSwap = await artifactFixture({
    pooled: false,
    mode: "restricted",
    yolo: false,
    beforeOpen: (path) => {
      if (replacedFinal || path !== finalTarget) return;
      replacedFinal = true;
      Deno.renameSync(path, `${path}.old`);
      Deno.writeTextFileSync(path, "replacement spill");
    },
  });
  try {
    finalSwap.register();
    finalTarget = join(finalSwap.artifactDir, "17.bash.log");
    await denied(
      finalSwap,
      "rejected_filesystem_access",
      () => finalSwap.client.readTextFile({ sessionId: NATIVE_UUID, path: finalTarget }),
    );
    assertEquals(replacedFinal, true);
    assertEquals(Deno.readTextFileSync(finalTarget), "replacement spill");
    assertEquals(Deno.readTextFileSync(`${finalTarget}.old`), SPILL);
  } finally {
    Deno.removeSync(finalSwap.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: a registration that replaces the context mid-observation denies", async () => {
  const f = await artifactFixture({ pooled: false, mode: "restricted", yolo: false });
  const originalRealPath = Deno.realPath;
  try {
    f.register();
    let revoked = false;
    Deno.realPath = async (value) => {
      const result = await originalRealPath(value);
      if (!revoked) {
        revoked = true;
        f.register({ yolo: true });
      }
      return result;
    };
    await denied(f, "rejected_trusted_skills_identity", () =>
      f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      }));
    assertEquals(revoked, true);
    // The new generation still reads its own current session.
    assertEquals(
      (await f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      })).content,
      SPILL,
    );
  } finally {
    Deno.realPath = originalRealPath;
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: a linked native-state path reserves its real destination", async () => {
  const f = await artifactFixture({
    pooled: false,
    mode: "restricted",
    yolo: true,
    nativeStateLink: true,
  });
  try {
    // Discovery rejects the noncanonical data root, so this context carries a
    // reservation only — and the reservation must cover the link's real
    // destination, not just the configured spelling.
    assertEquals(f.reservation?.artifacts, undefined);
    f.register();
    const realDataRoot = f.dataRoot;
    const realJournal = join(
      realDataRoot,
      "omp",
      "sessions",
      "-tmp-workspace",
      f.journalPath.split("/").pop()!,
    );
    const realArtifact = join(
      realDataRoot,
      "omp",
      "sessions",
      "-tmp-workspace",
      f.artifactDir.split("/").pop()!,
      "17.bash.log",
    );
    await denied(
      f,
      "rejected_omp_native_state",
      () => f.client.readTextFile({ sessionId: NATIVE_UUID, path: realJournal }),
    );
    await denied(
      f,
      "rejected_omp_native_state",
      () => f.client.readTextFile({ sessionId: NATIVE_UUID, path: realArtifact }),
    );
    await denied(
      f,
      "rejected_omp_native_state",
      () =>
        f.client.writeTextFile({ sessionId: NATIVE_UUID, path: realArtifact, content: "mutated" }),
    );
    assertEquals(Deno.readTextFileSync(realArtifact), SPILL);
    assertEquals(Deno.readTextFileSync(realJournal).includes('"type":"session"'), true);
    // A mutating permission request for the same path denies without approval.
    f.client.clearPermissionRejections();
    const response = await f.client.requestPermission(permission(realJournal));
    assertEquals(response.outcome, { outcome: "selected", optionId: "reject" });
    assertEquals(
      f.client.getRecentPermissionRejections().map((item) => item.reason),
      ["rejected_omp_native_state"],
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: an unevaluable reservation denies instead of approving", async () => {
  const f = await artifactFixture({ pooled: false, mode: "native-yolo", yolo: true });
  try {
    f.register();
    // Make an unrelated configured root unavailable, so the physical
    // reservation evaluation cannot complete.
    Deno.renameSync(f.shared, `${f.shared}-moved`);
    // The trusted lexical reservation still decides first: the journal is
    // plainly inside the session's native state.
    f.client.clearPermissionRejections();
    const reserved = await f.client.requestPermission(permission(f.journalPath));
    assertEquals(reserved.outcome, { outcome: "selected", optionId: "reject" });
    assertEquals(
      f.client.getRecentPermissionRejections().map((item) => item.reason),
      ["rejected_omp_native_state"],
    );
    // Even a path that is not lexically reserved fails closed while the
    // reservation cannot be evaluated.
    f.client.clearPermissionRejections();
    const unevaluable = await f.client.requestPermission(
      permission(join(f.workspace, "ordinary.md")),
    );
    assertEquals(unevaluable.outcome, { outcome: "selected", optionId: "reject" });
    assertEquals(
      f.client.getRecentPermissionRejections().map((item) => item.reason),
      ["rejected_omp_native_state"],
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: re-registration keeps a committed directory binding", async () => {
  const f = await artifactFixture({ pooled: false, mode: "restricted", yolo: false });
  try {
    Deno.removeSync(f.artifactDir, { recursive: true });
    await f.refreshArtifacts();
    f.register();
    Deno.mkdirSync(f.artifactDir, { recursive: true });
    Deno.writeTextFileSync(join(f.artifactDir, "17.bash.log"), SPILL);
    assertEquals(
      (await f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      })).content,
      SPILL,
    );
    // An ordinary same-cwd re-registration forwards the connector's cached
    // provenance, which predates the client's first-use binding.
    f.register({ yolo: false });
    assertEquals(
      (await f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      })).content,
      SPILL,
    );
    // The binding survived, so a replacement after that re-registration denies.
    Deno.renameSync(f.artifactDir, `${f.artifactDir}.old`);
    Deno.mkdirSync(f.artifactDir, { recursive: true });
    Deno.writeTextFileSync(join(f.artifactDir, "17.bash.log"), "replacement spill");
    await denied(f, "rejected_omp_native_state", () =>
      f.client.readTextFile({
        sessionId: NATIVE_UUID,
        path: join(f.artifactDir, "17.bash.log"),
      }));
    assertEquals(
      Deno.readTextFileSync(join(f.artifactDir, "17.bash.log")),
      "replacement spill",
    );
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});

Deno.test("OMP artifacts: a reserved-state request without a reject option cancels", async () => {
  const f = await artifactFixture({ pooled: false, mode: "native-yolo", yolo: true });
  try {
    f.register();
    f.client.clearPermissionRejections();
    const response = await f.client.requestPermission({
      sessionId: NATIVE_UUID,
      toolCall: {
        toolCallId: "no-reject",
        title: f.journalPath,
        kind: "edit",
        locations: [{ path: f.journalPath }],
      },
      options: [
        { kind: "allow_once", optionId: "allow", name: "Allow" },
        { kind: "reject_always", optionId: "never", name: "Never" },
      ],
    });
    // Never an approval option, and never an arbitrary fallback.
    assertEquals(response.outcome, { outcome: "cancelled" });
    assertEquals(
      f.client.getRecentPermissionRejections().map((item) => item.reason),
      ["rejected_omp_native_state"],
    );
    assertEquals(f.contentCalls.length, 0);
  } finally {
    Deno.removeSync(f.base, { recursive: true });
  }
});
