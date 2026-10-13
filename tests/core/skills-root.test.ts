/**
 * `resolveTrustedSkillsRoot` (`repair-omp-owned-skill-handoff` D1): the one
 * trusted skill-script root convention, exercised through its injectable
 * seams — image-first OMP resolution with the validated dev-tree fallback,
 * the OpenCode installed-root resolution anchored daemon-side, the
 * never-child-HOME invariant, and explicit ConfigError on every miss.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  assertSkillsRootDelivered,
  DEV_SOURCE_SKILLS_ROOT,
  observeTrustedSkillsRoot,
  quoteShellArgument,
  requireTrustedSkillsRoot,
  resolveTrustedSkillsRoot,
  skillScriptPath,
} from "@core/skills-root.ts";
import { containsUnquotedShellExpansion, tokenizeShellCommand } from "@acp/command-syntax.ts";
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

Deno.test("a canonical observation that lands on the filesystem root is refused (B3)", () => {
  // A configured root that realpaths to "/" can never be a read-only skill
  // tree — it contains every agent-writable mount by construction. The
  // resolver refuses it centrally so readiness, inventory and the mount all
  // share one posture instead of only confinement failing at spawn.
  const error = assertThrows(
    () =>
      observeTrustedSkillsRoot("opencode", "/some/prefix", {
        directoryExists: () => true,
        observeDirectory: () => ({ root: "/" }),
      }),
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes('cannot be the filesystem root "/"'), true);
});

// --- Delivery-boundary helpers (`render-delivered-skill-root-contract`) ---
//
// The classified render/delivery contract beside the resolver: required-root
// validation, the POSIX recipe-argument formatter the templates and the retry
// builder share, and the literal-presence assertion that refuses to deliver a
// classified prompt rendering without the root.

Deno.test("requireTrustedSkillsRoot accepts an absolute root and rejects absent, empty and relative ones", () => {
  assertEquals(requireTrustedSkillsRoot("/opt/air/skills", "unit"), "/opt/air/skills");
  for (
    const [label, value] of [
      ["absent", undefined],
      ["null", null],
      ["empty", ""],
      ["relative", "skills"],
      ["parent-relative", "../skills"],
      ["child-HOME expression", "$HOME/.agents/skills"],
    ] as const
  ) {
    const error = assertThrows(
      () => requireTrustedSkillsRoot(value, "unit boundary"),
      ConfigError,
      undefined,
      `${label}: root must be refused`,
    ) as ConfigError;
    assertEquals(error.code, ErrorCode.CONFIG_INVALID);
    assertEquals(error.message.includes("unit boundary"), true);
  }
});

Deno.test("quoteShellArgument makes a hostile argument one literal token with no expansion", () => {
  assertEquals(quoteShellArgument("/opt/air/skills"), "'/opt/air/skills'");
  // An embedded apostrophe is the POSIX quote-close / escaped-quote / reopen
  // triple — the only form `sh` accepts inside single quotes.
  assertEquals(quoteShellArgument("/opt/ro'ot"), "'/opt/ro'\\''ot'");
  // Everything else is already literal inside the quotes.
  assertEquals(quoteShellArgument('/opt/my skills/a$b`c"d'), "'/opt/my skills/a$b`c\"d'");

  // The two properties that matter, checked with the repository's own
  // quote-aware tokenizer rather than by eyeballing the spelling: the value
  // never splits on its spaces, and it introduces no expandable operator.
  const hostile = "/opt/my skills/ro'ot/a$b`c\"d";
  const quoted = quoteShellArgument(hostile);
  assertEquals(tokenizeShellCommand(quoted).length, 1);
  assertEquals(containsUnquotedShellExpansion(quoted), false);
});

Deno.test("skillScriptPath quotes the COMPLETE root-plus-script path, not just the root", () => {
  assertEquals(
    skillScriptPath("/opt/air/skills", "send-reply"),
    "'/opt/air/skills/send-reply/scripts/send-reply.ts'",
  );
  assertEquals(
    skillScriptPath("/opt/my skills", "memory-save"),
    "'/opt/my skills/memory-save/scripts/memory-save.ts'",
  );
  assertEquals(
    skillScriptPath("/opt/ro'ot", "send-file"),
    "'/opt/ro'\\''ot/send-file/scripts/send-file.ts'",
  );
});

Deno.test("assertSkillsRootDelivered refuses a classified prompt without the literal root", () => {
  assertSkillsRootDelivered("trusted root: /opt/air/skills", "/opt/air/skills", "unit");
  const error = assertThrows(
    () =>
      assertSkillsRootDelivered("a rootless mounted prompt", "/opt/air/skills", "unit delivery"),
    ConfigError,
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes("/opt/air/skills"), true);
  assertEquals(error.message.includes("unit delivery"), true);
});
