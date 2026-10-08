/**
 * Tests for Canonical ACP Filesystem Roots & Target Resolution
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  canonicalizeSessionRoots,
  type CriticalSkillReference,
  type MetadataReader,
  resolveFilesystemTarget,
  resolveSessionPath,
  type RootPathResult,
  type SessionContext,
  type TrustedSkillsRootConfig,
} from "../../src/acp/filesystem-roots.ts";

function unwrap<T>(result: RootPathResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok result, got failure: ${result.reason} - ${result.message}`);
  }
  return result.value;
}

// -----------------------------------------------------------------------------
// Task 3.1: Token expansion, contextual paths, root equality vs sibling prefix
// -----------------------------------------------------------------------------

Deno.test("Task 3.1: Context validation rejects invalid session contexts", () => {
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

Deno.test("Task 3.1: Token expansion handles legacy braced and unbraced tokens", () => {
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

  // Relative path anchors to sessionCwd, NOT Deno.cwd()
  const relNotes = unwrap(resolveSessionPath("notes.md", context));
  assertEquals(relNotes.normalizedPath, "/data/users/alice/notes.md");
  assertNotEquals(relNotes.normalizedPath, resolve(Deno.cwd(), "notes.md"));
});

Deno.test("Task 3.1: Token expansion rejects unknown tokens, boundary collisions, devices and URIs", () => {
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

Deno.test("Task 3.2: Canonical roots, host-provisioned aliases, and prospective staging", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "canon_root_test_" });
  try {
    const workspaceReal = join(tempDir, "workspace");
    await Deno.mkdir(workspaceReal);

    // Host-provisioned symlink alias to workspace
    const workspaceAlias = join(tempDir, "workspace-alias");
    await Deno.symlink(workspaceReal, workspaceAlias);

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
    assertEquals(wsRoot.canonicalPath, await Deno.realPath(workspaceReal));

    const stagingRoot = roots.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot.isProspective, true);
    assertEquals(stagingRoot.prospectiveAncestor, await Deno.realPath(workspaceReal));
    assertEquals(stagingRoot.prospectiveMissingSuffix, ["tmp", "skill-x"]);
    assertEquals(
      stagingRoot.canonicalPath,
      resolve(await Deno.realPath(workspaceReal), "tmp", "skill-x"),
    );

    // Now create tmp directory; prospective staging should anchor at tmp
    await Deno.mkdir(join(workspaceReal, "tmp"));
    const rootsRes2 = await canonicalizeSessionRoots(context);
    const roots2 = unwrap(rootsRes2);
    const stagingRoot2 = roots2.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot2.isProspective, true);
    assertEquals(stagingRoot2.prospectiveAncestor, resolve(await Deno.realPath(workspaceReal), "tmp"));
    assertEquals(stagingRoot2.prospectiveMissingSuffix, ["skill-x"]);

    // Now create physical staging
    await Deno.mkdir(join(workspaceReal, "tmp", "skill-x"));
    const rootsRes3 = await canonicalizeSessionRoots(context);
    const roots3 = unwrap(rootsRes3);
    const stagingRoot3 = roots3.roots.find((r) => r.role === "staging")!;
    assertEquals(stagingRoot3.isProspective, undefined);
    assertEquals(
      stagingRoot3.canonicalPath,
      resolve(await Deno.realPath(workspaceReal), "tmp", "skill-x"),
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Task 3.2: Staging alias to other session or ordinary directory fails root construction", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "staging_alias_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    await Deno.mkdir(workspace);
    await Deno.mkdir(join(workspace, "tmp"));

    // Staging links to a sibling session directory
    const siblingStaging = join(workspace, "tmp", "skill-sibling");
    await Deno.mkdir(siblingStaging);

    const myStaging = join(workspace, "tmp", "skill-me");
    await Deno.symlink(siblingStaging, myStaging);

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
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Task 3.2: Internal vs escaping symlinks and boundary-safe containment", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "symlink_containment_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    const siblingDir = join(tempDir, "workspace-sibling");
    const externalDir = join(tempDir, "external");
    await Deno.mkdir(workspace);
    await Deno.mkdir(siblingDir);
    await Deno.mkdir(externalDir);

    const canonicalWs = await Deno.realPath(workspace);

    // 1. In-workspace legitimate file and in-workspace symlink
    const realFile = join(workspace, "real.txt");
    await Deno.writeTextFile(realFile, "hello");
    const linkToFile = join(workspace, "link-to-real.txt");
    await Deno.symlink(realFile, linkToFile);

    // 2. Escaping symlinks: parent symlink and final-file symlink
    const linkToSibling = join(workspace, "link-to-sibling");
    await Deno.symlink(siblingDir, linkToSibling);

    const externalFile = join(externalDir, "secret.txt");
    await Deno.writeTextFile(externalFile, "secret");
    const linkToExternal = join(workspace, "link-to-external.txt");
    await Deno.symlink(externalFile, linkToExternal);

    // 3. Dangling symlink
    const danglingLink = join(workspace, "dangling.txt");
    await Deno.symlink(join(workspace, "non-existent.txt"), danglingLink);

    // 4. Staging child link to ordinary workspace directory
    await Deno.mkdir(join(workspace, "tmp"));
    await Deno.mkdir(join(workspace, "tmp", "skill-1"));
    const ordinaryDir = join(workspace, "ordinary");
    await Deno.mkdir(ordinaryDir);
    const ordinaryFile = join(ordinaryDir, "doc.txt");
    await Deno.writeTextFile(ordinaryFile, "content");
    const stagingChildLink = join(workspace, "tmp", "skill-1", "alias-to-ordinary");
    await Deno.symlink(ordinaryDir, stagingChildLink);

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
    assertEquals(targetLink.canonicalTarget, await Deno.realPath(realFile));
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
    await Deno.remove(tempDir, { recursive: true });
  }
});

// -----------------------------------------------------------------------------
// Task 3.3: Mocked metadata reader error fixtures, loops, and critical skills
// -----------------------------------------------------------------------------

Deno.test("Task 3.3: Symlink loops, inaccessible metadata and inconsistency", async () => {
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
        return Promise.resolve({
          isFile: false,
          isDirectory: true,
          isSymlink: false,
        } as Deno.FileInfo);
      }
      return Promise.resolve({
        isFile: false,
        isDirectory: false,
        isSymlink: true,
      } as Deno.FileInfo);
    },
    realPath: (path: string) => {
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve(path);
      }
      const err = new Error("Too many levels of symbolic links");
      err.name = "FilesystemLoop";
      return Promise.reject(err);
    },
  };

  const roots = unwrap(await canonicalizeSessionRoots(context, undefined, loopReader));
  const resolvedPath = unwrap(resolveSessionPath("looped-link", context));

  const targetRes = await resolveFilesystemTarget(
    resolvedPath,
    roots,
    "existing-file",
    undefined,
    loopReader,
  );
  assertEquals(targetRes.ok, false);
  if (!targetRes.ok) {
    assertEquals(targetRes.reason, "symlink_loop");
  }

  // Mock reader where target disappears between observations (path_changed)
  let callCount = 0;
  const disappearingReader: MetadataReader = {
    lstat: (path: string) => {
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve({
          isFile: false,
          isDirectory: true,
          isSymlink: false,
        } as Deno.FileInfo);
      }
      return Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      } as Deno.FileInfo);
    },
    realPath: (path: string) => {
      callCount++;
      if (path === "/workspace" || path === "/workspace/tmp" || path === "/workspace/tmp/skill-1") {
        return Promise.resolve(path);
      }
      // On second check, simulate target deleted/changed
      const err = new Error("No such file or directory");
      err.name = "NotFound";
      return Promise.reject(err);
    },
  };

  const roots2 = unwrap(await canonicalizeSessionRoots(context, undefined, disappearingReader));
  const resolvedTarget = unwrap(resolveSessionPath("file.txt", context));
  const changedRes = await resolveFilesystemTarget(
    resolvedTarget,
    roots2,
    "existing-file",
    undefined,
    disappearingReader,
  );
  assertEquals(changedRes.ok, false);
  if (!changedRes.ok) {
    assertEquals(changedRes.reason, "path_changed");
  }
});

Deno.test("Task 3.3: Critical skills contract validation, disjointness and rejection", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "crit_skills_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    const skillsRoot = join(tempDir, "skills-root");
    await Deno.mkdir(workspace);
    await Deno.mkdir(skillsRoot);

    const canonicalWs = await Deno.realPath(workspace);
    const canonicalSkills = await Deno.realPath(skillsRoot);

    const context: SessionContext = {
      acpSessionId: "session-1",
      skillSessionId: "skill-1",
      sessionCwd: workspace,
      explicitStagingPath: join(workspace, "tmp", "skill-1"),
      sessionContextGeneration: "gen-1",
    };

    // 1. Root overlap check: if skills root is inside workspace, fail root construction
    const overlappingSkillsConfig: TrustedSkillsRootConfig = {
      ownedRootPath: workspace,
      source: "deployment_owned",
    };
    const overlapRes = await canonicalizeSessionRoots(context, overlappingSkillsConfig);
    assertEquals(overlapRes.ok, false);
    if (!overlapRes.ok) {
      assertEquals(overlapRes.reason, "root_overlap");
    }

    // 2. Disjoint trusted skills root succeeds
    const trustedConfig: TrustedSkillsRootConfig = {
      ownedRootPath: skillsRoot,
      source: "deployment_owned",
    };
    const roots = unwrap(await canonicalizeSessionRoots(context, trustedConfig));
    const skillsRootInfo = roots.roots.find((r) => r.role === "trusted-skills")!;
    assertEquals(skillsRootInfo.readOnly, true);

    // Create instruction file
    const skillInstructionPath = join(skillsRoot, "memory", "SKILL.md");
    await Deno.mkdir(join(skillsRoot, "memory"));
    await Deno.writeTextFile(skillInstructionPath, "# Memory Skill");
    const canonicalInstruction = await Deno.realPath(skillInstructionPath);

    // Also create a same-name file in workspace to attempt workspace spoofing
    const fakeSkillPath = join(workspace, "SKILL.md");
    await Deno.writeTextFile(fakeSkillPath, "# Fake Skill");

    // Valid critical reference
    const validRef: CriticalSkillReference = {
      skillId: "memory",
      canonicalInstructionPath: canonicalInstruction,
      sessionGenerationId: "gen-1",
      source: "deployment_owned",
    };

    const resolvedInstruction = unwrap(
      resolveSessionPath(skillInstructionPath, context),
    );
    const targetSuccess = unwrap(
      await resolveFilesystemTarget(
        resolvedInstruction,
        roots,
        "existing-file",
        validRef,
      ),
    );
    assertEquals(targetSuccess.roles, ["trusted-skills"]);
    assertEquals(targetSuccess.canonicalTarget, canonicalInstruction);

    // Mismatched generation
    const staleRef: CriticalSkillReference = {
      ...validRef,
      sessionGenerationId: "stale-gen",
    };
    const staleRes = await resolveFilesystemTarget(
      resolvedInstruction,
      roots,
      "existing-file",
      staleRef,
    );
    assertEquals(staleRes.ok, false);
    if (!staleRes.ok) {
      assertEquals(staleRes.reason, "trusted_identity_mismatch");
    }

    // Workspace spoofing attempt: same-name file in workspace fails critical skill validation
    const resolvedFake = unwrap(resolveSessionPath(fakeSkillPath, context));
    const fakeRef: CriticalSkillReference = {
      ...validRef,
      source: "workspace_project",
    };
    const fakeRes = await resolveFilesystemTarget(
      resolvedFake,
      roots,
      "existing-file",
      fakeRef,
    );
    assertEquals(fakeRes.ok, false);
    if (!fakeRes.ok) {
      assertEquals(fakeRes.reason, "trusted_identity_mismatch");
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// -----------------------------------------------------------------------------
// Task 3.4: Agent-neutral OpenCode/OMP helper contexts and YOLO expectations
// -----------------------------------------------------------------------------

Deno.test("Task 3.4: Agent-neutral OpenCode/OMP contexts and broad workspace membership", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "agent_neutral_test_" });
  try {
    const workspace = join(tempDir, "workspace");
    const sharedWorkspace = join(tempDir, "shared-workspace");
    await Deno.mkdir(workspace);
    await Deno.mkdir(sharedWorkspace);

    // In-workspace state files (e.g. .opencode / session data)
    const stateDir = join(workspace, ".opencode");
    await Deno.mkdir(stateDir);
    const stateFile = join(stateDir, "session.json");
    await Deno.writeTextFile(stateFile, "{}");

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
    assertEquals(stateTarget.canonicalTarget, await Deno.realPath(stateFile));

    // Shared workspace file retains shared membership
    const sharedFile = join(sharedWorkspace, "shared-context.md");
    await Deno.writeTextFile(sharedFile, "# Shared");
    const sharedPath = unwrap(
      resolveSessionPath("$AGENT_WORKSPACE/shared-context.md", context),
    );
    const sharedTarget = unwrap(
      await resolveFilesystemTarget(sharedPath, roots, "existing-file"),
    );
    assertEquals(sharedTarget.roles, ["shared"]);
    assertEquals(sharedTarget.canonicalTarget, await Deno.realPath(sharedFile));

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
    await Deno.remove(tempDir, { recursive: true });
  }
});
