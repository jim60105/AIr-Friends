/**
 * `resolveTrustedSkillsRoot` (`repair-omp-owned-skill-handoff` D1): the one
 * trusted skill-script root convention, exercised through its injectable
 * seams — image-first OMP resolution with the validated dev-tree fallback,
 * the OpenCode installed-root resolution anchored daemon-side, the
 * never-child-HOME invariant, and explicit ConfigError on every miss.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { DEV_SOURCE_SKILLS_ROOT, resolveTrustedSkillsRoot } from "@core/skills-root.ts";
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
