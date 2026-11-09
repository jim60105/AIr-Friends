// tests/skills/staging-compat.test.ts
//
// Pinned backward-compatibility cases (make-skill-staging-agent-portable,
// design D6): the prompts/skills no longer INSTRUCT the `$TMPDIR/$SESSION_ID`
// token form, but the legacy expansion routes must keep working unchanged —
// an older OpenCode session (or operator-mounted prompt) whose agent still
// stages via the token path arrives at the script as an ordinary expanded
// path (bash) or an expanded structured-tool path (ACP permission gate), and
// must resolve/read/delete exactly as the literal form does. The resolution
// LOGIC itself is unchanged by this change — these tests pin it.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import { resolveSessionPath, type SessionContext } from "@acp/filesystem-roots.ts";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../skills/send-reply/scripts/send-reply.ts", import.meta.url),
);

/**
 * Accept one HTTP request on a one-shot mock API, run the real send-reply
 * script against it, and return the delivered body plus script outcome.
 */
async function deliverOnce(opts: {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<{ code: number; stderr: string; body: unknown }> {
  const { promise: bodyPromise, resolve: settleBody } = Promise.withResolvers<unknown>();
  let settled = false;
  const resolveBody = (value: unknown): void => {
    if (settled) return;
    settled = true;
    settleBody(value);
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      try {
        resolveBody(await req.json());
      } catch {
        resolveBody({});
      }
      return Response.json({ success: true, data: { messageId: "m_ok" } });
    },
  });
  const port = server.port;

  const run = Bun.spawn([SCRIPT_PATH, ...opts.args, "--api-url", `http://127.0.0.1:${port}`], {
    cwd: opts.cwd,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "/tmp", ...opts.env },
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    const [stderr, code] = await Promise.all([
      new Response(run.stderr).text(),
      run.exited,
    ]);
    resolveBody({});
    return { code, stderr, body: await bodyPromise };
  } finally {
    await server.stop(true);
  }
}

function exists(path: string): boolean {
  try {
    fs.statSync(path);
    return true;
  } catch {
    return false;
  }
}

test("compat - per-spawn legacy shell-EXPANDED token path still resolves, reads, deletes", async () => {
  // What bash hands the script when an older prompt still instructs
  // `--message-file "$TMPDIR/$SESSION_ID/reply.md"`: with per-spawn
  // TMPDIR={workspace}/tmp and SESSION_ID={session}, the expansion lands on
  // the canonical staging root {cwd}/tmp/{sessionId} — accepted, read
  // verbatim, deleted after the successful call.
  const ws = makeTempDirSync();
  try {
    const staging = join(ws, "tmp", "sess_legacy");
    fs.mkdirSync(staging, { recursive: true });
    const payloadFile = join(staging, "reply.md");
    fs.writeFileSync(payloadFile, "legacy $PATH verbatim");
    const delivered = await deliverOnce({
      args: [
        "--session-id",
        "sess_legacy",
        // Value bash produces for "$TMPDIR/$SESSION_ID/reply.md":
        "--message-file",
        join(ws, "tmp", "sess_legacy", "reply.md"),
      ],
      cwd: ws,
      env: { TMPDIR: join(ws, "tmp"), SESSION_ID: "sess_legacy" },
    });
    assertEquals(delivered.code, 0, delivered.stderr);
    const body = delivered.body as { sessionId: string; parameters: { message: string } };
    assertEquals(body.sessionId, "sess_legacy");
    assertEquals(body.parameters.message, "legacy $PATH verbatim");
    assertEquals(exists(payloadFile), false, "payload consumed after success");
  } finally {
    fs.rmSync(ws, { recursive: true });
  }
});

test("compat - literal absolute path behaves identically to the expanded legacy path", async () => {
  // The instructed literal form resolves/reads/deletes exactly as the legacy
  // expanded token path did (both are {workspace}/tmp/{sessionId}/reply.md).
  const ws = makeTempDirSync();
  try {
    const staging = join(ws, "tmp", "sess_lit");
    fs.mkdirSync(staging, { recursive: true });
    const payloadFile = join(staging, "reply.md");
    fs.writeFileSync(payloadFile, "literal form $0");
    const delivered = await deliverOnce({
      args: ["--session-id", "sess_lit", "--message-file", payloadFile],
      cwd: ws,
      // NO SESSION_ID/TMPDIR at all: pooled shape, CLI literal wins via the
      // per-spawn fallback base {cwd}/tmp/{sessionId}.
      env: {},
    });
    assertEquals(delivered.code, 0, delivered.stderr);
    const body = delivered.body as { sessionId: string; parameters: { message: string } };
    assertEquals(body.parameters.message, "literal form $0");
    assertEquals(exists(payloadFile), false);
  } finally {
    fs.rmSync(ws, { recursive: true });
  }
});

test("compat - expanded path OUTSIDE the canonical staging root stays rejected (TMPDIR never followed)", () => {
  // A process TMPDIR naming a different directory yields an expanded path
  // outside {cwd}/tmp/{sessionId}: containment still rejects (row-9
  // invariant — resolution never consults $TMPDIR).
  const ws = makeTempDirSync();
  const outside = makeTempDirSync();
  try {
    fs.writeFileSync(join(outside, "reply.md"), "leak");
    const payloadPath = fileURLToPath(new URL("../../skills/lib/payload.ts", import.meta.url));
    const probe = `
import { resolvePayloadPath } from ${JSON.stringify(payloadPath)};
try {
  resolvePayloadPath(${JSON.stringify(join(outside, "reply.md"))}, ${
      JSON.stringify(ws)
    }, "sess_x", { flagName: "message", example: "e", fileName: "reply.md" });
  console.log("ACCEPTED");
} catch (e) {
  console.log(JSON.stringify({ code: e.code }));
}
`;
    const probePath = join(ws, "probe.ts");
    fs.writeFileSync(probePath, probe);
    const out = spawnSync(process.execPath, ["run", probePath], {
      env: { PATH: process.env["PATH"] ?? "", TMPDIR: outside },
      encoding: "utf8",
    });
    const line = out.stdout.trim();
    assertEquals(JSON.parse(line).code, "SKILL_PAYLOAD_OUT_OF_BOUNDS");
  } finally {
    fs.rmSync(ws, { recursive: true });
    fs.rmSync(outside, { recursive: true });
  }
});

test("compat - ACP-side structured-tool token paths still expand to the canonical staging root", () => {
  // Row-2/4 expansion behavior retained with no new code: an older session's
  // edit/write tool naming `$TMPDIR/$SESSION_ID/reply.md` is expanded by the
  // permission gate from ITS per-session context to the canonical staging
  // root — the same directory the literals now render in the prompt.
  const context: SessionContext = {
    acpSessionId: "acp-1",
    skillSessionId: "sess_compat",
    sessionCwd: "/data/workspaces/discord/123",
    explicitStagingPath: "/data/workspaces/discord/123/tmp/sess_compat",
    sharedWorkspacePath: "/data/agent-workspace",
    sessionContextGeneration: "gen-1",
  };
  const legacy = resolveSessionPath("$TMPDIR/$SESSION_ID/reply.md", context);
  const literal = resolveSessionPath(
    "/data/workspaces/discord/123/tmp/sess_compat/reply.md",
    context,
  );
  assertEquals(legacy.ok, true);
  assertEquals(literal.ok, true);
  if (legacy.ok && literal.ok) {
    assertEquals(legacy.value.normalizedPath, literal.value.normalizedPath);
    assertStringIncludes(literal.value.normalizedPath, "/tmp/sess_compat/reply.md");
  }
});
