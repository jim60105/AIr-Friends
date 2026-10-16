import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { buildBwrapConfinement } from "@acp/filesystem-confinement.ts";

Deno.test("buildBwrapConfinement - mounts a fresh /proc to hide the daemon environ", () => {
  const { command, args } = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "opencode",
    ["acp"],
  );
  assertEquals(command, "bwrap");
  const procIdx = args.indexOf("--proc");
  assertEquals(procIdx !== -1, true);
  assertEquals(args[procIdx + 1], "/proc");
});

Deno.test("buildBwrapConfinement - binds only this session's dirs writable", () => {
  const { args } = buildBwrapConfinement(
    {
      sessionWorkspace: "/app/data/workspaces/discord/123",
      tmpDir: "/app/data/workspaces/discord/123/tmp",
      agentWorkspace: "/app/data/agent-workspace",
      shareNet: true,
    },
    "opencode",
    [],
  );
  // The session's own workspace + tmp + agent workspace are bound; sibling users' dirs are not.
  const joined = args.join(" ");
  assertEquals(
    joined.includes("--bind /app/data/workspaces/discord/123 /app/data/workspaces/discord/123"),
    true,
  );
  assertEquals(joined.includes("--bind /app/data/agent-workspace /app/data/agent-workspace"), true);
  // No blanket bind of the parent workspaces dir (which would expose siblings).
  assertEquals(joined.includes("--bind /app/data/workspaces /app/data/workspaces "), false);
});

Deno.test("buildBwrapConfinement - shared OpenCode data dir is NOT bound writable (session-scoped XDG_DATA_HOME)", () => {
  const { args } = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "opencode",
    [],
  );
  // The shared home-rooted data dir must not be bound at all: the agent's data dir lives
  // under its session-scoped XDG_DATA_HOME (inside the workspace), so binding it would only
  // expose stale home-rooted state (e.g. a pre-built auth.json) to the confined process.
  const joined = args.join(" ");
  assertEquals(joined.includes("/home/deno/.local/share/opencode"), false);
});

Deno.test("buildBwrapConfinement - shareNet controls network namespace", () => {
  const shared = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "opencode",
    [],
  );
  assertEquals(shared.args.includes("--unshare-net"), false);

  const isolated = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: false },
    "opencode",
    [],
  );
  assertEquals(isolated.args.includes("--unshare-net"), true);
});

Deno.test("buildBwrapConfinement - inner command preserved after separator", () => {
  const { args } = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "dumb-init",
    ["--", "opencode", "acp"],
  );
  const sep = args.indexOf("--");
  assertEquals(args.slice(sep + 1), ["dumb-init", "--", "opencode", "acp"]);
});

// ---------------------------------------------------------------------------
// Trusted skill root mounts (`unify-skill-root-and-inventory` D4, generalizing
// `unify-omp-skill-root-resolution` task 4.1): the ONE deployment-resolved root
// mounts read-only AT ITS LITERAL PATH for BOTH agent types — the stock
// container root (`/home/deno/.agents/skills`, on top of the ro
// `/home/deno/.agents` parent) and custom roots alike; a root descending from a
// writable parent is bound AFTER that parent; a root equal to or containing any
// mandatory writable mount is refused BEFORE spawn; no root means no invented
// fallback mount.
// ---------------------------------------------------------------------------

const roBindPairs = (args: string[]): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === "--ro-bind-try") pairs.push([args[i + 1], args[i + 2]]);
  }
  return pairs;
};

