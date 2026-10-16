import { assertEquals } from "@std/assert";
import {
  authorizeFilesystemRead,
  authorizeFilesystemWrite,
  buildSessionFilesystemContext,
  FILESYSTEM_ACCESS_FAILURE_MAP,
  mapAccessFailureToDenial,
  mapRootPathFailureToDenial,
  ROOT_PATH_FAILURE_MAP,
} from "../../src/acp/filesystem-policy.ts";
import type {
  CanonicalSessionRoots,
  CanonicalTarget,
  RootPathFailureReason,
} from "../../src/acp/filesystem-roots.ts";
import type { FilesystemAccessFailureReason } from "../../src/acp/filesystem-access.ts";
import type { SessionGateContext } from "../../src/acp/client.ts";
import type { ClientConfig } from "../../src/acp/types.ts";

const mockRoots: CanonicalSessionRoots = {
  acpSessionId: "acp-1",
  sessionContextGeneration: "gen-1",
  roots: [
    {
      role: "workspace",
      configuredPath: "/ws",
      canonicalPath: "/ws",
      readOnly: false,
    },
    {
      role: "staging",
      configuredPath: "/ws/tmp/skill-1",
      canonicalPath: "/ws/tmp/skill-1",
      readOnly: false,
    },
    {
      role: "shared",
      configuredPath: "/shared",
      canonicalPath: "/shared",
      readOnly: false,
    },
    {
      role: "trusted-skills",
      configuredPath: "/skills",
      canonicalPath: "/skills",
      readOnly: true,
    },
  ],
};

function createMockTarget(
  roles: CanonicalTarget["roles"],
  path: string,
  type: CanonicalTarget["targetType"] = "file",
): CanonicalTarget {
  return {
    acpSessionId: "acp-1",
    sessionContextGeneration: "gen-1",
    roles,
    canonicalTarget: path,
    targetType: type,
    observedSymlinks: [],
    rootRelativePath: "rel",
    rootIdentities: [],
    normalizedInput: path,
  };
}

Deno.test("Filesystem Policy: Failure mapping completeness and correctness", () => {
  // All RootPathFailureReason keys must map correctly
  const rootReasons: RootPathFailureReason[] = [
    "invalid_context",
    "invalid_path",
    "unresolved_token",
    "invalid_root",
    "root_unavailable",
    "root_overlap",
    "outside_roots",
    "symlink_escape",
    "dangling_symlink",
    "symlink_loop",
    "not_found",
    "wrong_target_type",
    "canonicalization_failed",
    "path_changed",
    "trusted_identity_mismatch",
  ];
  for (const r of rootReasons) {
    assertEquals(typeof ROOT_PATH_FAILURE_MAP[r], "string");
  }

  // Check specific write mappings
  assertEquals(
    mapRootPathFailureToDenial("outside_roots", true),
    "rejected_write_path_outside_workspace",
  );
  assertEquals(
    mapRootPathFailureToDenial("symlink_escape", true),
    "rejected_write_path_outside_workspace",
  );
  assertEquals(
    mapRootPathFailureToDenial("outside_roots", false),
    "rejected_filesystem_path_unavailable",
  );
  assertEquals(
    mapRootPathFailureToDenial("root_overlap", false),
    "rejected_trusted_skills_identity",
  );
  assertEquals(
    mapRootPathFailureToDenial("trusted_identity_mismatch", false),
    "rejected_trusted_skills_identity",
  );

  // All FilesystemAccessFailureReason keys must map correctly
  const accessReasons: FilesystemAccessFailureReason[] = [
    "invalid_context",
    "outside_roots",
    "identity_unavailable",
    "path_changed",
    "unsafe_traversal",
    "root_unavailable",
    "parent_missing",
    "wrong_target_type",
    "unsupported_platform",
    "secure_access_unavailable",
    "access_denied",
    "io_failed",
  ];
  for (const r of accessReasons) {
    assertEquals(typeof FILESYSTEM_ACCESS_FAILURE_MAP[r], "string");
  }

  assertEquals(
    mapAccessFailureToDenial("outside_roots", true),
    "rejected_write_path_outside_workspace",
  );
  assertEquals(
    mapAccessFailureToDenial("outside_roots", false),
    "rejected_filesystem_path_unavailable",
  );
  assertEquals(mapAccessFailureToDenial("root_unavailable", false), "rejected_filesystem_access");
  assertEquals(mapAccessFailureToDenial("parent_missing", true), "rejected_filesystem_access");
});

