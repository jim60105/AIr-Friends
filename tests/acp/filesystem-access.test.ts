import { assertEquals } from "@std/assert";
import { validateAccessAdmission } from "../../src/acp/filesystem-access.ts";
import {
  canonicalizeSessionRoots,
  type CanonicalSessionRoots,
  type CanonicalTarget,
  resolveFilesystemTarget,
  type SessionContext,
} from "../../src/acp/filesystem-roots.ts";

function createValidContext(tmpDir = "/workspace"): SessionContext {
  return {
    acpSessionId: "session-1",
    skillSessionId: "skill-1",
    sessionCwd: tmpDir,
    explicitStagingPath: `${tmpDir}/tmp/skill-1`,
    sharedWorkspacePath: `${tmpDir}/shared`,
    sessionContextGeneration: "gen-42",
  };
}

function createValidRoots(): CanonicalSessionRoots {
  return {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roots: [
      {
        role: "workspace",
        configuredPath: "/workspace",
        canonicalPath: "/workspace",
        identity: { dev: 2049, ino: 100 },
        readOnly: false,
      },
      {
        role: "staging",
        configuredPath: "/staging",
        canonicalPath: "/staging",
        identity: { dev: 2049, ino: 101 },
        readOnly: false,
      },
      {
        role: "trusted-skills",
        configuredPath: "/skills",
        canonicalPath: "/skills",
        identity: { dev: 2049, ino: 102 },
        readOnly: true,
      },
      {
        role: "shared",
        configuredPath: "/shared",
        canonicalPath: "/shared",
        identity: { dev: 2049, ino: 103 },
        isProspective: true,
        readOnly: false,
      },
    ],
  };
}

Deno.test("validateAccessAdmission: session ID mismatch returns invalid_context", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "other-session",
    sessionContextGeneration: "gen-42",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "file.txt",
    canonicalTarget: "/workspace/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 200 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "invalid_context");
  }
});

Deno.test("validateAccessAdmission: generation mismatch returns invalid_context", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-stale",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "file.txt",
    canonicalTarget: "/workspace/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 200 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "invalid_context");
  }
});

Deno.test("validateAccessAdmission: empty session context generation returns invalid_context", () => {
  const context: SessionContext = {
    ...createValidContext(),
    sessionContextGeneration: "   ",
  };
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "   ",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "file.txt",
    canonicalTarget: "/workspace/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 200 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "invalid_context");
  }
});

Deno.test("validateAccessAdmission: trusted-skills write is denied", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["trusted-skills"],
    rootIdentities: [roots.roots[2]],
    normalizedInput: "skill.md",
    canonicalTarget: "/skills/skill.md",
    rootRelativePath: "skill.md",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 201 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "trusted-skills", true);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "access_denied");
  }
});

Deno.test("validateAccessAdmission: selected role missing from target.roles returns outside_roots", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["staging"],
    rootIdentities: [roots.roots[1]],
    normalizedInput: "file.txt",
    canonicalTarget: "/staging/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 202 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "outside_roots");
  }
});

Deno.test("validateAccessAdmission: target root identity mismatch returns identity_unavailable", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["workspace"],
    rootIdentities: [
      {
        ...roots.roots[0],
        identity: { dev: 2049, ino: 9999 }, // Inconsistent root inode!
      },
    ],
    normalizedInput: "file.txt",
    canonicalTarget: "/workspace/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 202 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "identity_unavailable");
  }
});

Deno.test("validateAccessAdmission: prospective root returns root_unavailable", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["shared"],
    rootIdentities: [roots.roots[3]],
    normalizedInput: "file.txt",
    canonicalTarget: "/shared/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 203 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "shared", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "root_unavailable");
  }
});

Deno.test("validateAccessAdmission: request-time symlinks in target returns unsafe_traversal", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "link.txt",
    canonicalTarget: "/workspace/link.txt",
    rootRelativePath: "link.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 204 },
    observedSymlinks: [{ path: "/workspace/link.txt", target: "/workspace/target.txt" }],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "unsafe_traversal");
  }
});

