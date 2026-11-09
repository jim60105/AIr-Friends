import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";
import {
  authorizeDestructiveTargets,
  decodeDestructiveIntent,
  DESTRUCTIVE_CONFORMANCE_FIXTURES,
  DESTRUCTIVE_CONFORMANCE_TABLE,
  destructiveDenialReason,
  type DestructiveIntentInput,
  isDestructiveRequest,
  normalizeDestructiveIntent,
} from "@acp/destructive-policy.ts";
import { authorizeFilesystemWrite } from "@acp/filesystem-policy.ts";
import {
  canonicalizeSessionRoots,
  resolveFilesystemTarget,
  resolveSessionPath,
  type SessionContext,
} from "@acp/filesystem-roots.ts";
import fs from "node:fs";
import { test } from "bun:test";
import { isNotFoundError, makeTempDirSync } from "../../src/utils/fs-compat.ts";

test("Destructive normalization: shared fixtures have complete ordered targets or bounded failure", () => {
  for (const fixture of DESTRUCTIVE_CONFORMANCE_FIXTURES) {
    const decoded = decodeDestructiveIntent(fixture.input);
    const result = normalizeDestructiveIntent(
      fixture.input,
      decoded.targets.map((target) => target.path),
      fixture.locations,
    );
    assertEquals(result.ok ? "complete" : result.reason, fixture.completeness, fixture.id);
    assertEquals(result.targets.map((target) => target.path), fixture.targets, fixture.id);
  }
  assertEquals(normalizeDestructiveIntent(undefined, [], []), {
    ok: false,
    reason: "title_only_intent",
    targets: [],
  });
  const fixture = DESTRUCTIVE_CONFORMANCE_FIXTURES[2];
  assertEquals(normalizeDestructiveIntent(fixture.input, ["a.md", "b.md"], ["a.md"]), {
    ok: false,
    reason: "incomplete_operation",
    targets: [],
  });
  assertEquals(normalizeDestructiveIntent(fixture.input, [], []), {
    ok: false,
    reason: "incomplete_operation",
    targets: [],
  });
});

test("Destructive normalization: untrusted native shapes never become synthetic decoder input", () => {
  for (const raw of [null, [], "text", { operations: [{ kind: "unknown" }] }]) {
    const input: DestructiveIntentInput = {
      nativeTool: "delete",
      rawInput: JSON.stringify(raw),
      executionInputBinding: JSON.stringify(raw),
      parserProvenance: "supported_full_parser",
    };
    assertEquals(decodeDestructiveIntent(input).ok, false);
  }
  for (
    const operations of [
      [{ kind: "delete", path: "" }],
      [{ kind: "move", source: "a" }],
      [{ kind: "patch_mutation", targetPath: "" }],
      [null],
      [{ kind: "unknown" }],
    ]
  ) {
    const rawInput = JSON.stringify({ operations });
    const input = {
      nativeTool: "edit",
      rawInput,
      executionInputBinding: rawInput,
      parserProvenance: "synthetic_adapter_decoder",
      operations,
    } as DestructiveIntentInput;
    assertEquals(decodeDestructiveIntent(input).ok, false);
  }
  const source = DESTRUCTIVE_CONFORMANCE_FIXTURES[2].input;
  assertEquals(decodeDestructiveIntent({ ...source, operations: [] }).ok, false);
  assertEquals(
    decodeDestructiveIntent({ ...source, rawInput: "{}", executionInputBinding: "{}" }).ok,
    false,
  );
  const patch = { ...source, parserProvenance: "supported_full_parser" as const };
  assertEquals(decodeDestructiveIntent(patch), {
    ok: false,
    reason: "unsupported_syntax",
    targets: [],
  });
  assertEquals(isDestructiveRequest("a.md", "edit", { edits: [] }), true);
  assertEquals(isDestructiveRequest("a.md", "edit", { content: "*** Begin Patch" }), true);
  assertEquals(isDestructiveRequest("delete", "other", undefined), true);
  assertEquals(isDestructiveRequest("patch", "edit", {}), true);
  assertEquals(isDestructiveRequest("a.md", "edit", { path: "a.md", content: "ordinary" }), false);
  assertEquals(isDestructiveRequest("cat", "execute", null), false);
});

