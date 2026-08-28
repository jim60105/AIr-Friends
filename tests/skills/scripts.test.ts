// Subprocess integration tests for skill scripts (payload-file contract).
//
// The scripts are executed DIRECTLY via their shebang
// (`#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read`) with a
// staged payload and a mock `--api-url` HTTP server, asserting that:
//   - `$`/newline/empty content reaches the API verbatim
//   - legacy flags (both forms) exit non-zero with SKILL_LEGACY_FLAG guidance
//     and never hit the API
//   - payloads outside the session staging dir are rejected with
//     SKILL_PAYLOAD_OUT_OF_BOUNDS

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..", "..");

interface MockApi {
  url: string;
  requests: Array<{ skillName: string; sessionId: string; parameters: Record<string, unknown> }>;
  close: () => Promise<void>;
}

function startMockApi(): MockApi {
  const requests: MockApi["requests"] = [];
  const server = Deno.serve({ port: 0 }, async (req) => {
    const body = await req.json() as {
      sessionId?: string;
      parameters?: Record<string, unknown>;
    };
    const skillName = req.url.split("/api/skill/")[1] ?? "unknown";
    requests.push({
      skillName,
      sessionId: body.sessionId ?? "",
      parameters: body.parameters ?? {},
    });
    return Response.json({ success: true, data: {} });
  });
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    requests,
    close: () => server.shutdown(),
  };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runScript(
  scriptRelPath: string,
  args: string[],
  cwd: string,
  envOverrides: Record<string, string> = {},
  runViaDeno = false,
): Promise<RunResult> {
  const scriptPath = join(REPO_ROOT, scriptRelPath);
  // Pin the staging base (TMPDIR) to this test's own {cwd}/tmp so concurrent
  // tests that mutate the process-global TMPDIR cannot affect payload
  // resolution here (matches the per-session-mode TMPDIR the agent sets).
  // SKILL_JWT_DIR must be absent: with it set, a leaked pointer from another
  // concurrent test file would hijack the JWT presentation path in client.ts.
  const env = Deno.env.toObject();
  env["TMPDIR"] = join(cwd, "tmp");
  delete env["SKILL_JWT_DIR"];
  for (const [k, v] of Object.entries(envOverrides)) {
    env[k] = v;
  }
  // Some skill scripts lack the executable bit in git (the container fixes it
  // via `--chmod=775` on COPY); run those via `deno run` with the same
  // permission set their shebang requests.
  const output = runViaDeno
    ? await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "--allow-write",
        scriptPath,
        ...args,
      ],
      cwd,
      env,
    }).output()
    : await new Deno.Command(scriptPath, { args, cwd, env }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function parseStderrJson(stderr: string): Record<string, unknown> {
  const lines = stderr.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      // Not JSON — keep scanning backwards for the JSON error line.
    }
  }
  return {};
}

function setupWorkspace(): string {
  const ws = Deno.makeTempDirSync();
  Deno.mkdirSync(join(ws, "tmp", "sess_own"), { recursive: true });
  Deno.mkdirSync(join(ws, "tmp", "sess_other"), { recursive: true });
  return ws;
}

const SEND_REPLY = "skills/send-reply/scripts/send-reply.ts";

