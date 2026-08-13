// tests/utils/opencode-paths.test.ts

import { assertEquals } from "@std/assert";
import {
  opencodeDataRoot,
  opencodeToolOutputDir,
  sessionXdgDataHome,
} from "@utils/opencode-paths.ts";

Deno.test("opencode-paths - opencodeDataRoot derives a dir under the session TMPDIR", () => {
  assertEquals(
    opencodeDataRoot("/app/data/workspaces/discord/123"),
    "/app/data/workspaces/discord/123/tmp/opencode-data",
  );
});

Deno.test("opencode-paths - sessionXdgDataHome without a session id uses the workspace-level root", () => {
  assertEquals(
    sessionXdgDataHome("/app/data/workspaces/discord/123"),
    "/app/data/workspaces/discord/123/tmp/opencode-data",
  );
});

Deno.test("opencode-paths - sessionXdgDataHome with a session id scopes under the root", () => {
  assertEquals(
    sessionXdgDataHome("/app/data/workspaces/discord/123", "sess_abc"),
    "/app/data/workspaces/discord/123/tmp/opencode-data/sess_abc",
  );
});

Deno.test("opencode-paths - opencodeToolOutputDir matches OpenCode's hard-coded layout", () => {
  assertEquals(
    opencodeToolOutputDir("/app/data/workspaces/discord/123/tmp/opencode-data/sess_abc"),
    "/app/data/workspaces/discord/123/tmp/opencode-data/sess_abc/opencode/tool-output",
  );
});

Deno.test("opencode-paths - composed helpers are deterministic from the workspace and session id", () => {
  const workingDir = "/app/data/workspaces/discord/123";
  const sessionId = "sess_abc";
  const toolOutputDir = opencodeToolOutputDir(sessionXdgDataHome(workingDir, sessionId));
  // The gate boundary and the subprocess env derive the same directory.
  assertEquals(
    toolOutputDir,
    "/app/data/workspaces/discord/123/tmp/opencode-data/sess_abc/opencode/tool-output",
  );
});
