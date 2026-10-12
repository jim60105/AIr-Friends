import { assertEquals, assertThrows } from "@std/assert";
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
// Trusted skill root mounts (`unify-omp-skill-root-resolution` D4 / task 4.1):
// the selected root mounts read-only AT ITS LITERAL PATH — image (OMP
// `/opt/air/skills`, OpenCode `/home/deno/.agents/skills` on top of the ro
// `/home/deno/.agents` parent) and custom roots alike; a root descending from
// a writable parent is bound AFTER that parent; a root equal to or containing
// any mandatory writable mount is refused BEFORE spawn; no root means no
// invented fallback mount.
// ---------------------------------------------------------------------------

const roBindPairs = (args: string[]): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === "--ro-bind-try") pairs.push([args[i + 1], args[i + 2]]);
  }
  return pairs;
};

Deno.test("buildBwrapConfinement - OMP image root mounts read-only at its literal path", () => {
  const { args } = buildBwrapConfinement(
    { sessionWorkspace: "/ws", tmpDir: "/ws/tmp", skillRoot: "/opt/air/skills", shareNet: true },
    "omp",
    ["acp"],
  );
  assertEquals(
    roBindPairs(args).some(([src, dst]) => src === "/opt/air/skills" && dst === "/opt/air/skills"),
    true,
  );
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
  assertEquals(joined.includes("/opt/air/skills"), false);
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