test("Destructive targets: real observations reuse ordinary write decisions in both modes", async () => {
  const base = makeTempDirSync();
  const workspace = join(base, "workspace");
  const staging = join(workspace, "tmp", "skill");
  const shared = join(base, "shared");
  const skills = join(base, "skills");
  const sibling = join(base, "workspace-sibling");
  for (const path of [staging, shared, skills, sibling]) fs.mkdirSync(path, { recursive: true });
  const context: SessionContext = {
    acpSessionId: "acp",
    skillSessionId: "skill",
    sessionCwd: staging,
    explicitStagingPath: staging,
    sharedWorkspacePath: shared,
    sessionContextGeneration: "gen",
  };
  // Real session cwd must contain its staging root; fixture spellings are anchored separately.
  const rootContext = { ...context, sessionCwd: workspace };
  try {
    for (
      const path of [
        join(staging, "a.md"),
        join(staging, "b.md"),
        join(workspace, "ordinary.md"),
        join(shared, "note.md"),
        join(shared, "code.ts"),
        join(skills, "SKILL.md"),
        join(sibling, "outside.md"),
      ]
    ) fs.writeFileSync(path, "sentinel");
    fs.symlinkSync(sibling, join(staging, "escape"));
    // Row 28 review follow-up: root construction requires an attested
    // rootIdentity unconditionally, and the trusted root must carry the
    // image's agent-unwritable posture — seal the stand-in owned tree and
    // pass its real identity, the way the producer always does.
    fs.chmodSync(skills, 0o555);
    let roots = await canonicalizeSessionRoots(rootContext, {
      ownedRootPath: skills,
      source: "deployment_owned",
      rootIdentity: { dev: 0, ino: 0 },
    });
    assertEquals(roots.ok, false); // attested identity must match the tree
    const skillsInfo = fs.statSync(skills);
    if (skillsInfo.dev === null || skillsInfo.ino === null) {
      throw new Error("fixture identity unavailable");
    }
    roots = await canonicalizeSessionRoots(rootContext, {
      ownedRootPath: skills,
      source: "deployment_owned",
      rootIdentity: { dev: skillsInfo.dev, ino: skillsInfo.ino },
    });
    assert(roots.ok);
    for (const yolo of [false, true]) {
      for (const canWriteAgentWorkspace of [false, true]) {
        for (
          const path of [
            join(staging, "a.md"),
            join(workspace, "ordinary.md"),
            join(shared, "note.md"),
            join(shared, "code.ts"),
            join(skills, "SKILL.md"),
            join(sibling, "outside.md"),
            join(staging, "escape", "outside.md"),
          ]
        ) {
          const resolved = resolveSessionPath(path, rootContext);
          assert(resolved.ok);
          const observed = await resolveFilesystemTarget(
            resolved.value,
            roots.value,
            "existing-any",
          );
          const normalized = {
            ok: true as const,
            operations: [{ kind: "delete" as const, path }],
            targets: [{ path, intent: "delete" as const }],
          };
          const params = { roots: roots.value, yolo, canWriteAgentWorkspace };
          const result = authorizeDestructiveTargets(normalized, [observed], params);
          if (observed.ok) {
            assertEquals(
              result.decisions[0],
              authorizeFilesystemWrite({ ...params, target: observed.value }),
            );
          } else assertEquals(result.ok, false);
          assertEquals(fs.readFileSync(path, "utf8"), "sentinel");
        }
      }
    }
    for (const fixture of DESTRUCTIVE_CONFORMANCE_FIXTURES) {
      // Trusted adapter fixtures use the same policy as the client; wire parity is
      // exercised through requestPermission in filesystem-authorization.test.ts.
      const evaluate = async () => {
        const decoded = decodeDestructiveIntent(fixture.input);
        const expand = (path: string) => {
          const resolved = resolveSessionPath(join(staging, path), rootContext);
          assert(resolved.ok);
          return resolved.value;
        };
        const resolved = decoded.targets.map((target) => expand(target.path));
        const normalized = normalizeDestructiveIntent(
          fixture.input,
          resolved.map((target) => target.normalizedPath),
          fixture.locations.map((path) => expand(path).normalizedPath),
        );
        if (!normalized.ok) {
          return {
            completeness: normalized.reason,
            targets: [],
            outcomeReason: destructiveDenialReason(normalized.reason),
          };
        }
        const observations = await Promise.all(
          resolved.map((target, index) =>
            resolveFilesystemTarget(
              target,
              roots.value,
              normalized.targets[index].intent === "delete" ? "existing-any" : "file-or-new",
            )
          ),
        );
        const result = authorizeDestructiveTargets(normalized, observations, {
          roots: roots.value,
          yolo: false,
        });
        const denial = result.decisions.find((decision) => !decision.ok);
        return {
          completeness: "complete",
          targets: normalized.targets.map((target) => target.path),
          outcomeReason: denial && !denial.ok ? denial.reason : "approved",
        };
      };
      const clientSurface = await evaluate();
      const expected = DESTRUCTIVE_CONFORMANCE_TABLE.find((row) => row.id === fixture.id)!;
      assertEquals(clientSurface.completeness, expected.completeness);
      assertEquals(clientSurface.outcomeReason, expected.outcomeReason);
      assertEquals(clientSurface.targets.length, expected.targets.length);
      assertEquals(fs.readFileSync(join(staging, "a.md"), "utf8"), "sentinel");
      assertEquals(fs.readFileSync(join(staging, "b.md"), "utf8"), "sentinel");
    }
    for (const intent of ["delete", "write"] as const) {
      const path = join(staging, "missing", "source.md");
      const resolved = resolveSessionPath(path, rootContext);
      assert(resolved.ok);
      const observed = await resolveFilesystemTarget(resolved.value, roots.value, "file-or-new");
      const normalized = { ok: true as const, operations: [], targets: [{ path, intent }] };
      const result = authorizeDestructiveTargets(normalized, [observed], {
        roots: roots.value,
        yolo: false,
      });
      assertEquals(result.ok, intent === "write");
      assertEquals(
        authorizeDestructiveTargets(normalized, [], { roots: roots.value, yolo: false }).ok,
        false,
      );
      assertEquals(fs.statSync(staging).isDirectory(), true);
      try {
        fs.statSync(join(staging, "missing"));
        throw new Error("unexpected parent creation");
      } catch (error) {
        assert(isNotFoundError(error));
      }
    }
  } finally {
    fs.chmodSync(skills, 0o755);
    fs.rmSync(base, { recursive: true });
  }
});