Deno.test("validateAccessAdmission: missing parent suffix for prospective new file returns parent_missing", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "missing/sub/file.txt",
    canonicalTarget: "/workspace/missing/sub/file.txt",
    rootRelativePath: "missing/sub/file.txt",
    targetType: "prospective",
    prospectiveMissingSuffix: ["sub", "file.txt"], // > 1 missing component!
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", true);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "parent_missing");
  }
});

Deno.test("validateAccessAdmission: directory target returns wrong_target_type", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "subdir",
    canonicalTarget: "/workspace/subdir",
    rootRelativePath: "subdir",
    targetType: "directory",
    targetIdentity: { dev: 2049, ino: 205 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "wrong_target_type");
  }
});

Deno.test("validateAccessAdmission: non-exact safe identity returns identity_unavailable", () => {
  const context = createValidContext();
  const roots = createValidRoots();
  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "file.txt",
    canonicalTarget: "/workspace/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: -1, ino: 200 },
    observedSymlinks: [],
  };

  const res = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "identity_unavailable");
  }
});

Deno.test("validateAccessAdmission: overlapping workspace and staging roles derives staging-relative path", () => {
  const context = createValidContext();
  const roots: CanonicalSessionRoots = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roots: [
      {
        role: "workspace",
        configuredPath: "/workspace",
        canonicalPath: "/workspace",
        identity: { dev: 2049, ino: 100 },
        readOnly: false,
      },
      {
        role: "staging",
        configuredPath: "/workspace/staging",
        canonicalPath: "/workspace/staging",
        identity: { dev: 2049, ino: 101 },
        readOnly: false,
      },
    ],
  };

  const target: CanonicalTarget = {
    acpSessionId: "session-1",
    sessionContextGeneration: "gen-42",
    roles: ["workspace", "staging"],
    rootIdentities: roots.roots,
    normalizedInput: "staging/task.json",
    canonicalTarget: "/workspace/staging/task.json",
    rootRelativePath: "staging/task.json",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 300 },
    observedSymlinks: [],
  };

  const stagingAdmission = validateAccessAdmission(context, roots, target, "staging", false);
  assertEquals(stagingAdmission.ok, true);
  if (stagingAdmission.ok) {
    assertEquals(stagingAdmission.value.relativePath, "task.json");
    assertEquals(stagingAdmission.value.selectedRoot.role, "staging");
  }

  const workspaceAdmission = validateAccessAdmission(context, roots, target, "workspace", false);
  assertEquals(workspaceAdmission.ok, true);
  if (workspaceAdmission.ok) {
    assertEquals(workspaceAdmission.value.relativePath, "staging/task.json");
    assertEquals(workspaceAdmission.value.selectedRoot.role, "workspace");
  }
});

Deno.test("End-to-end with real predecessor canonicalizeSessionRoots and resolveFilesystemTarget", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const wsDir = `${tempDir}/ws`;
    const stagingDir = `${wsDir}/tmp/skill-1`;
    await Deno.mkdir(stagingDir, { recursive: true });

    const testFile = `${wsDir}/hello.txt`;
    await Deno.writeTextFile(testFile, "Predecessor observation content");

    const context: SessionContext = {
      acpSessionId: "sess-real-1",
      skillSessionId: "skill-1",
      sessionCwd: wsDir,
      explicitStagingPath: stagingDir,
      sessionContextGeneration: "gen-real-1",
    };

    const rootsRes = await canonicalizeSessionRoots(context);
    assertEquals(rootsRes.ok, true);
    if (!rootsRes.ok) return;

    const targetRes = await resolveFilesystemTarget(
      {
        acpSessionId: "sess-real-1",
        sessionContextGeneration: "gen-real-1",
        rawPath: "hello.txt",
        expandedPath: `${wsDir}/hello.txt`,
        normalizedPath: `${wsDir}/hello.txt`,
      },
      rootsRes.value,
      "existing-file",
    );
    assertEquals(targetRes.ok, true);
    if (!targetRes.ok) return;

    const admission = validateAccessAdmission(
      context,
      rootsRes.value,
      targetRes.value,
      "workspace",
      false,
    );
    assertEquals(admission.ok, true);
    if (admission.ok) {
      assertEquals(admission.value.relativePath, "hello.txt");
      assertEquals(admission.value.isNewFile, false);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
