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
): Promise<RunResult> {
  const scriptPath = join(REPO_ROOT, scriptRelPath);
  const output = await new Deno.Command(scriptPath, { args, cwd }).output();
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