Deno.test("Filesystem Policy: every role combination selects one carried role without widening", () => {
  const roles = [
    "workspace",
    "staging",
    "shared",
    "trusted-skills",
    "omp-session-artifacts",
  ] as const;
  for (let mask = 0; mask < 32; mask++) {
    const carried = roles.filter((_role, index) => mask & (1 << index));
    for (const yolo of [false, true]) {
      const target = createMockTarget(carried, "/observed/file.MD", "prospective");
      const decision = authorizeFilesystemWrite({
        roots: mockRoots,
        target,
        yolo,
        canWriteAgentWorkspace: true,
      });
      if (carried.includes("trusted-skills")) {
        assertEquals(decision.ok, false);
        if (!decision.ok) assertEquals(decision.reason, "rejected_trusted_skills_read_only");
      } else if (carried.includes("omp-session-artifacts")) {
        // Reserved current-session OMP native state is read-only for callback
        // mutations in EVERY mode, before the YOLO write branch.
        assertEquals(decision.ok, false);
        if (!decision.ok) assertEquals(decision.reason, "rejected_omp_native_state");
      } else if (
        carried.includes("staging") || carried.includes("shared") ||
        (yolo && carried.includes("workspace"))
      ) {
        assertEquals(decision.ok, true);
        if (decision.ok) {
          assertEquals(
            decision.role,
            carried.includes("staging")
              ? "staging"
              : carried.includes("shared")
              ? "shared"
              : "workspace",
          );
          assertEquals(decision.access, "create");
          assertEquals(carried.includes(decision.role), true);
        }
      } else {
        assertEquals(decision.ok, false);
        if (!decision.ok) {
          assertEquals(
            decision.reason,
            carried.includes("workspace")
              ? "rejected_workspace_write_restricted"
              : "rejected_write_path_outside_workspace",
          );
        }
      }
    }
  }
  for (const allowedWriteExtensions of [undefined, [], [".txt"]]) {
    const decision = authorizeFilesystemWrite({
      roots: mockRoots,
      target: createMockTarget(["workspace", "shared"], "/shared/file.MD"),
      yolo: false,
      canWriteAgentWorkspace: true,
      allowedWriteExtensions,
    });
    assertEquals(decision.ok, allowedWriteExtensions === undefined);
    if (!decision.ok) assertEquals(decision.reason, "rejected_write_extension");
  }
  const unauthorized = authorizeFilesystemWrite({
    roots: mockRoots,
    target: createMockTarget(["workspace", "shared"], "/shared/file.md"),
    yolo: false,
    canWriteAgentWorkspace: false,
  });
  assertEquals(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assertEquals(unauthorized.reason, "rejected_agent_workspace_write_unauthorized");
  }
  for (const carried of [["staging", "workspace"], ["shared", "workspace"], []] as const) {
    const read = authorizeFilesystemRead({
      roots: mockRoots,
      target: createMockTarget(carried, "/file.TXT"),
    });
    assertEquals(read.ok, carried.length > 0);
    if (read.ok) assertEquals(read.role, carried[0]);
  }
});

Deno.test("Filesystem Policy: buildSessionFilesystemContext", () => {
  const clientConfig: ClientConfig = {
    workingDir: "/ws",
    platform: "discord",
    userId: "u1",
    channelId: "c1",
    isDM: false,
    agentWorkspacePath: "/shared",
  };

  // Missing session id
  const noSid = buildSessionFilesystemContext(undefined, { cwd: "/ws" }, clientConfig, "gen-1");
  assertEquals(noSid.ok, false);
  if (!noSid.ok) assertEquals(noSid.reason, "rejected_filesystem_context");

  // Missing gate context
  const noCtx = buildSessionFilesystemContext("acp-1", undefined, clientConfig, "gen-1");
  assertEquals(noCtx.ok, false);
  if (!noCtx.ok) assertEquals(noCtx.reason, "rejected_filesystem_context");

  // Missing shellSessionId
  const noShell = buildSessionFilesystemContext("acp-1", { cwd: "/ws" }, {
    ...clientConfig,
    sessionId: undefined,
  }, "gen-1");
  assertEquals(noShell.ok, false);

  // Success
  const gateCtx: SessionGateContext = {
    cwd: "/ws",
    shellSessionId: "skill-1",
  };
  const success = buildSessionFilesystemContext("acp-1", gateCtx, clientConfig, "gen-1");
  assertEquals(success.ok, true);
  if (success.ok) {
    assertEquals(success.context.explicitStagingPath, "/ws/tmp/skill-1");
    assertEquals(success.context.sessionContextGeneration, "gen-1");
  }
});

Deno.test("Filesystem Policy: authorizeFilesystemRead", () => {
  // 1. Trusted skills allows any extension
  const skillTarget = createMockTarget(["trusted-skills"], "/skills/send-reply/SKILL.md");
  const readSkill = authorizeFilesystemRead({ roots: mockRoots, target: skillTarget });
  assertEquals(readSkill.ok, true);
  if (readSkill.ok) {
    assertEquals(readSkill.role, "trusted-skills");
    assertEquals(readSkill.useTrustedReadRule, true);
  }

  // 2. Workspace read allowed extensions (.md, .txt, .jsonl)
  const mdTarget = createMockTarget(["workspace"], "/ws/doc.md");
  assertEquals(authorizeFilesystemRead({ roots: mockRoots, target: mdTarget }).ok, true);

  const txtTarget = createMockTarget(["workspace"], "/ws/doc.txt");
  assertEquals(authorizeFilesystemRead({ roots: mockRoots, target: txtTarget }).ok, true);

  const jsonlTarget = createMockTarget(["workspace"], "/ws/memory.jsonl");
  assertEquals(authorizeFilesystemRead({ roots: mockRoots, target: jsonlTarget }).ok, true);

  // Disallowed extension (.json) in workspace
  const jsonTarget = createMockTarget(["workspace"], "/ws/secrets.json");
  const readJson = authorizeFilesystemRead({ roots: mockRoots, target: jsonTarget });
  assertEquals(readJson.ok, false);
  if (!readJson.ok) {
    assertEquals(readJson.reason, "rejected_read_extension");
  }
});

