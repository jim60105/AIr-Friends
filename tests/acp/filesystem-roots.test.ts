/**
 * Tests for Canonical ACP Filesystem Roots & Target Resolution
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join, resolve } from "node:path";
import {
  canonicalizeSessionRoots,
  type MetadataReader,
  type ObservedIdentity,
  resolveFilesystemTarget,
  resolveSessionPath,
  type RootPathResult,
  type SessionContext,
  type TrustedSkillsRootConfig,
} from "../../src/acp/filesystem-roots.ts";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { Stats } from "node:fs";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

function unwrap<T>(result: RootPathResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok result, got failure: ${result.reason} - ${result.message}`);
  }
  return result.value;
}

/** Minimal `Stats` seam fixture. */
function fakeStats(flags: { file?: boolean; dir?: boolean; symlink?: boolean }): Stats {
  return {
    isFile: () => flags.file === true,
    isDirectory: () => flags.dir === true,
    isSymbolicLink: () => flags.symlink === true,
  } as Stats;
}

// -----------------------------------------------------------------------------
// Task 3.1: Token expansion, contextual paths, root equality vs sibling prefix
// -----------------------------------------------------------------------------

test("Task 3.1: Context validation rejects invalid session contexts", () => {
  const baseContext: SessionContext = {
    acpSessionId: "sess-1",
    skillSessionId: "skill-1",
    sessionCwd: "/tmp/workspace",
    explicitStagingPath: "/tmp/workspace/tmp/skill-1",
    sessionContextGeneration: "gen-1",
  };

  // Missing or empty IDs
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, acpSessionId: "" }).ok,
    false,
  );
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, skillSessionId: "." }).ok,
    false,
  );
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, skillSessionId: ".." }).ok,
    false,
  );
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, skillSessionId: "a/b" }).ok,
    false,
  );

  // Non-absolute cwd or staging
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, sessionCwd: "relative/path" }).ok,
    false,
  );
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, explicitStagingPath: "relative/staging" }).ok,
    false,
  );

  // Mismatched staging path
  assertEquals(
    resolveSessionPath("notes.md", {
      ...baseContext,
      explicitStagingPath: "/tmp/workspace/tmp/other-skill",
    }).ok,
    false,
  );

  // Empty generation
  assertEquals(
    resolveSessionPath("notes.md", { ...baseContext, sessionContextGeneration: "" }).ok,
    false,
  );
});

test("Task 3.1: Token expansion handles legacy braced and unbraced tokens", () => {
  const context: SessionContext = {
    acpSessionId: "acp-100",
    skillSessionId: "skill-200",
    sessionCwd: "/data/users/alice",
    explicitStagingPath: "/data/users/alice/tmp/skill-200",
    sharedWorkspacePath: "/data/agent-workspace",
    sessionContextGeneration: "gen-1",
  };

  // Equivalent tokens expand identically
  const resBraced = unwrap(
    resolveSessionPath("${TMPDIR}/${SESSION_ID}/payload.md", context),
  );
  const resUnbraced = unwrap(
    resolveSessionPath("$TMPDIR/$SESSION_ID/payload.md", context),
  );
  const resRelative = unwrap(
    resolveSessionPath("tmp/skill-200/payload.md", context),
  );
  const resAbsolute = unwrap(
    resolveSessionPath("/data/users/alice/tmp/skill-200/payload.md", context),
  );

  assertEquals(resBraced.normalizedPath, "/data/users/alice/tmp/skill-200/payload.md");
  assertEquals(resUnbraced.normalizedPath, "/data/users/alice/tmp/skill-200/payload.md");
  assertEquals(resRelative.normalizedPath, "/data/users/alice/tmp/skill-200/payload.md");
  assertEquals(resAbsolute.normalizedPath, "/data/users/alice/tmp/skill-200/payload.md");

  // Shared agent workspace
  const resSharedBraced = unwrap(
    resolveSessionPath("${AGENT_WORKSPACE}/shared-notes.md", context),
  );
  const resSharedUnbraced = unwrap(
    resolveSessionPath("$AGENT_WORKSPACE/shared-notes.md", context),
  );
  assertEquals(resSharedBraced.normalizedPath, "/data/agent-workspace/shared-notes.md");
  assertEquals(resSharedUnbraced.normalizedPath, "/data/agent-workspace/shared-notes.md");

  // Relative path anchors to sessionCwd, NOT process.cwd()
  const relNotes = unwrap(resolveSessionPath("notes.md", context));
  assertEquals(relNotes.normalizedPath, "/data/users/alice/notes.md");
  assertNotEquals(relNotes.normalizedPath, resolve(process.cwd(), "notes.md"));
});

