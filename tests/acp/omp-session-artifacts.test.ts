// tests/acp/omp-session-artifacts.test.ts
//
// Behavioural suite for the bounded native-journal resolver
// (`src/acp/omp/session-artifacts.ts`) and the lifecycle-only prefix reader
// (`readOmpSessionHeaderPrefix`).
//
// Every case drives REAL temporary files and the offline native-call model
// (`createFilesystemTestCalls`), which reads actual file content through
// descriptor-bound opens. That certifies this resolver's own decisions — the
// pinned native layout is consumed as a source-verified fixture shape, never as
// a claim about the official binary.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  OMP_SESSION_BUCKET_LIMIT,
  OMP_SESSION_ENTRY_LIMIT,
  resolveOmpSessionArtifacts,
} from "@acp/omp/session-artifacts.ts";
import { readOmpSessionHeaderPrefix } from "@acp/filesystem-access.ts";
import { createFilesystemTestCalls } from "./filesystem-test-calls.ts";

const UUID_A = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const UUID_B = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const TIMESTAMP = "2026-01-02T03-04-05-678Z";

/** One synthetic native session tree under a fresh data root. */
interface NativeTree {
  readonly base: string;
  readonly dataRoot: string;
  readonly sessionsRoot: string;
  readonly workspace: string;
  readonly journalPath: string;
  readonly artifactDirectory: string;
  /** Identity of the data root, as the connector observes it. */
  readonly dataRootIdentity: { dev: number; ino: number };
}

function nativeTree(options: { mode?: string; uuid?: string; includeJournal?: boolean } = {}) {
  const base = Deno.makeTempDirSync();
  const workspace = join(base, "workspace");
  Deno.mkdirSync(workspace, { recursive: true });
  const dataRoot = join(base, "omp-agent", options.mode ?? "restricted", "xdg-data");
  const sessionsRoot = join(dataRoot, "omp", "sessions");
  const bucket = join(sessionsRoot, "-tmp-workspace");
  Deno.mkdirSync(bucket, { recursive: true });
  const journalPath = join(bucket, `${TIMESTAMP}_${options.uuid ?? UUID_A}.jsonl`);
  if (options.includeJournal !== false) {
    // Physical line 1 is the fixed-width native title slot; line 2 the header.
    const titleSlot = JSON.stringify({
      type: "title",
      v: 1,
      title: "synthetic",
      updatedAt: TIMESTAMP,
      pad: " ".repeat(32),
    });
    const header = JSON.stringify({
      type: "session",
      version: 3,
      id: options.uuid ?? UUID_A,
      timestamp: TIMESTAMP,
      cwd: workspace,
    });
    Deno.writeTextFileSync(journalPath, `${titleSlot}\n${header}\n`);
  }
  const info = Deno.lstatSync(dataRoot);
  return {
    base,
    dataRoot,
    sessionsRoot,
    workspace,
    journalPath,
    artifactDirectory: journalPath.slice(0, -".jsonl".length),
    dataRootIdentity: { dev: info.dev!, ino: info.ino! },
  };
}

function resolveIn(
  tree: NativeTree,
  overrides: Partial<Parameters<typeof resolveOmpSessionArtifacts>[0]> = {},
) {
  return resolveOmpSessionArtifacts({
    agentType: "omp",
    xdgDataHome: tree.dataRoot,
    acpSessionId: UUID_A,
    sessionCwd: tree.workspace,
    nativeCalls: createFilesystemTestCalls(),
    ...overrides,
  });
}

