/**
 * Owned skill-URI authorization resolver (`repair-omp-owned-skill-handoff`
 * task 2.1): deterministic filesystem fixtures prove the resolver admits ONLY
 * a current, link-free, non-aliased regular file inside the declared owned
 * source, and denies foreign same-name shadows, symlink/identity replacement,
 * traversal, missing (stale) generation, and off-image absence — every denial
 * before any delegation, with no fallback root.
 */

import { assertEquals } from "@std/assert";
import {
  createOwnedSkillUriAuthorization,
  type SkillUriSourceReader,
} from "@acp/omp/extension/read-replacement.ts";

/** In-memory filesystem fixture: paths → kind + identity knobs. */
interface FakeNode {
  kind: "dir" | "file" | "symlink";
  target?: string;
  mode?: number;
  uid?: number;
  nlink?: number;
}

function fixtureReader(nodes: Record<string, FakeNode>): SkillUriSourceReader {
  return {
    lstat: (path) => {
      const node = nodes[path];
      if (!node) throw new Deno.errors.NotFound(`missing ${path}`);
      return {
        isDirectory: node.kind === "dir",
        isFile: node.kind === "file",
        isSymlink: node.kind === "symlink",
        mode: node.mode ?? 0o644,
        uid: node.uid ?? 0,
        nlink: node.nlink ?? 1,
      };
    },
    realPath: (path) => {
      if (!(path in nodes)) throw new Deno.errors.NotFound(`missing ${path}`);
      // realpath resolves symlinks; identity checks elsewhere catch links.
      let node = nodes[path];
      const seen = new Set<string>();
      while (node?.kind === "symlink" && node.target !== undefined) {
        if (seen.has(path)) throw new Deno.errors.NotFound("loop");
        seen.add(path);
        path = node.target;
        node = nodes[path];
      }
      if (!node) throw new Deno.errors.NotFound(`dangling ${path}`);
      return path;
    },
  };
}

const ROOT = "/opt/air/skills";
const GENERATION = "gen-current";

function resolver(nodes: Record<string, FakeNode>, generation: string) {
  return createOwnedSkillUriAuthorization({
    ownedRoot: ROOT,
    resourceGeneration: () => generation,
    reader: fixtureReader(nodes),
  });
}

const HEALTHY: Record<string, FakeNode> = {
  "/": { kind: "dir" },
  "/opt": { kind: "dir" },
  "/opt/air": { kind: "dir" },
  [ROOT]: { kind: "dir", mode: 0o755 },
  [`${ROOT}/send-reply`]: { kind: "dir", mode: 0o755 },
  [`${ROOT}/send-reply/SKILL.md`]: { kind: "file", mode: 0o644 },
};

Deno.test("declared owned skill file authorizes to its canonical path", () => {
  const resolution = resolver(HEALTHY, GENERATION).authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, true);
  if (resolution.ok) assertEquals(resolution.canonicalPath, `${ROOT}/send-reply/SKILL.md`);
});

Deno.test("missing generation mints no skill authority", () => {
  const resolution = resolver(HEALTHY, "").authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, false);
  if (!resolution.ok) assertEquals(resolution.reason.includes("resource generation"), true);
});

Deno.test("off-image host (declared source absent) denies with no fallback root", () => {
  const nodes: Record<string, FakeNode> = { "/": { kind: "dir" }, "/opt": { kind: "dir" } };
  const resolution = resolver(nodes, GENERATION).authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, false);
  if (!resolution.ok) {
    assertEquals(resolution.reason.includes("not observable"), true);
    assertEquals(resolution.reason.includes("no fallback root"), true);
  }
});

Deno.test("traversal spellings never resolve", () => {
  const r = resolver(HEALTHY, GENERATION);
  for (
    const uri of [
      "skill://../etc/passwd",
      "skill://send-reply/../../etc/passwd",
      "skill://./send-reply/SKILL.md",
      "skill:///%2e%2e/etc/passwd",
      "skill://send-reply/SKILL.md?x=1",
      "skill://send-reply#frag",
    ]
  ) {
    const resolution = r.authorize(uri);
    assertEquals(resolution.ok, false, uri);
  }
});

