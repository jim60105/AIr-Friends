/**
 * `resolveTrustedSkillsRoot` (`repair-omp-owned-skill-handoff` D1): the one
 * trusted skill-script root convention, exercised through its injectable
 * seams — image-first OMP resolution with the validated dev-tree fallback,
 * the OpenCode installed-root resolution anchored daemon-side, the
 * never-child-HOME invariant, and explicit ConfigError on every miss.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  DEV_SOURCE_SKILLS_ROOT,
  observeTrustedSkillsRoot,
  resolveTrustedSkillsRoot,
} from "@core/skills-root.ts";
import { OMP_IMAGE_SKILLS_ROOT } from "@utils/omp-paths.ts";
import { ConfigError, ErrorCode } from "../../src/types/errors.ts";

function probe(existing: string[]) {
  const set = new Set(existing);
  return (path: string) => set.has(path);
}

Deno.test("omp resolves the installed owned root first", () => {
  // Both roots present: the IMAGE root wins — a dev tree never shadows it.
  assertEquals(
    resolveTrustedSkillsRoot("omp", undefined, {
      directoryExists: probe([OMP_IMAGE_SKILLS_ROOT, DEV_SOURCE_SKILLS_ROOT]),
    }),
    OMP_IMAGE_SKILLS_ROOT,
  );
});

Deno.test("omp falls back to the validated development source root", () => {
  assertEquals(
    resolveTrustedSkillsRoot("omp", undefined, {
      directoryExists: probe([DEV_SOURCE_SKILLS_ROOT]),
    }),
    DEV_SOURCE_SKILLS_ROOT,
  );
});

Deno.test("omp with neither root fails explicitly naming both and excluding HOME", () => {
  const error = assertThrows(
    () => resolveTrustedSkillsRoot("omp", undefined, { directoryExists: probe([]) }),
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes(OMP_IMAGE_SKILLS_ROOT), true);
  assertEquals(error.message.includes(DEV_SOURCE_SKILLS_ROOT), true);
  assertEquals(error.message.includes("never a fallback"), true);
});

Deno.test("unknown agent types are rejected before any root probe", () => {
  const error = assertThrows(
    () => resolveTrustedSkillsRoot("claude", undefined, { directoryExists: () => true }),
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes("Unknown agent type"), true);
});

Deno.test("opencode honors an absolute configured installed root", () => {
  assertEquals(
    resolveTrustedSkillsRoot("opencode", "/home/deno/.agents/skills", {
      directoryExists: probe(["/home/deno/.agents/skills"]),
    }),
    "/home/deno/.agents/skills",
  );
});

Deno.test("opencode resolves relative roots against the deployment cwd, never child HOME", () => {
  // deploymentCwd is the DAEMON-side working directory seam; the resolver has
  // no HOME parameter at all — no code path here can consult one.
  assertEquals(
    resolveTrustedSkillsRoot("opencode", "skills", {
      directoryExists: probe(["/daemon/cwd/skills"]),
      deploymentCwd: "/daemon/cwd",
    }),
    "/daemon/cwd/skills",
  );
});

Deno.test("opencode empty configured root falls back to the default name", () => {
  assertEquals(
    resolveTrustedSkillsRoot("opencode", "", {
      directoryExists: probe(["/daemon/cwd/skills"]),
      deploymentCwd: "/daemon/cwd",
    }),
    "/daemon/cwd/skills",
  );
});

Deno.test("opencode with a missing configured root fails explicitly", () => {
  const error = assertThrows(
    () =>
      resolveTrustedSkillsRoot("opencode", "/elsewhere/skills", {
        directoryExists: probe([]),
        deploymentCwd: "/daemon/cwd",
      }),
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes("/elsewhere/skills"), true);
  assertEquals(error.message.includes("child HOME is never used"), true);
});

// --- Canonical PHYSICAL observation (`unify-omp-skill-root-resolution` D1/1.1) ---

Deno.test("observation carries the canonical realpath and a recheckable identity", () => {
  // A real temp root behind a symlink: the returned spelling is the CANONICAL
  // realpath (what the inventory anchors to), not the link path.
  const target = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-root-" }));
  const base = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-base-" }));
  Deno.symlinkSync(target, `${base}/link`);
  try {
    const observation = observeTrustedSkillsRoot("opencode", `${base}/link`);
    assertEquals(observation.root, target);
    const stat = Deno.statSync(target);
    assertEquals(observation.identity?.dev, stat.dev);
    assertEquals(observation.identity?.ino, stat.ino);
  } finally {
    Deno.removeSync(base, { recursive: true });
    Deno.removeSync(target, { recursive: true });
  }
});

Deno.test("observation omits identity when the host cannot record dev/ino", () => {
  const observation = observeTrustedSkillsRoot("opencode", "/virt/root", {
    directoryExists: () => true,
    observeDirectory: (path) => ({ root: path, identity: undefined }),
  });
  assertEquals(observation.root, "/virt/root");
  assertEquals(observation.identity, undefined);
});

Deno.test("observation is canonical for the OMP dev-source selection too", () => {
  const observation = observeTrustedSkillsRoot("omp", undefined, {
    directoryExists: (p) => p === DEV_SOURCE_SKILLS_ROOT,
    observeDirectory: (path) => ({ root: `/canonical${path}`, identity: { dev: 1, ino: 2 } }),
  });
  assertEquals(observation.root, `/canonical${DEV_SOURCE_SKILLS_ROOT}`);
  assertEquals(observation.identity, { dev: 1, ino: 2 });
});

Deno.test("observation is HOME-independent for OpenCode (relative anchors at deployment cwd)", () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/some/other/home");
  try {
    const observation = observeTrustedSkillsRoot("opencode", "skills", {
      directoryExists: probe(["/daemon/cwd/skills"]),
      observeDirectory: (path) => ({ root: path, identity: { dev: 1, ino: 1 } }),
      deploymentCwd: "/daemon/cwd",
    });
    assertEquals(observation.root, "/daemon/cwd/skills");
  } finally {
    if (originalHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", originalHome);
  }
});

Deno.test("observation fails explicitly when canonical observation returns null", () => {
  const error = assertThrows(
    () =>
      observeTrustedSkillsRoot("opencode", "/root/passes-probe", {
        directoryExists: () => true,
        observeDirectory: () => null,
      }),
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes("failed canonical observation"), true);
});