Deno.test("OMP session artifacts: a unique journal resolves and its directory is derived", async () => {
  for (
    const [label, tree] of [
      ["lazy directory", nativeTree()],
      ["existing directory", nativeTree()],
    ] as const
  ) {
    try {
      if (label === "existing directory") {
        Deno.mkdirSync(tree.artifactDirectory, { recursive: true });
        Deno.writeTextFileSync(join(tree.artifactDirectory, "17.bash.log"), "spill");
      }
      const resolution = await resolveIn(tree);
      assertEquals(resolution.ok, true, label);
      if (!resolution.ok) continue;
      assertEquals(resolution.provenance.acpSessionId, UUID_A);
      assertEquals(resolution.provenance.journalPath, tree.journalPath);
      assertEquals(
        resolution.provenance.anchorDirectory,
        join(tree.sessionsRoot, "-tmp-workspace"),
      );
      assertEquals(
        resolution.provenance.journalPath.endsWith(`_${UUID_A}.jsonl`),
        true,
      );
      assertEquals(resolution.dataRootIdentity, tree.dataRootIdentity);
      // Only the first observation of an existing directory binds its identity.
      if (label === "lazy directory") {
        assertEquals(resolution.provenance.artifactDirectoryIdentity, undefined);
      } else {
        const artifactInfo = Deno.lstatSync(tree.artifactDirectory);
        assertEquals(resolution.provenance.artifactDirectoryIdentity, {
          dev: artifactInfo.dev!,
          ino: artifactInfo.ino!,
        });
      }
    } finally {
      Deno.removeSync(tree.base, { recursive: true });
    }
  }
});

Deno.test("OMP session artifacts: a legacy journal without the title-slot prefix resolves", async () => {
  const tree = nativeTree();
  try {
    Deno.writeTextFileSync(
      tree.journalPath,
      `${JSON.stringify({ type: "session", id: UUID_A, cwd: tree.workspace })}\n`,
    );
    const resolution = await resolveIn(tree);
    assertEquals(resolution.ok, true);
  } finally {
    Deno.removeSync(tree.base, { recursive: true });
  }
});

Deno.test("OMP session artifacts: host-provisioned cwd aliases compare canonically", async () => {
  const tree = nativeTree();
  const alias = join(tree.base, "workspace-alias");
  try {
    Deno.symlinkSync(tree.workspace, alias);
    const viaAlias = await resolveIn(tree, { sessionCwd: alias });
    assertEquals(viaAlias.ok, true, "the registered alias must reach the journal");
    const otherWorkspace = join(tree.base, "other-workspace");
    Deno.mkdirSync(otherWorkspace, { recursive: true });
    const viaOther = await resolveIn(tree, { sessionCwd: otherWorkspace });
    assertEquals(viaOther.ok, false);
    if (!viaOther.ok) assertEquals(viaOther.reason, "no_match");
  } finally {
    Deno.removeSync(tree.base, { recursive: true });
  }
});

Deno.test("OMP session artifacts: mismatched, malformed and ambiguous evidence grants nothing", async () => {
  const cases: Array<[string, (tree: NativeTree) => void]> = [
    ["mismatched id", (tree) => {
      Deno.writeTextFileSync(
        tree.journalPath,
        `${JSON.stringify({ type: "session", id: UUID_B, cwd: tree.workspace })}\n`,
      );
    }],
    ["mismatched cwd", (tree) => {
      Deno.writeTextFileSync(
        tree.journalPath,
        `${JSON.stringify({ type: "session", id: UUID_A, cwd: join(tree.base, "elsewhere") })}\n`,
      );
    }],
    ["malformed body", (tree) => Deno.writeTextFileSync(tree.journalPath, "not json\n")],
    ["empty body", (tree) => Deno.writeTextFileSync(tree.journalPath, "")],
    ["header absent", (tree) => {
      Deno.writeTextFileSync(
        tree.journalPath,
        `${JSON.stringify({ type: "title", v: 1, title: "t", updatedAt: TIMESTAMP, pad: "" })}\n`,
      );
    }],
  ];
  for (const [label, mutate] of cases) {
    const tree = nativeTree();
    try {
      mutate(tree);
      const resolution = await resolveIn(tree);
      assertEquals(resolution.ok, false, label);
      if (!resolution.ok) assertEquals(resolution.reason, "no_match", label);
    } finally {
      Deno.removeSync(tree.base, { recursive: true });
    }
  }

  const absent = nativeTree({ includeJournal: false });
  try {
    const resolution = await resolveIn(absent);
    assertEquals(resolution.ok, false);
    if (!resolution.ok) assertEquals(resolution.reason, "no_match");
  } finally {
    Deno.removeSync(absent.base, { recursive: true });
  }

  // The same native UUID in two buckets is ambiguous, never guessed.
  const duplicate = nativeTree();
  try {
    const second = join(duplicate.sessionsRoot, "-other-workspace");
    Deno.mkdirSync(second, { recursive: true });
    Deno.copyFileSync(duplicate.journalPath, join(second, `${TIMESTAMP}_${UUID_A}.jsonl`));
    const resolution = await resolveIn(duplicate);
    assertEquals(resolution.ok, false);
    if (!resolution.ok) assertEquals(resolution.reason, "ambiguous");
  } finally {
    Deno.removeSync(duplicate.base, { recursive: true });
  }
});

