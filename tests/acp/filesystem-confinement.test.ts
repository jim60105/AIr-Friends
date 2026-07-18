import { assertEquals } from "@std/assert";
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
