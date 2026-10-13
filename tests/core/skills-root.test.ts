/**
 * `resolveTrustedSkillsRoot` (`unify-skill-root-and-inventory` D1): the ONE
 * trusted skill-script root convention shared by BOTH agent types, exercised
 * through its injectable seams — the configured installed-root resolution
 * anchored deployment-side, the never-child-HOME invariant, the absence of any
 * agent-type selection (no image constant, no dev-tree fallback) and explicit
 * ConfigError on every miss.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  assertSkillsRootDelivered,
  observeTrustedSkillsRoot,
  quoteShellArgument,
  requireTrustedSkillsRoot,
  resolveTrustedSkillsRoot,
  skillScriptPath,
} from "@core/skills-root.ts";
import { containsUnquotedShellExpansion, tokenizeShellCommand } from "@acp/command-syntax.ts";
import { ConfigError, ErrorCode } from "../../src/types/errors.ts";

/** The supported agent types; the resolver selects no root per type. */
const AGENT_TYPES = ["opencode", "omp"] as const;

/** A configured absolute installed root fixture (no agent-specific meaning). */
const CONFIGURED_ROOT = "/srv/deployment/skills";

function probe(existing: string[]) {
  const set = new Set(existing);
  return (path: string) => set.has(path);
}

Deno.test("unknown agent types are rejected before any root probe", () => {
  const error = assertThrows(
    () => resolveTrustedSkillsRoot("claude", undefined, { directoryExists: () => true }),
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes("Unknown agent type"), true);
});

Deno.test("both agent types honor the same absolute configured installed root", () => {
  // `configuredSkillsDir` is the ONLY selection input (`unify-skill-root-and-
  // inventory` D1): no image constant, no catalog gate, no per-agent root.
  for (const agentType of AGENT_TYPES) {
    assertEquals(
      resolveTrustedSkillsRoot(agentType, "/home/deno/.agents/skills", {
        directoryExists: probe(["/home/deno/.agents/skills"]),
      }),
      "/home/deno/.agents/skills",
      agentType,
    );
    assertEquals(
      resolveTrustedSkillsRoot(agentType, CONFIGURED_ROOT, {
        directoryExists: probe([CONFIGURED_ROOT]),
      }),
      CONFIGURED_ROOT,
      agentType,
    );
  }
});

Deno.test("both agent types resolve relative roots against the deployment cwd, never child HOME", () => {
  // deploymentCwd is the deployment-side working directory seam; the resolver
  // has no HOME parameter at all — no code path here can consult one.
  for (const agentType of AGENT_TYPES) {
    assertEquals(
      resolveTrustedSkillsRoot(agentType, "skills", {
        directoryExists: probe(["/daemon/cwd/skills"]),
        deploymentCwd: "/daemon/cwd",
      }),
      "/daemon/cwd/skills",
      agentType,
    );
  }
});

Deno.test("both agent types fall back to the documented default name when unset or empty", () => {
  for (const agentType of AGENT_TYPES) {
    for (const configured of [undefined, ""]) {
      assertEquals(
        resolveTrustedSkillsRoot(agentType, configured, {
          directoryExists: probe(["/daemon/cwd/skills"]),
          deploymentCwd: "/daemon/cwd",
        }),
        "/daemon/cwd/skills",
        `${agentType}: ${JSON.stringify(configured)}`,
      );
    }
  }
});

Deno.test("both agent types with a missing configured root fail explicitly naming it", () => {
  for (const agentType of AGENT_TYPES) {
    const error = assertThrows(
      () =>
        resolveTrustedSkillsRoot(agentType, "/elsewhere/skills", {
          directoryExists: probe([]),
          deploymentCwd: "/daemon/cwd",
        }),
    ) as ConfigError;
    assertEquals(error.code, ErrorCode.CONFIG_INVALID);
    assertEquals(error.message.includes("/elsewhere/skills"), true, agentType);
    assertEquals(error.message.includes("child HOME is never used"), true, agentType);
    // The removed image/dev-root selection leaves no alternate tree to name.
    assertEquals(error.message.includes("/opt/air/skills"), false, agentType);
  }
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

Deno.test("observation is canonical for the shared configured root for either agent type", () => {
  for (const agentType of AGENT_TYPES) {
    const observation = observeTrustedSkillsRoot(agentType, CONFIGURED_ROOT, {
      directoryExists: (p) => p === CONFIGURED_ROOT,
      observeDirectory: (path) => ({ root: `/canonical${path}`, identity: { dev: 1, ino: 2 } }),
    });
    assertEquals(observation.root, `/canonical${CONFIGURED_ROOT}`, agentType);
    assertEquals(observation.identity, { dev: 1, ino: 2 }, agentType);
  }
});

Deno.test("observation is HOME-independent (relative anchors at the deployment cwd)", () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/some/other/home");
  try {
    for (const agentType of AGENT_TYPES) {
      const observation = observeTrustedSkillsRoot(agentType, "skills", {
        directoryExists: probe(["/daemon/cwd/skills"]),
        observeDirectory: (path) => ({ root: path, identity: { dev: 1, ino: 1 } }),
        deploymentCwd: "/daemon/cwd",
      });
      assertEquals(observation.root, "/daemon/cwd/skills", agentType);
    }
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
  assertEquals(requireTrustedSkillsRoot(CONFIGURED_ROOT, "unit"), CONFIGURED_ROOT);
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
  assertEquals(quoteShellArgument(CONFIGURED_ROOT), `'${CONFIGURED_ROOT}'`);
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
    skillScriptPath(CONFIGURED_ROOT, "send-reply"),
    `'${CONFIGURED_ROOT}/send-reply/scripts/send-reply.ts'`,
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
  assertSkillsRootDelivered(`trusted root: ${CONFIGURED_ROOT}`, CONFIGURED_ROOT, "unit");
  const error = assertThrows(
    () => assertSkillsRootDelivered("a rootless mounted prompt", CONFIGURED_ROOT, "unit delivery"),
    ConfigError,
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertEquals(error.message.includes(CONFIGURED_ROOT), true);
  assertEquals(error.message.includes("unit delivery"), true);
});