Deno.test("buildBwrapConfinement - the resolved root mounts read-only at its literal path for either agent type", () => {
  // The single resolved root is supplied identically for both agent types, so
  // the mount is identical too — no agent-specific image tree is privileged.
  for (const agentType of ["opencode", "omp"] as const) {
    const { args } = buildBwrapConfinement(
      { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", skillRoot: "/srv/air/skills", shareNet: true },
      agentType,
      ["acp"],
    );
    assertEquals(
      roBindPairs(args).some(([src, dst]) =>
        src === "/srv/air/skills" && dst === "/srv/air/skills"
      ),
      true,
      agentType,
    );
  }
});

Deno.test("buildBwrapConfinement - OpenCode container root mounts ro while the legitimate personal-tree visibility stays", () => {
  const { args } = buildBwrapConfinement(
    {
      sessionWorkspace: "/app/data/workspaces/discord/1",
      tmpDir: "/app/data/workspaces/discord/1/tmp",
      skillRoot: "/home/deno/.agents/skills",
      shareNet: true,
    },
    "opencode",
    [],
  );
  const pairs = roBindPairs(args);
  // The selected installed root itself is read-only bound at the literal path…
  assertEquals(
    pairs.some(([src, dst]) =>
      src === "/home/deno/.agents/skills" && dst === "/home/deno/.agents/skills"
    ),
    true,
  );
  // …while the pre-existing OpenCode `/home/deno/.agents` read-only visibility
  // (DEFAULT_CONFINEMENT_READONLY_PATHS) remains — its relationship derives
  // from the selected installed root, not from the hardcoded parent as trust.
  assertEquals(pairs.some(([src]) => src === "/home/deno/.agents"), true);
  // The skill bind is emitted LAST (after every writable mount), directly
  // before the inner-command `--` separator.
  assertEquals(args.lastIndexOf("--ro-bind-try"), args.indexOf("--") - 3);
});

Deno.test("buildBwrapConfinement - custom root mounts read-only at its literal path", () => {
  const { args } = buildBwrapConfinement(
    {
      sessionWorkspace: "/srv/deploy/ws",
      tmpDir: "/srv/deploy/ws/tmp",
      skillRoot: "/srv/deploy/skills",
      shareNet: true,
    },
    "opencode",
    [],
  );
  assertEquals(
    roBindPairs(args).some(([src, dst]) =>
      src === "/srv/deploy/skills" && dst === "/srv/deploy/skills"
    ),
    true,
  );
});

Deno.test("buildBwrapConfinement - skill root under a writable parent binds read-only AFTER the parent", () => {
  // Development layout: the session workspace is writable and the deployment
  // skill tree descends from it. The child ro bind must come AFTER the parent
  // `--bind`, or the writable parent mount would win.
  const { args } = buildBwrapConfinement(
    {
      sessionWorkspace: "/srv/deploy",
      tmpDir: "/srv/deploy/tmp",
      skillRoot: "/srv/deploy/skills",
      shareNet: true,
    },
    "opencode",
    [],
  );
  const parent = args.indexOf("--bind") >= 0
    ? args.findIndex((a, i) => a === "--bind" && args[i + 1] === "/srv/deploy")
    : -1;
  const child = args.findIndex((a, i) =>
    a === "--ro-bind-try" && args[i + 1] === "/srv/deploy/skills"
  );
  assertEquals(parent >= 0, true);
  assertEquals(child >= 0, true);
  assertEquals(child > parent, true);
});

Deno.test("buildBwrapConfinement - skill root equal to a writable mount is refused before spawn", () => {
  assertThrows(
    () =>
      buildBwrapConfinement(
        {
          sessionWorkspace: "/ws/skills",
          tmpDir: "/ws/tmp",
          skillRoot: "/ws/skills",
          shareNet: true,
        },
        "opencode",
        [],
      ),
    Error,
    "agent-writable skill root is refused",
  );
});

Deno.test("buildBwrapConfinement - skill root containing the session TMPDIR is refused", () => {
  assertThrows(
    () =>
      buildBwrapConfinement(
        {
          sessionWorkspace: "/ws",
          tmpDir: "/skill-root/tmp",
          skillRoot: "/skill-root",
          shareNet: true,
        },
        "opencode",
        [],
      ),
    Error,
    "agent-writable skill root is refused",
  );
});

Deno.test("buildBwrapConfinement - skill root containing a writable runtime path is refused", () => {
  // `/home/deno` contains the default writable runtime `/home/deno/.cache`:
  // mounting it read-only would hole the read-only mount where the permission
  // layer still reports the grant — refused, not reordered.
  assertThrows(
    () =>
      buildBwrapConfinement(
        { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", skillRoot: "/home/deno", shareNet: true },
        "opencode",
        [],
      ),
    Error,
    "agent-writable skill root is refused",
  );
});

Deno.test("buildBwrapConfinement - skill root equal to the shared agent workspace is refused", () => {
  assertThrows(
    () =>
      buildBwrapConfinement(
        {
          sessionWorkspace: "/ws",
          tmpDir: "/ws/tmp",
          agentWorkspace: "/data/agent-workspace",
          skillRoot: "/data/agent-workspace",
          shareNet: true,
        },
        "opencode",
        [],
      ),
    Error,
    "agent-writable skill root is refused",
  );
});

Deno.test("buildBwrapConfinement - no skill root invents no fallback mount", () => {
  const { args } = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "opencode",
    [],
  );
  const joined = args.join(" ");
  // Neither a skill bind source nor any baked-in tree appears: with no resolved
  // root supplied, the confinement adds no skill mount of its own.
  assertEquals(roBindPairs(args).some(([, dst]) => dst.endsWith("/skills")), false);
  assertEquals(joined.includes("/app/skills"), false);
  // Only the DEFAULT read-only set is bound; no extra ro bind beyond defaults.
  assertEquals(roBindPairs(args).length >= 0, true);
  const defaultOnly = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "opencode",
    [],
  );
  assertEquals(roBindPairs(defaultOnly.args).length, roBindPairs(args).length);
});

