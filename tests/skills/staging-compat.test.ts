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
import { join } from "@std/path";
import { resolveSessionPath, type SessionContext } from "@acp/filesystem-roots.ts";

const SCRIPT_URL = new URL("../../skills/send-reply/scripts/send-reply.ts", import.meta.url);

/**
 * Accept one HTTP request on a one-shot mock API, run the real send-reply
 * script against it, and return the delivered body plus script outcome.
 */
async function deliverOnce(opts: {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<{ code: number; stderr: string; body: unknown }> {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const { promise: bodyPromise, resolve: resolveBody } = Promise.withResolvers<unknown>();
  (async () => {
    const conn = await listener.accept();
    const reader = conn.readable.getReader();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      if (text.includes("\r\n\r\n")) break;
    }
    resolveBody(JSON.parse(text.split("\r\n\r\n").slice(1).join("\r\n\r\n")));
    const payload = `{"success":true,"data":{"messageId":"m_ok"}}`;
    const writer = conn.writable.getWriter();
    await writer.write(
      new TextEncoder().encode(
        `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${payload.length}\r\nconnection: close\r\n\r\n${payload}`,
      ),
    );
    writer.releaseLock();
    await conn.writable.close();
  })().catch(() => resolveBody({}));

  const run = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--allow-write",
      SCRIPT_URL.href,
      ...opts.args,
      "--api-url",
      `http://127.0.0.1:${port}`,
    ],
    cwd: opts.cwd,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "/tmp", ...opts.env },
    clearEnv: true,
  }).output();
  const body = await bodyPromise;
  listener.close();
  return { code: run.code, stderr: new TextDecoder().decode(run.stderr), body };
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("compat - per-spawn legacy shell-EXPANDED token path still resolves, reads, deletes", async () => {
  // What bash hands the script when an older prompt still instructs
  // `--message-file "$TMPDIR/$SESSION_ID/reply.md"`: with per-spawn
  // TMPDIR={workspace}/tmp and SESSION_ID={session}, the expansion lands on
  // the canonical staging root {cwd}/tmp/{sessionId} — accepted, read
  // verbatim, deleted after the successful call.
  const ws = Deno.makeTempDirSync();
  try {
    const staging = join(ws, "tmp", "sess_legacy");
    Deno.mkdirSync(staging, { recursive: true });
    const payloadFile = join(staging, "reply.md");
    Deno.writeTextFileSync(payloadFile, "legacy $PATH verbatim");
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
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("compat - literal absolute path behaves identically to the expanded legacy path", async () => {
  // The instructed literal form resolves/reads/deletes exactly as the legacy
  // expanded token path did (both are {workspace}/tmp/{sessionId}/reply.md).
  const ws = Deno.makeTempDirSync();
  try {
    const staging = join(ws, "tmp", "sess_lit");
    Deno.mkdirSync(staging, { recursive: true });
    const payloadFile = join(staging, "reply.md");
    Deno.writeTextFileSync(payloadFile, "literal form $0");
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
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("compat - expanded path OUTSIDE the canonical staging root stays rejected (TMPDIR never followed)", () => {
  // A process TMPDIR naming a different directory yields an expanded path
  // outside {cwd}/tmp/{sessionId}: containment still rejects (row-9
  // invariant — resolution never consults $TMPDIR).
  const ws = Deno.makeTempDirSync();
  const outside = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(join(outside, "reply.md"), "leak");
    const payloadUrl = new URL("../../skills/lib/payload.ts", import.meta.url).href;
    const probe = `
import { resolvePayloadPath } from ${JSON.stringify(payloadUrl)};
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
    Deno.writeTextFileSync(probePath, probe);
    const out = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-check", "--allow-read", "--allow-env", probePath],
      env: { PATH: Deno.env.get("PATH") ?? "", TMPDIR: outside },
      clearEnv: true,
    }).outputSync();
    const line = new TextDecoder().decode(out.stdout).trim();
    assertEquals(JSON.parse(line).code, "SKILL_PAYLOAD_OUT_OF_BOUNDS");
  } finally {
    Deno.removeSync(ws, { recursive: true });
    Deno.removeSync(outside, { recursive: true });
  }
});

Deno.test("compat - ACP-side structured-tool token paths still expand to the canonical staging root", () => {
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