Deno.test("scripts - send-reply delivers staged payload verbatim ($, newlines)", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const payload = join(ws, "tmp", "sess_own", "reply.md");
    Deno.writeTextFileSync(payload, "定價 $0.435 / $HOME\nline2");

    const result = await runScript(
      SEND_REPLY,
      ["--session-id", "sess_own", "--api-url", api.url, "--message-file", payload],
      ws,
    );

    assertEquals(result.code, 0, result.stderr);
    assertEquals(api.requests.length, 1);
    assertEquals(api.requests[0].skillName, "send-reply");
    assertEquals(api.requests[0].parameters.message, "定價 $0.435 / $HOME\nline2");

    // Payload file deleted after successful read.
    let exists = true;
    try {
      Deno.statSync(payload);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - send-reply delivers empty payload verbatim", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const payload = join(ws, "tmp", "sess_own", "reply.md");
    Deno.writeTextFileSync(payload, "");

    const result = await runScript(
      SEND_REPLY,
      ["--session-id", "sess_own", "--api-url", api.url, "--message-file", payload],
      ws,
    );

    assertEquals(result.code, 0, result.stderr);
    assertEquals(api.requests[0].parameters.message, "");
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - shared mode: identity-only skill (react-message) fails with structured SKILL_SESSION_UNRESOLVED on malformed pointer", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  const jwtDir = Deno.makeTempDirSync();
  try {
    // Malformed pointer: sessionId is a number — must fail the schema check
    // instead of resolving a wrong identity or throwing an obscure TypeError.
    await Deno.writeTextFile(join(jwtDir, "active.json"), JSON.stringify({ sessionId: 42 }));

    const result = await runScript(
      "skills/react-message/scripts/react-message.ts",
      ["--session-id", "sess_A", "--api-url", api.url, "--emoji", "👍"],
      ws,
      { SKILL_SHARED_PROCESS: "1", SKILL_JWT_DIR: jwtDir },
      true, // react-message.ts is not executable in git; run via deno run
    );

    assertEquals(result.code !== 0, true);
    const err = parseStderrJson(result.stderr);
    // The structured `code` field carries the stable token (typed error).
    assertEquals(err.code, "SKILL_SESSION_UNRESOLVED");
    assertStringIncludes(String(err.error ?? ""), `${jwtDir}/active.json`);
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    await Deno.remove(jwtDir, { recursive: true });
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - shared mode: API body sessionId is the pointer owner, not the --session-id arg", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  const jwtDir = Deno.makeTempDirSync();
  try {
    // Pool state: the current-session pointer names sess_B (its own staging
    // root), while the agent's CLI argument says sess_A (e.g. a stale value).
    await Deno.writeTextFile(
      join(jwtDir, "active.json"),
      JSON.stringify({ sessionId: "sess_B", staging: join(ws, "tmp") }),
    );
    await Deno.writeTextFile(join(jwtDir, "sess_B.jwt"), "test-jwt\n");
    Deno.mkdirSync(join(ws, "tmp", "sess_B"), { recursive: true });
    const payload = join(ws, "tmp", "sess_B", "reply.md");
    Deno.writeTextFileSync(payload, "shared-mode reply");

    const result = await runScript(
      SEND_REPLY,
      ["--session-id", "sess_A", "--api-url", api.url, "--message-file", payload],
      ws,
      { SKILL_SHARED_PROCESS: "1", SKILL_JWT_DIR: jwtDir },
    );

    assertEquals(result.code, 0, result.stderr);
    assertEquals(api.requests.length, 1);
    // The JWT `sub` check requires the request body sessionId to equal the
    // pointer-resolved owning session — never the stale CLI argument.
    assertEquals(api.requests[0].sessionId, "sess_B");
    assertEquals(api.requests[0].parameters.message, "shared-mode reply");
  } finally {
    await api.close();
    await Deno.remove(jwtDir, { recursive: true });
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - memory-save delivers staged content verbatim", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const payload = join(ws, "tmp", "sess_own", "content.md");
    Deno.writeTextFileSync(payload, "prefers $HOME coffee\nand $0.435 pricing");

    const result = await runScript(
      "skills/memory-save/scripts/memory-save.ts",
      ["--session-id", "sess_own", "--api-url", api.url, "--content-file", payload],
      ws,
    );

    assertEquals(result.code, 0, result.stderr);
    assertEquals(api.requests[0].skillName, "memory-save");
    assertEquals(api.requests[0].parameters.content, "prefers $HOME coffee\nand $0.435 pricing");
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - send-file multi-file flag reaches API as array, caption optional", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    // Without caption: no caption param sent; repeatable --file-paths is an array.
    const noCaption = await runScript(
      "skills/send-file/scripts/send-file.ts",
      [
        "--session-id",
        "sess_own",
        "--api-url",
        api.url,
        "--file-paths",
        "output/chart.png",
        "--file-paths",
        "output/data.json",
      ],
      ws,
    );
    assertEquals(noCaption.code, 0, noCaption.stderr);
    assertEquals(api.requests[0].skillName, "send-file");
    assertEquals(api.requests[0].parameters.filePaths, [
      "output/chart.png",
      "output/data.json",
    ]);
    assertEquals("caption" in api.requests[0].parameters, false);

    // Short alias -f collects multiple files too.
    const aliasRun = await runScript(
      "skills/send-file/scripts/send-file.ts",
      ["--session-id", "sess_own", "--api-url", api.url, "-f", "a.png", "-f", "b.png"],
      ws,
    );
    assertEquals(aliasRun.code, 0, aliasRun.stderr);
    assertEquals(api.requests[1].parameters.filePaths, ["a.png", "b.png"]);

    // With caption via payload file alongside multi-file.
    const captionPayload = join(ws, "tmp", "sess_own", "caption.md");
    Deno.writeTextFileSync(captionPayload, "chart $0.435 caption");
    const withCaption = await runScript(
      "skills/send-file/scripts/send-file.ts",
      [
        "--session-id",
        "sess_own",
        "--api-url",
        api.url,
        "--file-paths",
        "x.png",
        "--file-paths",
        "y.png",
        "--caption-file",
        captionPayload,
      ],
      ws,
    );
    assertEquals(withCaption.code, 0, withCaption.stderr);
    assertEquals(api.requests[2].parameters.filePaths, ["x.png", "y.png"]);
    assertEquals(api.requests[2].parameters.caption, "chart $0.435 caption");
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - send-file missing --file-paths rejected, API never hit", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const result = await runScript(
      "skills/send-file/scripts/send-file.ts",
      ["--session-id", "sess_own", "--api-url", api.url],
      ws,
    );
    assertEquals(result.code !== 0, true);
    const err = parseStderrJson(result.stderr);
    assertStringIncludes(String(err.error ?? ""), "--file-paths");
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - singular --file-path rejected with SKILL_SINGLE_FILE_FLAG in both forms, API never hit", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    for (
      const legacyArgs of [
        ["--file-path", "report.pdf"],
        ["--file-path=report.pdf"],
      ]
    ) {
      const result = await runScript(
        "skills/send-file/scripts/send-file.ts",
        ["--session-id", "sess_own", "--api-url", api.url, ...legacyArgs],
        ws,
      );

      assertEquals(result.code !== 0, true);
      const err = parseStderrJson(result.stderr);
      assertEquals(err.code, "SKILL_SINGLE_FILE_FLAG");
      const message = String(err.error ?? "");
      assertStringIncludes(message, "repeatable");
      assertStringIncludes(message, "--file-paths");
      assertStringIncludes(message, '--file-paths "exports/report.pdf"');
    }
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - mixed singular and plural file flags rejected, API never hit", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const result = await runScript(
      "skills/send-file/scripts/send-file.ts",
      [
        "--session-id",
        "sess_own",
        "--api-url",
        api.url,
        "--file-path",
        "a.png",
        "--file-paths",
        "b.png",
      ],
      ws,
    );
    assertEquals(result.code !== 0, true);
    const err = parseStderrJson(result.stderr);
    assertEquals(err.code, "SKILL_SINGLE_FILE_FLAG");
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - send-file out-of-bounds caption payload still rejected", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    Deno.writeTextFileSync(join(ws, "memory.private.jsonl"), "{}");

    const result = await runScript(
      "skills/send-file/scripts/send-file.ts",
      [
        "--session-id",
        "sess_own",
        "--api-url",
        api.url,
        "--file-paths",
        "a.png",
        "--caption-file",
        join(ws, "memory.private.jsonl"),
      ],
      ws,
    );
    assertEquals(result.code !== 0, true);
    const err = parseStderrJson(result.stderr);
    assertEquals(err.code, "SKILL_PAYLOAD_OUT_OF_BOUNDS");
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - legacy --message flag rejected in both forms, API never hit", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    for (
      const legacyArgs of [
        ["--message", "定價 $0.435"],
        ["--message=定價"],
      ]
    ) {
      const result = await runScript(
        SEND_REPLY,
        ["--session-id", "sess_own", "--api-url", api.url, ...legacyArgs],
        ws,
      );

      assertEquals(result.code !== 0, true);
      const err = parseStderrJson(result.stderr);
      assertEquals(err.code, "SKILL_LEGACY_FLAG");
      const message = String(err.error ?? "");
      assertStringIncludes(message, "expanded by the shell");
      assertStringIncludes(message, "--message-file");
      assertStringIncludes(message, "$TMPDIR/$SESSION_ID");
    }
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - payload outside session staging dir rejected (workspace root / sibling / symlink)", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    Deno.writeTextFileSync(join(ws, "memory.private.jsonl"), "{}");
    Deno.writeTextFileSync(join(ws, "tmp", "sess_other", "reply.md"), "other session");
    Deno.symlinkSync("/etc/passwd", join(ws, "tmp", "sess_own", "leak.md"));

    const payloads = [
      join(ws, "memory.private.jsonl"),
      join(ws, "tmp", "sess_other", "reply.md"),
      join(ws, "tmp", "sess_own", "leak.md"),
    ];

    for (const payload of payloads) {
      const result = await runScript(
        SEND_REPLY,
        ["--session-id", "sess_own", "--api-url", api.url, "--message-file", payload],
        ws,
      );
      assertEquals(result.code !== 0, true, `must fail: ${payload}`);
      const err = parseStderrJson(result.stderr);
      assertEquals(err.code, "SKILL_PAYLOAD_OUT_OF_BOUNDS", result.stderr);
      assertStringIncludes(String(err.error ?? ""), "session staging directory");
    }
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - missing payload file rejected with SKILL_PAYLOAD_NOT_FOUND guidance", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const result = await runScript(
      SEND_REPLY,
      [
        "--session-id",
        "sess_own",
        "--api-url",
        api.url,
        "--message-file",
        join(ws, "tmp", "sess_own", "absent.md"),
      ],
      ws,
    );

    assertEquals(result.code !== 0, true);
    const err = parseStderrJson(result.stderr);
    assertEquals(err.code, "SKILL_PAYLOAD_NOT_FOUND");
    assertStringIncludes(String(err.error ?? ""), "written FIRST");
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("scripts - missing required payload flag rejected with SKILL_MISSING_PAYLOAD guidance", async () => {
  const ws = setupWorkspace();
  const api = startMockApi();
  try {
    const result = await runScript(
      SEND_REPLY,
      ["--session-id", "sess_own", "--api-url", api.url],
      ws,
    );

    assertEquals(result.code !== 0, true);
    const err = parseStderrJson(result.stderr);
    assertEquals(err.code, "SKILL_MISSING_PAYLOAD");
    assertStringIncludes(String(err.error ?? ""), "--message-file");
    assertEquals(api.requests.length, 0);
  } finally {
    await api.close();
    Deno.removeSync(ws, { recursive: true });
  }
});