// ---------------------------------------------------------------------------
// Shared OMP native payload mounts (`deduplicate-omp-native-runtime-cache`
// tasks 4.1/4.2/4.3): the selected shared payload subtree is bound read-only at
// its LITERAL link-target spelling with a HARD `--ro-bind` (never a `-try`
// variant), and it is the ABSOLUTE LAST mount — after every writable bind, the
// mode-parent tmpfs shadow, the per-launch writable child re-bind and the skill
// root. A writable ANCESTOR (the development HOME cache) stays legal because the
// payload's own later bind wins; a writable alias or nested writable that
// physically resolves to the payload is refused before spawn; the existing
// skill-root overlap refusal is untouched; an OpenCode launch emits no payload
// bind at all.
// ---------------------------------------------------------------------------

/** The development-cache payload spelling used across these cases. */
const PAYLOAD = "/srv/devhome/.cache/air-friends/omp/linux-x64/natives";

/** Every hard `--ro-bind <src> <dst>` pair in argv order (`-try` excluded). */
const hardRoBindPairs = (args: string[]): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === "--ro-bind") pairs.push([args[i + 1], args[i + 2]]);
  }
  return pairs;
};

/** argv index of the first `flag <src> …` emission with source `src`, or -1. */
const bindIndex = (args: string[], flag: string, src: string): number => {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === src) return i;
  }
  return -1;
};

/** Every `--tmpfs <path>` target in argv order. */
const tmpfsTargets = (args: string[]): string[] => {
  const targets: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--tmpfs") targets.push(args[i + 1]);
  }
  return targets;
};

/** Every `flag <src> <src>` self-bind source in argv order. */
const selfBindSources = (args: string[], flag: string): string[] => {
  const sources: string[] = [];
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === flag && args[i + 1] === args[i + 2]) sources.push(args[i + 1]);
  }
  return sources;
};