Deno.test("OMP session artifacts: bounds and unusable roots deny the capability only", async () => {
  const bounded = nativeTree();
  try {
    for (const name of ["-bucket-a", "-bucket-b"]) {
      Deno.mkdirSync(join(bounded.sessionsRoot, name), { recursive: true });
    }
    const byBuckets = await resolveIn(bounded, { limits: { buckets: 1 } });
    assertEquals(byBuckets.ok, false);
    if (!byBuckets.ok) assertEquals(byBuckets.reason, "bounds_exceeded");
    // The entry bound covers bucket children too.
    Deno.writeTextFileSync(join(bounded.sessionsRoot, "-bucket-b", "noise.txt"), "x");
    const byEntries = await resolveIn(bounded, {
      limits: { buckets: OMP_SESSION_BUCKET_LIMIT, entries: 2 },
    });
    assertEquals(byEntries.ok, false);
    if (!byEntries.ok) assertEquals(byEntries.reason, "bounds_exceeded");
  } finally {
    Deno.removeSync(bounded.base, { recursive: true });
  }

  const missing = nativeTree({ includeJournal: false });
  try {
    const absentRoot = await resolveIn(missing, {
      xdgDataHome: join(missing.base, "absent-root"),
    });
    assertEquals(absentRoot.ok, false);
    if (!absentRoot.ok) assertEquals(absentRoot.reason, "sessions_root_unavailable");
    const notOmp = await resolveIn(missing, { agentType: "opencode" });
    assertEquals(notOmp.ok, false);
    if (!notOmp.ok) assertEquals(notOmp.reason, "not_selected");
    const relative = await resolveIn(missing, { xdgDataHome: "relative/root" });
    assertEquals(relative.ok, false);
    if (!relative.ok) assertEquals(relative.reason, "invalid_input");
    const noDataRoot = await resolveIn(missing, { xdgDataHome: undefined });
    assertEquals(noDataRoot.ok, false);
    if (!noDataRoot.ok) assertEquals(noDataRoot.reason, "invalid_input");
  } finally {
    Deno.removeSync(missing.base, { recursive: true });
  }
});

Deno.test("OMP session artifacts: linked components and directories grant nothing", async () => {
  // A symlinked journal never becomes a candidate.
  const linked = nativeTree();
  try {
    const real = join(linked.sessionsRoot, "-elsewhere", `${TIMESTAMP}_${UUID_A}.jsonl`);
    Deno.mkdirSync(join(linked.sessionsRoot, "-elsewhere"), { recursive: true });
    Deno.writeTextFileSync(real, "linked\n");
    Deno.removeSync(linked.journalPath);
    Deno.symlinkSync(real, linked.journalPath);
    const resolution = await resolveIn(linked);
    assertEquals(resolution.ok, false);
    if (!resolution.ok) assertEquals(resolution.reason, "no_match");
  } finally {
    Deno.removeSync(linked.base, { recursive: true });
  }

  // A symlinked artifact directory is an unsafe component, not a capability.
  const artifactLink = nativeTree();
  try {
    Deno.mkdirSync(join(artifactLink.base, "elsewhere"), { recursive: true });
    Deno.symlinkSync(join(artifactLink.base, "elsewhere"), artifactLink.artifactDirectory);
    const resolution = await resolveIn(artifactLink);
    assertEquals(resolution.ok, false);
    if (!resolution.ok) assertEquals(resolution.reason, "unsafe_component");
  } finally {
    Deno.removeSync(artifactLink.base, { recursive: true });
  }

  // A symlinked data root is rejected before any enumeration.
  const rootLink = nativeTree();
  try {
    const moved = join(rootLink.base, "moved-data-root");
    Deno.renameSync(rootLink.dataRoot, moved);
    Deno.symlinkSync(moved, rootLink.dataRoot);
    const resolution = await resolveIn(rootLink);
    assertEquals(resolution.ok, false);
    if (!resolution.ok) assertEquals(resolution.reason, "sessions_root_unavailable");
  } finally {
    Deno.removeSync(rootLink.base, { recursive: true });
  }
});