Deno.test("symlinked declared source is a replaced identity — denied", () => {
  const nodes: Record<string, FakeNode> = {
    ...HEALTHY,
    "/opt/air/skills": { kind: "symlink", target: "/elsewhere" },
    "/elsewhere": { kind: "dir", mode: 0o755 },
    "/elsewhere/send-reply": { kind: "dir", mode: 0o755 },
    "/elsewhere/send-reply/SKILL.md": { kind: "file", mode: 0o644 },
  };
  const resolution = resolver(nodes, GENERATION).authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, false);
});

Deno.test("foreign same-name shadow is unreachable: only the declared root is consulted", () => {
  // A complete look-alike tree under a DIFFERENT root can never be named by
  // the shape or the resolver: the URI carries no root and the resolver has
  // no candidate list.
  const nodes: Record<string, FakeNode> = {
    "/": { kind: "dir" },
    "/opt": { kind: "dir" },
    "/opt/air": { kind: "dir" },
    [ROOT]: { kind: "dir", mode: 0o755 }, // declared root exists; the skill is NOT in it
    "/foreign/skills": { kind: "dir", mode: 0o755 },
    "/foreign/skills/send-reply": { kind: "dir", mode: 0o755 },
    "/foreign/skills/send-reply/SKILL.md": { kind: "file", mode: 0o644 },
  };
  const resolution = resolver(nodes, GENERATION).authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, false);
});

Deno.test("symlinked path component inside the source denies before delegation", () => {
  const nodes: Record<string, FakeNode> = {
    ...HEALTHY,
    [`${ROOT}/send-reply/SKILL.md`]: { kind: "symlink", target: "/foreign/SKILL.md" },
    "/foreign": { kind: "dir" },
    "/foreign/SKILL.md": { kind: "file", mode: 0o644 },
  };
  const resolution = resolver(nodes, GENERATION).authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, false);
});

Deno.test("agent-writable or aliased (hard-linked) instruction identities deny", () => {
  for (const knob of [{ uid: 1000, mode: 0o666 }, { uid: 0, mode: 0o666 }, { nlink: 2 }]) {
    const nodes: Record<string, FakeNode> = {
      ...HEALTHY,
      [`${ROOT}/send-reply/SKILL.md`]: { kind: "file", mode: 0o644, ...knob },
    };
    const resolution = resolver(nodes, GENERATION).authorize("skill://send-reply/SKILL.md");
    assertEquals(resolution.ok, false, JSON.stringify(knob));
  }
});

Deno.test("directory or missing target denies (instruction file only)", () => {
  const asDir = resolver(HEALTHY, GENERATION).authorize("skill://send-reply");
  assertEquals(asDir.ok, false);
  const missing = resolver(HEALTHY, GENERATION).authorize("skill://send-reply/MISSING.md");
  assertEquals(missing.ok, false);
});

Deno.test("root identity drift (realpath mismatch) denies as replaced identity", () => {
  // The declared constant resolves elsewhere: the CURRENT identity is not the
  // contracted canonical source, i.e. a stale/replaced generation.
  const nodes: Record<string, FakeNode> = {
    "/": { kind: "dir" },
    "/opt": { kind: "dir" },
    "/opt/air": { kind: "dir" },
    [ROOT]: { kind: "dir", mode: 0o755 },
    [`${ROOT}/send-reply`]: { kind: "dir", mode: 0o755 },
    [`${ROOT}/send-reply/SKILL.md`]: { kind: "file", mode: 0o644 },
  };
  const drifting = createOwnedSkillUriAuthorization({
    ownedRoot: ROOT,
    resourceGeneration: () => GENERATION,
    reader: {
      lstat: fixtureReader(nodes).lstat,
      realPath: (
        path,
      ) => (path === ROOT ? "/replaced/identity" : fixtureReader(nodes).realPath(path)),
    },
  });
  const resolution = drifting.authorize("skill://send-reply/SKILL.md");
  assertEquals(resolution.ok, false);
  if (!resolution.ok) assertEquals(resolution.reason.includes("identity replaced"), true);
});