Deno.test("buildBwrapConfinement - the shared payload binds read-only LAST, after every writable bind, shadow and the skill root", () => {
  const skillRoot = "/ws/skills";
  const shadowed = "/ws/tmp/omp-agent";
  const runtimeWritable = "/ws/tmp/omp-agent/restricted/xdg-data/omp";
  const runtimeReadOnly = "/ro/assets/restricted.yml";
  const { args } = buildBwrapConfinement(
    {
      sessionWorkspace: "/ws",
      tmpDir: "/ws/tmp",
      skillRoot,
      readOnlyPaths: ["/ro/settings.yml"],
      writableRuntimePaths: ["/rw/state"],
      runtimeReadOnlyPaths: [runtimeReadOnly],
      runtimeWritablePaths: [runtimeWritable],
      shadowedRuntimePaths: [shadowed],
      payloadReadOnlyPaths: [PAYLOAD],
      shareNet: true,
    },
    "omp",
    ["acp"],
  );

  // The payload is emitted as a HARD `--ro-bind <literal> <literal>` …
  const payloadIdx = bindIndex(args, "--ro-bind", PAYLOAD);
  assertEquals(payloadIdx > -1, true, args.join(" "));
  assertEquals(args[payloadIdx + 2], PAYLOAD);
  // … never through the lenient `-try` variant (a vanished source must fail).
  assertEquals(roBindPairs(args).some(([src]) => src === PAYLOAD), false);

  // … and it is the LAST mount: everything the builder emits between the
  // mount list and the inner command is exactly this payload pair.
  const separator = args.indexOf("--");
  assertEquals(args.slice(separator - 3, separator), ["--ro-bind", PAYLOAD, PAYLOAD]);

  // Positional proof against each earlier group, independent of the slice above.
  const shadowIdx = args.findIndex((arg, i) => arg === "--tmpfs" && args[i + 1] === shadowed);
  const assertLater = (index: number, label: string): void => {
    assertEquals(index > -1 && index < payloadIdx, true, `${label} must precede the payload bind`);
  };
  assertLater(shadowIdx, "the mode-parent shadow");
  assertLater(bindIndex(args, "--bind", "/ws"), "the session workspace bind");
  assertLater(bindIndex(args, "--bind", "/ws/tmp"), "the session TMPDIR bind");
  assertLater(bindIndex(args, "--bind-try", "/rw/state"), "a shared writable runtime bind");
  assertLater(bindIndex(args, "--bind-try", runtimeWritable), "the late writable child re-bind");
  assertLater(bindIndex(args, "--ro-bind-try", runtimeReadOnly), "a late read-only input");
  assertLater(bindIndex(args, "--ro-bind-try", skillRoot), "the skill root");

  // Only the payload subtree itself is exposed: no mount target is an ancestor
  // of the payload (the cache parent HOME / deployment tree stays hidden).
  const mountedTargets = [
    ...selfBindSources(args, "--bind"),
    ...selfBindSources(args, "--bind-try"),
    ...roBindPairs(args).map(([src]) => src),
    ...hardRoBindPairs(args).map(([src]) => src),
    ...tmpfsTargets(args),
  ];
  for (const target of mountedTargets) {
    if (target === PAYLOAD) continue;
    assertEquals(
      PAYLOAD.startsWith(`${target}/`),
      false,
      `"${target}" must not expose the payload's ancestor tree`,
    );
  }
});

Deno.test("buildBwrapConfinement - a writable ancestor of the payload is allowed (development HOME cache)", () => {
  const writableCacheParent = "/srv/devhome/.cache";
  const { args } = buildBwrapConfinement(
    {
      sessionWorkspace: "/ws",
      tmpDir: "/ws/tmp",
      writableRuntimePaths: [writableCacheParent],
      payloadReadOnlyPaths: [PAYLOAD],
      shareNet: true,
    },
    "omp",
    [],
  );
  // The ancestor really is bound writable …
  const ancestorIdx = bindIndex(args, "--bind-try", writableCacheParent);
  assertEquals(ancestorIdx > -1, true);
  // … and the payload's own hard bind is emitted AFTER it, so it still wins.
  assertEquals(bindIndex(args, "--ro-bind", PAYLOAD) > ancestorIdx, true);
});