Deno.test("readOmpSessionHeaderPrefix: bounded, link-free and fail-closed", () => {
  const tree = nativeTree();
  try {
    const calls = createFilesystemTestCalls();
    const sessionsInfo = Deno.lstatSync(tree.sessionsRoot);
    const journalInfo = Deno.lstatSync(tree.journalPath);
    const relativePath = `-tmp-workspace/${TIMESTAMP}_${UUID_A}.jsonl`;
    const prefix = readOmpSessionHeaderPrefix({
      sessionsRoot: {
        canonicalPath: tree.sessionsRoot,
        identity: { dev: sessionsInfo.dev!, ino: sessionsInfo.ino! },
      },
      relativePath,
      targetIdentity: { dev: journalInfo.dev!, ino: journalInfo.ino! },
      nativeCalls: calls,
    });
    assertEquals(prefix.ok, true);
    if (prefix.ok) assertEquals(prefix.value.includes(JSON.stringify({ type: "session" })), false);
    if (prefix.ok) assertEquals(prefix.value.startsWith('{"type":"title"'), true);

    // The prefix is bounded: only the first N bytes are returned.
    const bounded = readOmpSessionHeaderPrefix({
      sessionsRoot: {
        canonicalPath: tree.sessionsRoot,
        identity: { dev: sessionsInfo.dev!, ino: sessionsInfo.ino! },
      },
      relativePath,
      targetIdentity: { dev: journalInfo.dev!, ino: journalInfo.ino! },
      maxBytes: 10,
      nativeCalls: calls,
    });
    assertEquals(bounded.ok, true);
    if (bounded.ok) assertEquals(new TextEncoder().encode(bounded.value).length <= 10, true);

    // Unsafe components, absent identities and traversal are rejected.
    const unsafe = readOmpSessionHeaderPrefix({
      sessionsRoot: {
        canonicalPath: tree.sessionsRoot,
        identity: { dev: sessionsInfo.dev!, ino: sessionsInfo.ino! },
      },
      relativePath: "../escape.jsonl",
      targetIdentity: { dev: journalInfo.dev!, ino: journalInfo.ino! },
      nativeCalls: calls,
    });
    assertEquals(unsafe.ok, false);
    if (!unsafe.ok) assertEquals(unsafe.reason, "unsafe_traversal");

    const noIdentity = readOmpSessionHeaderPrefix({
      sessionsRoot: { canonicalPath: tree.sessionsRoot, identity: { dev: -1, ino: -1 } },
      relativePath,
      targetIdentity: { dev: journalInfo.dev!, ino: journalInfo.ino! },
      nativeCalls: calls,
    });
    assertEquals(noIdentity.ok, false);
    if (!noIdentity.ok) assertEquals(noIdentity.reason, "invalid_context");

    // A linked candidate fails closed at the protected open (ELOOP mapping).
    const alias = join(tree.sessionsRoot, "-tmp-workspace", "alias.jsonl");
    Deno.symlinkSync(tree.journalPath, alias);
    const linked = readOmpSessionHeaderPrefix({
      sessionsRoot: {
        canonicalPath: tree.sessionsRoot,
        identity: { dev: sessionsInfo.dev!, ino: sessionsInfo.ino! },
      },
      relativePath: `-tmp-workspace/alias.jsonl`,
      targetIdentity: { dev: journalInfo.dev!, ino: journalInfo.ino! },
      nativeCalls: calls,
    });
    assertEquals(linked.ok, false);
    if (!linked.ok) assertEquals(linked.reason, "unsafe_traversal");
  } finally {
    Deno.removeSync(tree.base, { recursive: true });
  }
});

Deno.test("OMP session artifacts: exported discovery bounds are the documented values", () => {
  assertEquals(OMP_SESSION_BUCKET_LIMIT, 4096);
  assertEquals(OMP_SESSION_ENTRY_LIMIT, 16384);
});
