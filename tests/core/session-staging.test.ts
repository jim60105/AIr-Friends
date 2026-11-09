// tests/core/session-staging.test.ts

import { assertEquals } from "@std/assert";
import { sessionStagingDir } from "@core/session-staging.ts";
import { test } from "bun:test";

test("sessionStagingDir - composes the canonical absolute staging path", () => {
  // The canonical payload staging location: {session workspace}/tmp/{sessionId}.
  assertEquals(
    sessionStagingDir({ tmpPath: "/data/workspaces/discord/123/tmp" }, "sess_42"),
    "/data/workspaces/discord/123/tmp/sess_42",
  );
});

test("sessionStagingDir - falls back to the workspace tmp root without an id", () => {
  // Skill-API-disabled sessions have no literal id; the payload helper's
  // documented no-id fallback is {workspace}/tmp.
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, undefined), "/ws/tmp");
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, null), "/ws/tmp");
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, ""), "/ws/tmp");
});

test("sessionStagingDir - pure composition: no resolution, no env reads", () => {
  const envBefore = {
    TMPDIR: process.env["TMPDIR"],
    SESSION_ID: process.env["SESSION_ID"],
    SKILL_SHARED_PROCESS: process.env["SKILL_SHARED_PROCESS"],
    SKILL_JWT_DIR: process.env["SKILL_JWT_DIR"],
  };
  // A relative tmpPath stays untouched (no normalize/resolve side effect),
  // so the row-4 authorized-path form is byte-preserved.
  assertEquals(sessionStagingDir({ tmpPath: "data/ws/tmp" }, "s1"), "data/ws/tmp/s1");
  // A process TMPDIR (or SESSION_ID) NEVER leaks into the composition.
  process.env["TMPDIR"] = "/elsewhere";
  process.env["SESSION_ID"] = "frozen";
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, "s1"), "/ws/tmp/s1");
  delete process.env["TMPDIR"];
  delete process.env["SESSION_ID"];
  assertEquals(sessionStagingDir({ tmpPath: "/ws/tmp" }, "s1"), "/ws/tmp/s1");
  for (const [k, v] of Object.entries(envBefore)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
