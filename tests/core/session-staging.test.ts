// tests/core/session-staging.test.ts

import { assertEquals } from "@std/assert";
import { sessionStagingDir } from "@core/session-staging.ts";

Deno.test("sessionStagingDir - composes the canonical absolute staging path", () => {
  // The canonical payload staging location: {session workspace}/tmp/{sessionId}.
  assertEquals(
    sessionStagingDir({ tmpPath: "/data/workspaces/discord/123/tmp" }, "sess_42"),
    "/data/workspaces/discord/123/tmp/sess_42",
  );
});

Deno.test("sessionStagingDir - falls back to the workspace tmp root without an id", () => {
  // Skill-API-disabled sessions have no literal id; the payload helper's
  // documented no-id fallback is {workspace}/tmp.
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, undefined), "/ws/tmp");
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, null), "/ws/tmp");
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, ""), "/ws/tmp");
});

Deno.test("sessionStagingDir - pure composition: no resolution, no env reads", async () => {
  const envBefore = {
    TMPDIR: Deno.env.get("TMPDIR"),
    SESSION_ID: Deno.env.get("SESSION_ID"),
    SKILL_SHARED_PROCESS: Deno.env.get("SKILL_SHARED_PROCESS"),
    SKILL_JWT_DIR: Deno.env.get("SKILL_JWT_DIR"),
  };
  // A relative tmpPath stays untouched (no normalize/resolve side effect),
  // so the row-4 authorized-path form is byte-preserved.
  assertEquals(sessionStagingDir({ tmpPath: "data/ws/tmp" }, "s1"), "data/ws/tmp/s1");
  // A process TMPDIR (or SESSION_ID) NEVER leaks into the composition.
  Deno.env.set("TMPDIR", "/elsewhere");
  Deno.env.set("SESSION_ID", "frozen");
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, "s1"), "/ws/tmp/s1");
  Deno.env.delete("TMPDIR");
  Deno.env.delete("SESSION_ID");
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, "s1"), "/ws/tmp/s1");
  for (const [k, v] of Object.entries(envBefore)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
});