test("Task 3.1: Token expansion rejects unknown tokens, boundary collisions, devices and URIs", () => {
  const context: SessionContext = {
    acpSessionId: "acp-100",
    skillSessionId: "skill-200",
    sessionCwd: "/data/users/alice",
    explicitStagingPath: "/data/users/alice/tmp/skill-200",
    sessionContextGeneration: "gen-1",
  };

  // Unknown tokens and variable boundary collisions
  assertEquals(
    resolveSessionPath("$TMPDIR2/file.txt", context),
    {
      ok: false,
      reason: "unresolved_token",
      message: "Path contains unresolved variable or shell token: '$TMPDIR2/file.txt'",
    },
  );
  assertEquals(
    resolveSessionPath("$SESSION_ID2/file.txt", context),
    {
      ok: false,
      reason: "unresolved_token",
      message: "Path contains unresolved variable or shell token: '$SESSION_ID2/file.txt'",
    },
  );
  assertEquals(
    resolveSessionPath("$HOME/file.txt", context),
    {
      ok: false,
      reason: "unresolved_token",
      message: "Path contains unresolved variable or shell token: '$HOME/file.txt'",
    },
  );
  assertEquals(
    resolveSessionPath("${OTHER}/file.txt", context),
    {
      ok: false,
      reason: "unresolved_token",
      message: "Path contains unresolved variable or shell token: '${OTHER}/file.txt'",
    },
  );

  // Missing shared workspace when token is requested
  assertEquals(
    resolveSessionPath("$AGENT_WORKSPACE/file.txt", context).ok,
    false,
  );

  // Invalid paths: empty, null byte, URI schemes, device syntax
  assertEquals(resolveSessionPath("", context).ok, false);
  assertEquals(resolveSessionPath("notes\0.md", context).ok, false);
  assertEquals(resolveSessionPath("http://example.com/file", context).ok, false);
  assertEquals(resolveSessionPath("skill://my-skill/doc", context).ok, false);
  assertEquals(resolveSessionPath("file:///etc/passwd", context).ok, false);
  assertEquals(resolveSessionPath("/dev/null", context).ok, false);
  assertEquals(resolveSessionPath("\\\\.\\pipe\\test", context).ok, false);
});

// -----------------------------------------------------------------------------
// Task 3.2: Real temporary filesystems, symlinks, containment, and escapes
// -----------------------------------------------------------------------------