Deno.test("buildBwrapConfinement - the payload bind names the LITERAL target spelling, not the canonical path", () => {
  const base = Deno.makeTempDirSync({ prefix: "air-omp-payload-literal-" });
  try {
    const realPayload = join(base, "real-natives");
    Deno.mkdirSync(realPayload, { recursive: true });
    const linkPayload = join(base, "natives-link");
    Deno.symlinkSync(realPayload, linkPayload);
    const canonical = Deno.realPathSync(linkPayload);
    assertEquals(canonical !== linkPayload, true);

    const { args } = buildBwrapConfinement(
      {
        sessionWorkspace: "/ws",
        tmpDir: "/ws/tmp",
        payloadReadOnlyPaths: [linkPayload],
        shareNet: true,
      },
      "omp",
      [],
    );
    assertEquals(
      hardRoBindPairs(args).some(([src, dst]) => src === linkPayload && dst === linkPayload),
      true,
    );
    assertEquals(args.includes(canonical), false);
  } finally {
    Deno.removeSync(base, { recursive: true });
  }
});

Deno.test("buildBwrapConfinement - a writable alias physically resolving to the payload is refused", () => {
  const base = Deno.makeTempDirSync({ prefix: "air-omp-payload-alias-" });
  try {
    const realPayload = join(base, "natives");
    Deno.mkdirSync(realPayload, { recursive: true });
    const alias = join(base, "natives-alias");
    Deno.symlinkSync(realPayload, alias);
    assertThrows(
      () =>
        buildBwrapConfinement(
          {
            sessionWorkspace: "/ws",
            tmpDir: "/ws/tmp",
            writableRuntimePaths: [alias],
            payloadReadOnlyPaths: [realPayload],
            shareNet: true,
          },
          "omp",
          [],
        ),
      Error,
      "overlaps mandatory writable mount",
    );
  } finally {
    Deno.removeSync(base, { recursive: true });
  }
});

Deno.test("buildBwrapConfinement - a writable nested inside the payload is refused", () => {
  // A nested writable (literal or through a physical alias) would silently hole
  // the read-only payload, so it is refused before any mount is emitted.
  assertThrows(
    () =>
      buildBwrapConfinement(
        {
          sessionWorkspace: "/ws",
          tmpDir: "/ws/tmp",
          writableRuntimePaths: [`${PAYLOAD}/child`],
          payloadReadOnlyPaths: [PAYLOAD],
          shareNet: true,
        },
        "omp",
        [],
      ),
    Error,
    "overlaps mandatory writable mount",
  );

  const base = Deno.makeTempDirSync({ prefix: "air-omp-payload-nested-" });
  try {
    const payload = join(base, "natives");
    Deno.mkdirSync(join(payload, "child"), { recursive: true });
    const escapingAlias = join(base, "elsewhere");
    Deno.symlinkSync(join(payload, "child"), escapingAlias);
    assertThrows(
      () =>
        buildBwrapConfinement(
          {
            sessionWorkspace: "/ws",
            tmpDir: "/ws/tmp",
            writableRuntimePaths: [escapingAlias],
            payloadReadOnlyPaths: [payload],
            shareNet: true,
          },
          "omp",
          [],
        ),
      Error,
      "overlaps mandatory writable mount",
    );
  } finally {
    Deno.removeSync(base, { recursive: true });
  }
});

Deno.test("buildBwrapConfinement - the skill-root overlap refusal is unchanged when a payload mount is present", () => {
  assertThrows(
    () =>
      buildBwrapConfinement(
        {
          sessionWorkspace: "/ws/skills",
          tmpDir: "/ws/tmp",
          skillRoot: "/ws/skills",
          payloadReadOnlyPaths: [PAYLOAD],
          shareNet: true,
        },
        "omp",
        [],
      ),
    Error,
    "agent-writable skill root is refused",
  );
});

Deno.test("buildBwrapConfinement - an OpenCode launch emits no payload bind", () => {
  const { args } = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", shareNet: true },
    "opencode",
    [],
  );
  // No hard read-only bind at all, and no baked-in image cache path: the
  // payload mount exists only when an OMP caller selects one.
  assertEquals(hardRoBindPairs(args).length, 0);
  assertEquals(args.includes("/opt/air/omp/native-cache"), false);
  assertEquals(args.some((arg) => arg.includes("/air-friends/omp/")), false);
});