test("Destructive normalization: canonical OMP single-operation payloads decode completely", () => {
  // The exact canonical strings the OMP ingress adapter serializes for a native
  // delete/move must decode to complete ordered targets, and a location set that
  // disagrees with the decoded targets must keep the shared binding denial.
  const deleteInput: DestructiveIntentInput = {
    nativeTool: "delete",
    rawInput: '{"path":"a.md"}',
    executionInputBinding: '{"path":"a.md"}',
    parserProvenance: "supported_full_parser",
  };
  assertEquals(decodeDestructiveIntent(deleteInput), {
    ok: true,
    operations: [{ kind: "delete", path: "a.md" }],
    targets: [{ path: "a.md", intent: "delete" }],
  });

  const moveInput: DestructiveIntentInput = {
    nativeTool: "move",
    rawInput: '{"source":"a.md","destination":"b.md"}',
    executionInputBinding: '{"source":"a.md","destination":"b.md"}',
    parserProvenance: "supported_full_parser",
  };
  assertEquals(normalizeDestructiveIntent(moveInput, ["a.md", "b.md"], ["a.md", "b.md"]).ok, true);
  assertEquals(normalizeDestructiveIntent(moveInput, ["a.md", "b.md"], ["a.md", "b.md", "c.md"]), {
    ok: false,
    reason: "binding_mismatch",
    targets: [],
  });
});