test("Task 3.2: Canonical roots, host-provisioned aliases, and prospective staging", async () => {
  const tempDir = await makeTempDir({ prefix: "canon_root_test_" });
  try {
    const workspaceReal = join(tempDir, "workspace");
    await fsp.mkdir(workspaceReal);

    // Host-provisioned symlink alias to workspace
    const workspaceAlias = join(tempDir, "workspace-alias");
    await fsp.symlink(workspaceReal, workspaceAlias);

    const context: SessionContext = {
      acpSessionId: "session-a",
      skillSessionId: "skill-x",
      sessionCwd: workspaceAlias,
      explicitStagingPath: join(workspaceAlias, "tmp", "skill-x"),
      sessionContextGeneration: "gen-42",
    };

    // Staging does not exist yet (prospective)
    const rootsRes = await canonicalizeSessionRoots(context);
    const roots = unwrap(rootsRes);

    const wsRoot = roots.roots.find((r) => r.role === "workspace")!;
    assertEquals(wsRoot.configuredPath, workspaceAlias);
    assertEquals(wsRoot.canonicalPath, await fsp.realpath(workspaceReal));

    const stagingRoot = roots.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot.isProspective, true);
    assertEquals(stagingRoot.prospectiveAncestor, await fsp.realpath(workspaceReal));
    assertEquals(stagingRoot.prospectiveMissingSuffix, ["tmp", "skill-x"]);
    assertEquals(
      stagingRoot.canonicalPath,
      resolve(await fsp.realpath(workspaceReal), "tmp", "skill-x"),
    );

    // Now create tmp directory; prospective staging should anchor at tmp
    await fsp.mkdir(join(workspaceReal, "tmp"));
    const rootsRes2 = await canonicalizeSessionRoots(context);
    const roots2 = unwrap(rootsRes2);
    const stagingRoot2 = roots2.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot2.isProspective, true);
    assertEquals(
      stagingRoot2.prospectiveAncestor,
      resolve(await fsp.realpath(workspaceReal), "tmp"),
    );
    assertEquals(stagingRoot2.prospectiveMissingSuffix, ["skill-x"]);

    // Now create physical staging
    await fsp.mkdir(join(workspaceReal, "tmp", "skill-x"));
    const rootsRes3 = await canonicalizeSessionRoots(context);
    const roots3 = unwrap(rootsRes3);
    const stagingRoot3 = roots3.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot3.isProspective, undefined);
    assertEquals(
      stagingRoot3.canonicalPath,
      resolve(await fsp.realpath(workspaceReal), "tmp", "skill-x"),
    );
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Task 3.2: Staging alias to other session or ordinary directory fails root construction", async () => {
  const tempDir = await makeTempDir({ prefix: "staging_alias_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    await fsp.mkdir(workspace);
    await fsp.mkdir(join(workspace, "tmp"));

    // Staging links to a sibling session directory
    const siblingStaging = join(workspace, "tmp", "skill-sibling");
    await fsp.mkdir(siblingStaging);

    const myStaging = join(workspace, "tmp", "skill-me");
    await fsp.symlink(siblingStaging, myStaging);

    const context: SessionContext = {
      acpSessionId: "sess-me",
      skillSessionId: "skill-me",
      sessionCwd: workspace,
      explicitStagingPath: myStaging,
      sessionContextGeneration: "gen-1",
    };

    const res = await canonicalizeSessionRoots(context);
    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.reason, "invalid_root");
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Task 3.2: Dangling staging symlink fails closed with dangling_symlink", async () => {
  const tempDir = await makeTempDir({ prefix: "dangling_staging_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    await fsp.mkdir(workspace);
    await fsp.mkdir(join(workspace, "tmp"));

    // Staging links to a nonexistent destination
    const stagingLink = join(workspace, "tmp", "skill-dangling");
    await fsp.symlink(join(workspace, "tmp", "does-not-exist"), stagingLink);

    const context: SessionContext = {
      acpSessionId: "session-dang",
      skillSessionId: "skill-dangling",
      sessionCwd: workspace,
      explicitStagingPath: stagingLink,
      sessionContextGeneration: "gen-1",
    };

    const res = await canonicalizeSessionRoots(context);
    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.reason, "dangling_symlink");
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Task 3.2: Prospective staging target receives staging role", async () => {
  const tempDir = await makeTempDir({ prefix: "prosp_staging_role_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    await fsp.mkdir(workspace);

    const context: SessionContext = {
      acpSessionId: "session-prosp",
      skillSessionId: "skill-prosp",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-prosp"),
      sessionContextGeneration: "gen-1",
    };

    const roots = unwrap(await canonicalizeSessionRoots(context));
    const stagingRoot = roots.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot.isProspective, true);

    // Requesting prospective file inside prospective staging
    const pathRes = unwrap(
      resolveSessionPath("tmp/skill-prosp/new-payload.md", context),
    );
    const targetRes = unwrap(
      await resolveFilesystemTarget(pathRes, roots, "file-or-new"),
    );

    // Must receive both workspace and staging roles!
    assertEquals(targetRes.roles.includes("workspace"), true);
    assertEquals(targetRes.roles.includes("staging"), true);
    assertEquals(targetRes.targetType, "prospective");
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Task 3.2: Existing directory rejected under file-or-new", async () => {
  const tempDir = await makeTempDir({ prefix: "dir_file_or_new_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    await fsp.mkdir(workspace);
    const existingSubdir = join(workspace, "my-dir");
    await fsp.mkdir(existingSubdir);

    const context: SessionContext = {
      acpSessionId: "session-dir",
      skillSessionId: "skill-dir",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-dir"),
      sessionContextGeneration: "gen-1",
    };

    const roots = unwrap(await canonicalizeSessionRoots(context));
    const pathRes = unwrap(resolveSessionPath("my-dir", context));

    // file-or-new on an existing directory MUST fail with wrong_target_type
    const resFileOrNew = await resolveFilesystemTarget(
      pathRes,
      roots,
      "file-or-new",
    );
    assertEquals(resFileOrNew.ok, false);
    if (!resFileOrNew.ok) {
      assertEquals(resFileOrNew.reason, "wrong_target_type");
    }

    // existing-directory MUST succeed
    const resDir = unwrap(
      await resolveFilesystemTarget(pathRes, roots, "existing-directory"),
    );
    assertEquals(resDir.targetType, "directory");
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("Task 3.2: Internal vs escaping symlinks and boundary-safe containment", async () => {
  const tempDir = await makeTempDir({ prefix: "symlink_containment_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    const siblingDir = join(tempDir, "workspace-sibling");
    const externalDir = join(tempDir, "external");
    await fsp.mkdir(workspace);
    await fsp.mkdir(siblingDir);
    await fsp.mkdir(externalDir);

    // 1. In-workspace legitimate file and in-workspace symlink
    const realFile = join(workspace, "real.txt");
    await fsp.writeFile(realFile, "hello");
    const linkToFile = join(workspace, "link-to-real.txt");
    await fsp.symlink(realFile, linkToFile);

    // 2. Escaping symlinks: parent symlink and final-file symlink
    const linkToSibling = join(workspace, "link-to-sibling");
    await fsp.symlink(siblingDir, linkToSibling);

    const externalFile = join(externalDir, "secret.txt");
    await fsp.writeFile(externalFile, "secret");
    const linkToExternal = join(workspace, "link-to-external.txt");
    await fsp.symlink(externalFile, linkToExternal);

    // 3. Dangling symlink
    const danglingLink = join(workspace, "dangling.txt");
    await fsp.symlink(join(workspace, "non-existent.txt"), danglingLink);

    // 4. Staging child link to ordinary workspace directory
    await fsp.mkdir(join(workspace, "tmp"));
    await fsp.mkdir(join(workspace, "tmp", "skill-1"));
    const ordinaryDir = join(workspace, "ordinary");
    await fsp.mkdir(ordinaryDir);
    const ordinaryFile = join(ordinaryDir, "doc.txt");
    await fsp.writeFile(ordinaryFile, "content");
    const stagingChildLink = join(workspace, "tmp", "skill-1", "alias-to-ordinary");
    await fsp.symlink(ordinaryDir, stagingChildLink);

    const context: SessionContext = {
      acpSessionId: "session-1",
      skillSessionId: "skill-1",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-1"),
      sessionContextGeneration: "gen-1",
    };

    const roots = unwrap(await canonicalizeSessionRoots(context));

    // Test in-workspace contained symlink
    const pathLink = unwrap(resolveSessionPath("link-to-real.txt", context));
    const targetLink = unwrap(
      await resolveFilesystemTarget(pathLink, roots, "existing-file"),
    );
    assertEquals(targetLink.canonicalTarget, await fsp.realpath(realFile));
    assertEquals(targetLink.roles, ["workspace"]);
    assertEquals(targetLink.observedSymlinks.length, 1);

    // Test escaping link to sibling prefix
    const pathSibling = unwrap(resolveSessionPath("link-to-sibling", context));
    const targetSiblingRes = await resolveFilesystemTarget(
      pathSibling,
      roots,
      "existing-directory",
    );
    assertEquals(targetSiblingRes.ok, false);
    if (!targetSiblingRes.ok) {
      assertEquals(targetSiblingRes.reason, "symlink_escape");
    }

    // Test escaping link to external directory
    const pathExt = unwrap(resolveSessionPath("link-to-external.txt", context));
    const targetExtRes = await resolveFilesystemTarget(
      pathExt,
      roots,
      "existing-file",
    );
    assertEquals(targetExtRes.ok, false);
    if (!targetExtRes.ok) {
      assertEquals(targetExtRes.reason, "symlink_escape");
    }

    // Test dangling symlink fails closed
    const pathDangling = unwrap(resolveSessionPath("dangling.txt", context));
    const targetDanglingRes = await resolveFilesystemTarget(
      pathDangling,
      roots,
      "file-or-new",
    );
    assertEquals(targetDanglingRes.ok, false);
    if (!targetDanglingRes.ok) {
      assertEquals(targetDanglingRes.reason, "dangling_symlink");
    }

    // Test staging child link to ordinary directory:
    // Retains broad workspace membership, but does NOT gain staging role!
    const pathStagingChild = unwrap(
      resolveSessionPath("tmp/skill-1/alias-to-ordinary/doc.txt", context),
    );
    const targetStagingChild = unwrap(
      await resolveFilesystemTarget(pathStagingChild, roots, "existing-file"),
    );
    assertEquals(targetStagingChild.roles, ["workspace"]);
    assertEquals(targetStagingChild.roles.includes("staging"), false);
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

// -----------------------------------------------------------------------------
// Task 3.3: Mocked metadata reader error fixtures, loops, and critical skills
// -----------------------------------------------------------------------------

test("Task 3.3: Symlink loops, inaccessible metadata and inconsistency", async () => {
  const context: SessionContext = {
    acpSessionId: "session-1",
    skillSessionId: "skill-1",
    sessionCwd: "/workspace",
    explicitStagingPath: "/workspace/tmp/skill-1",
    sessionContextGeneration: "gen-1",
  };

  // Mock reader for symlink loop
  const loopReader: MetadataReader = {
    lstat: (path: string) => {
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve(fakeStats({ dir: true }));
      }
      return Promise.resolve(fakeStats({ symlink: true }));
    },
    realPath: (path: string) => {
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve(path);
      }
      return Promise.reject(
        Object.assign(new Error("Too many levels of symbolic links"), { code: "ELOOP" }),
      );
    },
  };

  const roots = unwrap(await canonicalizeSessionRoots(context, undefined, loopReader));
  const resolvedPath = unwrap(resolveSessionPath("looped-link", context));

  const targetRes = await resolveFilesystemTarget(
    resolvedPath,
    roots,
    "existing-file",
    loopReader,
  );
  assertEquals(targetRes.ok, false);
  if (!targetRes.ok) {
    assertEquals(targetRes.reason, "symlink_loop");
  }

  // Mock reader where target disappears between observations (path_changed)
  // oxlint-disable-next-line no-unused-vars
  let callCount = 0;
  const disappearingReader: MetadataReader = {
    lstat: (path: string) => {
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve(fakeStats({ dir: true }));
      }
      return Promise.resolve(fakeStats({ file: true }));
    },
    realPath: (path: string) => {
      callCount++;
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve(path);
      }
      // On second check, simulate target deleted/changed
      return Promise.reject(
        Object.assign(new Error("No such file or directory"), { code: "ENOENT" }),
      );
    },
  };

  const roots2 = unwrap(await canonicalizeSessionRoots(context, undefined, disappearingReader));
  const resolvedTarget = unwrap(resolveSessionPath("file.txt", context));
  const changedRes = await resolveFilesystemTarget(
    resolvedTarget,
    roots2,
    "existing-file",
    disappearingReader,
  );
  assertEquals(changedRes.ok, false);
  if (!changedRes.ok) {
    assertEquals(changedRes.reason, "path_changed");
  }
});

test("Task 3.3: Critical skills contract validation, disjointness and rejection", async () => {
  const tempDir = await makeTempDir({ prefix: "crit_skills_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    const skillsRoot = join(tempDir, "skills-root");
    await fsp.mkdir(workspace);
    await fsp.mkdir(skillsRoot);

    const context: SessionContext = {
      acpSessionId: "session-1",
      skillSessionId: "skill-1",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-1"),
      sessionContextGeneration: "gen-1",
    };

    // 1. Root overlap check: if skills root is inside workspace, fail root
    // construction. Row 28: the identity hardening is unconditional, so the
    // fixture seals the stand-in owned tree and passes its real identity, the
    // way the producer always does.
    const identityOf = (path: string): ObservedIdentity => {
      const info = fs.statSync(path);
      if (info.dev === null || info.ino === null) {
        throw new Error("fixture identity unavailable");
      }
      return { dev: info.dev, ino: info.ino };
    };
    fs.chmodSync(workspace, 0o555);
    const overlappingSkillsConfig: TrustedSkillsRootConfig = {
      ownedRootPath: workspace,
      source: "deployment_owned",
      rootIdentity: identityOf(workspace),
    };
    const overlapRes = await canonicalizeSessionRoots(context, overlappingSkillsConfig);
    fs.chmodSync(workspace, 0o755);
    assertEquals(overlapRes.ok, false);
    if (!overlapRes.ok) {
      assertEquals(overlapRes.reason, "root_overlap");
    }

    // 2. Disjoint trusted skills root succeeds with an attested identity
    fs.chmodSync(skillsRoot, 0o555);
    const trustedConfig: TrustedSkillsRootConfig = {
      ownedRootPath: skillsRoot,
      source: "deployment_owned",
      rootIdentity: identityOf(skillsRoot),
    };
    const roots = unwrap(await canonicalizeSessionRoots(context, trustedConfig));
    const skillsRootInfo = roots.roots.find((r) => r.role === "trusted-skills")!;
    assertEquals(skillsRootInfo.readOnly, true);

    // 2b. `align-omp-skill-trust-to-shared-root` D1: the SAME root with the
    // packaged personal tree's own `775` posture (group/other-writable) is
    // STILL admitted — ownership and permission bits are not admission inputs,
    // while identity, canonical spelling and writable-root disjointness are.
    fs.chmodSync(skillsRoot, 0o775);
    const writableTrustedConfig: TrustedSkillsRootConfig = {
      ownedRootPath: skillsRoot,
      source: "deployment_owned",
      rootIdentity: identityOf(skillsRoot),
    };
    const writableRoots = unwrap(await canonicalizeSessionRoots(context, writableTrustedConfig));
    assertEquals(
      writableRoots.roots.find((r) => r.role === "trusted-skills")!.readOnly,
      true,
    );
    fs.chmodSync(skillsRoot, 0o555);

    // Row 28 review follow-up: the dead resolveFilesystemTarget criticalRef
    // ladder is removed; the live client admission gate (identity/source/
    // session/generation/canonical-path binding and workspace-spoof denial)
    // is exercised end-to-end in tests/acp/filesystem-authorization.test.ts.
    // An UNATTESTED root (no rootIdentity) now fails construction outright.
    const unattestedRes = await canonicalizeSessionRoots(context, {
      ownedRootPath: skillsRoot,
      source: "deployment_owned",
    });
    assertEquals(unattestedRes.ok, false);
    if (!unattestedRes.ok) {
      assertEquals(unattestedRes.reason, "trusted_identity_mismatch");
    }
  } finally {
    try {
      fs.chmodSync(join(tempDir, "skills-root"), 0o755);
      fs.chmodSync(join(tempDir, "workspace"), 0o755);
    } catch {
      // Already unsealed or gone.
    }
    await fsp.rm(tempDir, { recursive: true });
  }
});

// -----------------------------------------------------------------------------
// Task 3.4: Agent-neutral OpenCode/OMP helper contexts and YOLO expectations
// -----------------------------------------------------------------------------

test("Task 3.4: Agent-neutral OpenCode/OMP contexts and broad workspace membership", async () => {
  const tempDir = await makeTempDir({ prefix: "agent_neutral_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    const sharedWorkspace = join(tempDir, "shared-workspace");
    await fsp.mkdir(workspace);
    await fsp.mkdir(sharedWorkspace);

    // In-workspace state files (e.g. .opencode / session data)
    const stateDir = join(workspace, ".opencode");
    await fsp.mkdir(stateDir);
    const stateFile = join(stateDir, "session.json");
    await fsp.writeFile(stateFile, "{}");

    // Agent-neutral context (works equally for OpenCode and OMP)
    const context: SessionContext = {
      acpSessionId: "omp-session-1",
      skillSessionId: "skill-omp-1",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-omp-1"),
      sharedWorkspacePath: sharedWorkspace,
      sessionContextGeneration: "gen-2026",
    };

    const roots = unwrap(await canonicalizeSessionRoots(context));

    // In-workspace state file retains broad workspace membership
    const statePath = unwrap(resolveSessionPath(".opencode/session.json", context));
    const stateTarget = unwrap(
      await resolveFilesystemTarget(statePath, roots, "existing-file"),
    );
    assertEquals(stateTarget.roles, ["workspace"]);
    assertEquals(stateTarget.canonicalTarget, await fsp.realpath(stateFile));

    // Shared workspace file retains shared membership
    const sharedFile = join(sharedWorkspace, "shared-context.md");
    await fsp.writeFile(sharedFile, "# Shared");
    const sharedPath = unwrap(
      resolveSessionPath("$AGENT_WORKSPACE/shared-context.md", context),
    );
    const sharedTarget = unwrap(
      await resolveFilesystemTarget(sharedPath, roots, "existing-file"),
    );
    assertEquals(sharedTarget.roles, ["shared"]);
    assertEquals(sharedTarget.canonicalTarget, await fsp.realpath(sharedFile));

    // External escape attempt fails closed without restricted clamp
    const outsideTarget = resolveSessionPath("/etc/hosts", context);
    assertEquals(outsideTarget.ok, true);
    if (outsideTarget.ok) {
      const outsideRes = await resolveFilesystemTarget(
        outsideTarget.value,
        roots,
        "existing-file",
      );
      assertEquals(outsideRes.ok, false);
      if (!outsideRes.ok) {
        assertEquals(outsideRes.reason, "outside_roots");
      }
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("OMP native state: reservation, optional artifact root and reserved precedence", async () => {
  const tempDir = await makeTempDir();
  try {
    const workspace = join(tempDir, "workspace");
    const sharedWorkspace = join(workspace, "shared");
    const dataRoot = join(workspace, "tmp", "omp-agent", "restricted", "xdg-data");
    const bucket = join(dataRoot, "omp", "sessions", "-tmp-workspace");
    const journalPath = join(
      bucket,
      "2026-01-02T03-04-05-678Z_0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl",
    );
    await fsp.mkdir(sharedWorkspace, { recursive: true });
    await fsp.mkdir(bucket, { recursive: true });
    const artifactDirectory = journalPath.slice(0, -".jsonl".length);
    await fsp.writeFile(journalPath, '{"type":"session"}\n');

    const dataInfo = await fsp.lstat(dataRoot);
    const anchorInfo = await fsp.lstat(bucket);
    const journalInfo = await fsp.lstat(journalPath);
    const context: SessionContext = {
      acpSessionId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      skillSessionId: "skill-1",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-1"),
      sharedWorkspacePath: sharedWorkspace,
      sessionContextGeneration: "gen-omp",
      ompNativeState: {
        cwd: workspace,
        nativeDataRoot: dataRoot,
        dataRootIdentity: { dev: dataInfo.dev!, ino: dataInfo.ino! },
        artifacts: {
          acpSessionId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
          journalPath,
          journalIdentity: { dev: journalInfo.dev!, ino: journalInfo.ino! },
          anchorDirectory: bucket,
          anchorIdentity: { dev: anchorInfo.dev!, ino: anchorInfo.ino! },
        },
      },
    };

    const roots = unwrap(await canonicalizeSessionRoots(context));
    assertEquals(roots.reservedOmpState, [
      join(workspace, "tmp", "omp-agent"),
      dataRoot,
    ]);
    // The artifact directory does not exist yet: the capability is prospective
    // and creates nothing.
    const prospective = roots.roots.find((root) => root.role === "omp-session-artifacts");
    assertEquals(prospective?.isProspective, true);
    assertEquals(prospective?.prospectiveAncestor, bucket);
    assertEquals(await fsp.lstat(artifactDirectory).catch(() => null), null);

    // A native-state target can be admitted by no broad role.
    const journalTarget = unwrap(
      await resolveSessionPath(journalPath, context),
    );
    const journalObservation = await resolveFilesystemTarget(
      journalTarget,
      roots,
      "existing-file",
    );
    assertEquals(journalObservation.ok, false);
    if (!journalObservation.ok) {
      assertEquals(journalObservation.reason, "reserved_native_state");
    }
    // Ordinary workspace files keep their broad membership.
    const ordinaryPath = unwrap(resolveSessionPath(join(sharedWorkspace, "note.jsonl"), context));
    await fsp.writeFile(join(sharedWorkspace, "note.jsonl"), "{}");
    const sharedObservation = unwrap(
      await resolveFilesystemTarget(ordinaryPath, roots, "existing-file"),
    );
    assertEquals(sharedObservation.roles, ["workspace", "shared"]);

    // A bound identity that no longer matches the directory denies the whole
    // artifact capability (no partial grant).
    await fsp.mkdir(artifactDirectory);
    const artifactInfo = await fsp.lstat(artifactDirectory);
    const rebound = unwrap(
      await canonicalizeSessionRoots({
        ...context,
        ompNativeState: {
          ...context.ompNativeState!,
          artifacts: {
            ...context.ompNativeState!.artifacts!,
            artifactDirectoryIdentity: { dev: artifactInfo.dev!, ino: -1 },
          },
        },
      }),
    );
    assertEquals(
      rebound.roots.find((root) => root.role === "omp-session-artifacts"),
      undefined,
    );
    const originalIdentity = unwrap(
      await canonicalizeSessionRoots({
        ...context,
        ompNativeState: {
          ...context.ompNativeState!,
          artifacts: {
            ...context.ompNativeState!.artifacts!,
            artifactDirectoryIdentity: { dev: artifactInfo.dev!, ino: artifactInfo.ino! },
          },
        },
      }),
    );
    const boundArtifactRoot = originalIdentity.roots.find(
      (root) => root.role === "omp-session-artifacts",
    );
    assertEquals(boundArtifactRoot?.isProspective, undefined);
    assertEquals(boundArtifactRoot?.readOnly, true);

    // A reservation overlapping the shared writable root is refused outright.
    const overlapping = await canonicalizeSessionRoots({
      ...context,
      sharedWorkspacePath: join(workspace, "tmp"),
    });
    assertEquals(overlapping.ok, false);
    if (!overlapping.ok) assertEquals(overlapping.reason, "root_overlap");

    // A provenance for another cwd is rejected as an invalid context.
    const movedCwd = await canonicalizeSessionRoots({
      ...context,
      ompNativeState: { ...context.ompNativeState!, cwd: tempDir },
    });
    assertEquals(movedCwd.ok, false);
    if (!movedCwd.ok) assertEquals(movedCwd.reason, "invalid_context");
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});