Deno.test("Filesystem Policy: authorizeFilesystemWrite in restricted mode", () => {
  // 1. Staging write -> allowed for any extension
  const stagingTarget = createMockTarget(["staging"], "/ws/tmp/skill-1/data.bin");
  const stagingRes = authorizeFilesystemWrite({
    roots: mockRoots,
    target: stagingTarget,
    yolo: false,
  });
  assertEquals(stagingRes.ok, true);
  if (stagingRes.ok) {
    assertEquals(stagingRes.role, "staging");
  }

  // 2. Ordinary workspace write -> rejected_workspace_write_restricted
  const wsTarget = createMockTarget(["workspace"], "/ws/file.md");
  const wsRes = authorizeFilesystemWrite({
    roots: mockRoots,
    target: wsTarget,
    yolo: false,
  });
  assertEquals(wsRes.ok, false);
  if (!wsRes.ok) {
    assertEquals(wsRes.reason, "rejected_workspace_write_restricted");
  }

  // 3. Shared workspace write unauthorized
  const sharedMd = createMockTarget(["shared"], "/shared/notes.md");
  const unauthShared = authorizeFilesystemWrite({
    roots: mockRoots,
    target: sharedMd,
    yolo: false,
    canWriteAgentWorkspace: false,
  });
  assertEquals(unauthShared.ok, false);
  if (!unauthShared.ok) {
    assertEquals(unauthShared.reason, "rejected_agent_workspace_write_unauthorized");
  }

  // 4. Shared workspace write with disallowed extension
  const sharedJs = createMockTarget(["shared"], "/shared/script.js");
  const wrongExtShared = authorizeFilesystemWrite({
    roots: mockRoots,
    target: sharedJs,
    yolo: false,
    canWriteAgentWorkspace: true,
  });
  assertEquals(wrongExtShared.ok, false);
  if (!wrongExtShared.ok) {
    assertEquals(wrongExtShared.reason, "rejected_write_extension");
  }

  // 5. Shared workspace write authorized + allowed extension
  const authShared = authorizeFilesystemWrite({
    roots: mockRoots,
    target: sharedMd,
    yolo: false,
    canWriteAgentWorkspace: true,
  });
  assertEquals(authShared.ok, true);
  if (authShared.ok) {
    assertEquals(authShared.role, "shared");
  }

  // 6. Trusted skills write -> rejected_trusted_skills_read_only
  const skillsTarget = createMockTarget(["trusted-skills"], "/skills/SKILL.md");
  const skillsRes = authorizeFilesystemWrite({
    roots: mockRoots,
    target: skillsTarget,
    yolo: false,
  });
  assertEquals(skillsRes.ok, false);
  if (!skillsRes.ok) {
    assertEquals(skillsRes.reason, "rejected_trusted_skills_read_only");
  }
});

Deno.test("Filesystem Policy: authorizeFilesystemWrite in YOLO mode", () => {
  // 1. Workspace write with any extension -> allowed
  const wsTarget = createMockTarget(["workspace"], "/ws/script.py");
  const wsRes = authorizeFilesystemWrite({
    roots: mockRoots,
    target: wsTarget,
    yolo: true,
  });
  assertEquals(wsRes.ok, true);
  if (wsRes.ok) {
    assertEquals(wsRes.role, "workspace");
  }

  // 2. Shared write with any extension without canWriteAgentWorkspace -> allowed
  const sharedTarget = createMockTarget(["shared"], "/shared/script.py");
  const sharedRes = authorizeFilesystemWrite({
    roots: mockRoots,
    target: sharedTarget,
    yolo: true,
    canWriteAgentWorkspace: false,
  });
  assertEquals(sharedRes.ok, true);
  if (sharedRes.ok) {
    assertEquals(sharedRes.role, "shared");
  }

  // 3. Trusted skills write in YOLO -> still rejected_trusted_skills_read_only
  const skillsTarget = createMockTarget(["trusted-skills"], "/skills/SKILL.md");
  const skillsRes = authorizeFilesystemWrite({
    roots: mockRoots,
    target: skillsTarget,
    yolo: true,
  });
  assertEquals(skillsRes.ok, false);
  if (!skillsRes.ok) {
    assertEquals(skillsRes.reason, "rejected_trusted_skills_read_only");
  }
});
