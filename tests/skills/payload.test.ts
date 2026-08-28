// Unit tests for skills/lib/payload.ts — payload-file resolution, session-scoped
// containment, and instructive error codes.

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  isWithinDir,
  LEGACY_FREE_TEXT_FLAG_PATTERN,
  PayloadError,
  readPayloadArg,
  resolvePayloadPath,
} from "../../skills/lib/payload.ts";

const EXAMPLE =
  'send-reply.ts --session-id "$SESSION_ID" --message-file "$TMPDIR/$SESSION_ID/reply.md"';

interface PayloadOpts {
  sessionId: string;
  example: string;
  fileName: string;
  alias?: string;
  required?: boolean;
  cwd?: string;
}

function opts(
  cwd: string,
  sessionId = "sess_own",
  overrides: Partial<PayloadOpts> = {},
): PayloadOpts {
  return {
    sessionId,
    example: EXAMPLE,
    fileName: "reply.md",
    cwd,
    ...overrides,
  };
}

function setupWorkspace(): string {
  const ws = Deno.makeTempDirSync();
  Deno.mkdirSync(join(ws, "tmp", "sess_own"), { recursive: true });
  Deno.mkdirSync(join(ws, "tmp", "sess_other"), { recursive: true });
  Deno.mkdirSync(join(ws, "tmp", "sess_own-2"), { recursive: true });
  Deno.mkdirSync(join(ws, "tmp", "sess_own2"), { recursive: true });
  return ws;
}

/** Assert that the fn (sync or async) rejects with a PayloadError carrying `code` and guidance substrings. */
async function expectPayloadError(
  fn: () => unknown,
  code: string,
  ...substrings: string[]
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof PayloadError)) throw err;
    assertEquals(err.code, code);
    for (const s of substrings) {
      assertEquals(err.message.includes(s), true, `guidance should include: ${s}`);
    }
    return;
  }
  throw new Error(`Expected PayloadError ${code} but no error was raised`);
}

const RESOLVE_OPTS = {
  flagName: "message",
  example: EXAMPLE,
  fileName: "reply.md",
};

// resolvePayloadBase reads process env (TMPDIR/SKILL_JWT_DIR). These env vars
// are process-global and shared with test files running in parallel workers
// (e.g. lib-client.test.ts), so all env-sensitive cases run in an isolated
// subprocess instead of mutating the global env.
Deno.test("resolvePayloadBase - fallback, pointer staging, and TMPDIR-ignored (subprocess)", async () => {
  const jwtDir = Deno.makeTempDirSync();
  const payloadUrl = new URL("../../skills/lib/payload.ts", import.meta.url).href;
  const script = `
import { resolvePayloadBase } from ${JSON.stringify(payloadUrl)};
const jwtDir = Deno.env.get("SKILL_JWT_DIR");
const results = [];
// 1. Pointer names this session: staging root from the pointer is used.
Deno.writeTextFileSync(jwtDir + "/active.json", JSON.stringify({ sessionId: "sess_1", staging: "/ws/discord/123/tmp" }));
results.push(resolvePayloadBase("/agent-cwd", "sess_1"));
// 2. Pointer names ANOTHER session (stale/foreign): fall back to {cwd}/tmp.
Deno.writeTextFileSync(jwtDir + "/active.json", JSON.stringify({ sessionId: "sess_other", staging: "/ws/discord/999/tmp" }));
results.push(resolvePayloadBase("/agent-cwd", "sess_1"));
// 3. No staging field: fall back too.
Deno.writeTextFileSync(jwtDir + "/active.json", JSON.stringify({ sessionId: "sess_1" }));
results.push(resolvePayloadBase("/agent-cwd", "sess_1"));
// 4. No pointer file at all: fall back.
Deno.removeSync(jwtDir + "/active.json");
results.push(resolvePayloadBase("/ws", "sess_1"));
results.push(resolvePayloadBase("/ws", ""));
console.log(JSON.stringify(results));
`;
  const scriptPath = `${jwtDir}/probe.ts`;
  await Deno.writeTextFile(scriptPath, script);

  const baseEnv = Deno.env.toObject();
  const env: Record<string, string> = {
    TMPDIR: "/data/channel-tmp/discord:discord/456", // must be IGNORED
    SKILL_JWT_DIR: jwtDir,
  };
  for (const k of ["PATH", "HOME", "DENO_DIR", "XDG_CACHE_HOME", "DENO_INSTALL_ROOT"]) {
    if (baseEnv[k] !== undefined) env[k] = baseEnv[k];
  }

  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-check", "--allow-read", "--allow-write", "--allow-env", scriptPath],
    env,
    clearEnv: true,
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, `child failed: ${stdout}${new TextDecoder().decode(output.stderr)}`);
  const results = JSON.parse(stdout.trim().split("\n").at(-1)!) as string[];

  assertEquals(results[0], resolve("/ws/discord/123/tmp/sess_1"));
  assertEquals(results[1], resolve("/agent-cwd/tmp/sess_1"));
  assertEquals(results[2], resolve("/agent-cwd/tmp/sess_1"));
  assertEquals(results[3], resolve("/ws/tmp/sess_1"));
  assertEquals(results[4], resolve("/ws/tmp"));

  await Deno.remove(jwtDir, { recursive: true });
});

// Shared-process mode (SKILL_SHARED_PROCESS=1): the staging base comes ONLY
// from the current-session pointer; no CLI-argument fallback exists, and a
// missing/unreadable/malformed pointer fails with SKILL_SESSION_UNRESOLVED
// BEFORE any payload file is read or deleted. Runs in a subprocess so the env
// marker cannot leak into parallel test files.
Deno.test("resolvePayloadBase - shared mode: pointer-only base, unresolved pointer fails before touching files (subprocess)", async () => {
  const jwtDir = Deno.makeTempDirSync();
  const ws = Deno.makeTempDirSync();
  const payloadUrl = new URL("../../skills/lib/payload.ts", import.meta.url).href;
  const script = `
import { readPayloadArg, resolvePayloadBase } from ${JSON.stringify(payloadUrl)};
const jwtDir = Deno.env.get("SKILL_JWT_DIR");
const ws = Deno.args[0];
const results = [];
// (a) Valid pointer {sessionId:"sess_B", staging: ws/tmp} + CLI arg sess_A:
//     the base is the POINTER's session, never the CLI argument's.
Deno.writeTextFileSync(jwtDir + "/active.json", JSON.stringify({ sessionId: "sess_B", staging: ws + "/tmp" }));
results.push(resolvePayloadBase(ws, "sess_A"));
// (b) No pointer at all: shared mode MUST fail SKILL_SESSION_UNRESOLVED.
Deno.removeSync(jwtDir + "/active.json");
try {
  resolvePayloadBase(ws, "sess_A");
  results.push("NO_ERROR");
} catch (err) {
  results.push(JSON.stringify({ code: err.code, message: err.message }));
}
// (b2) readPayloadArg in shared mode with no pointer: fails with the same
//      code BEFORE reading or deleting the referenced payload file.
const staged = ws + "/tmp/sess_other/reply.md";
Deno.mkdirSync(ws + "/tmp/sess_other", { recursive: true });
Deno.writeTextFileSync(staged, "sibling session payload");
try {
  await readPayloadArg(
    ["--message-file", staged],
    "message",
    { sessionId: "sess_A", example: "x", fileName: "reply.md", cwd: ws },
  );
  results.push("NO_ERROR");
} catch (err) {
  results.push(JSON.stringify({ code: err.code }));
}
let exists = true;
try { Deno.statSync(staged); } catch { exists = false; }
results.push("exists=" + exists);
// (c) Malformed pointers in shared mode: non-string fields and relative
//     staging all fail with the SAME stable code (strict schema validation).
for (const pointer of [
  { sessionId: 42, staging: ws + "/tmp" },
  { sessionId: "sess_B", staging: {} },
  { sessionId: "sess_B", staging: "relative/tmp" },
  { sessionId: "" , staging: ws + "/tmp" },
]) {
  Deno.writeTextFileSync(jwtDir + "/active.json", JSON.stringify(pointer));
  try {
    resolvePayloadBase(ws, "sess_A");
    results.push("NO_ERROR");
  } catch (err) {
    results.push(JSON.stringify({ code: err.code }));
  }
}
console.log(JSON.stringify(results));
`;
  const scriptPath = `${jwtDir}/probe.ts`;
  await Deno.writeTextFile(scriptPath, script);

  const baseEnv = Deno.env.toObject();
  const env: Record<string, string> = {
    SKILL_SHARED_PROCESS: "1",
    SKILL_JWT_DIR: jwtDir,
  };
  for (const k of ["PATH", "HOME", "DENO_DIR", "XDG_CACHE_HOME", "DENO_INSTALL_ROOT"]) {
    if (baseEnv[k] !== undefined) env[k] = baseEnv[k];
  }

  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-check", "--allow-read", "--allow-write", "--allow-env", scriptPath, ws],
    env,
    clearEnv: true,
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, `child failed: ${stdout}${new TextDecoder().decode(output.stderr)}`);
  const results = JSON.parse(stdout.trim().split("\n").at(-1)!) as string[];

  // (a) pointer's session wins over the CLI argument.
  assertEquals(results[0], resolve(join(ws, "tmp", "sess_B")));
  // (b) unresolved pointer fails with the stable code + pointer path guidance.
  const err = JSON.parse(results[1]) as { code: string; message: string };
  assertEquals(err.code, "SKILL_SESSION_UNRESOLVED");
  assertEquals(err.message.includes(`${jwtDir}/active.json`), true);
  assertEquals(err.message.includes("SKILL_SESSION_UNRESOLVED"), true);
  // (b2) same code from readPayloadArg, and the payload file was NOT read or
  // deleted (no read-and-delete side effect before the identity is resolved).
  assertEquals(JSON.parse(results[2]).code, "SKILL_SESSION_UNRESOLVED");
  assertEquals(results[3], "exists=true");
  // (c) every malformed pointer variant fails with the same stable code.
  for (let i = 4; i < results.length; i++) {
    const r = JSON.parse(results[i]) as { code: string };
    assertEquals(r.code, "SKILL_SESSION_UNRESOLVED", `malformed pointer case ${i - 4}`);
  }

  await Deno.remove(jwtDir, { recursive: true });
  await Deno.remove(ws, { recursive: true });
});

Deno.test("isWithinDir - boundary-safe sibling prefixes rejected", () => {
  assertEquals(isWithinDir("/ws/tmp/sess_own/x", "/ws/tmp/sess_own"), true);
  assertEquals(isWithinDir("/ws/tmp/sess_own", "/ws/tmp/sess_own"), true);
  assertEquals(isWithinDir("/ws/tmp/sess_own-2/x", "/ws/tmp/sess_own"), false);
  assertEquals(isWithinDir("/ws/tmp/sess_own2/x", "/ws/tmp/sess_own"), false);
  assertEquals(isWithinDir("/ws/tmp/sess_other/x", "/ws/tmp/sess_own"), false);
  assertEquals(isWithinDir("/ws/tmp/x", "/ws/tmp/sess_own"), false);
});

Deno.test("resolvePayloadPath - own-session staging file accepted", () => {
  const ws = setupWorkspace();
  try {
    const target = join(ws, "tmp", "sess_own", "reply.md");
    Deno.writeTextFileSync(target, "hello $0 $HOME\nline2");
    const path = resolvePayloadPath(target, ws, "sess_own", {
      flagName: "message",
      example: EXAMPLE,
      fileName: "reply.md",
    });
    assertEquals(Deno.readTextFileSync(path), "hello $0 $HOME\nline2");
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - relative path resolves against cwd", () => {
  const ws = setupWorkspace();
  try {
    Deno.writeTextFileSync(join(ws, "tmp", "sess_own", "reply.md"), "relative ok");
    const path = resolvePayloadPath("tmp/sess_own/reply.md", ws, "sess_own", {
      flagName: "message",
      example: EXAMPLE,
      fileName: "reply.md",
    });
    assertEquals(path, join(ws, "tmp", "sess_own", "reply.md"));
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - workspace-root file rejected", async () => {
  const ws = setupWorkspace();
  try {
    Deno.writeTextFileSync(join(ws, "memory.private.jsonl"), "{}");
    for (const payload of ["memory.private.jsonl", join(ws, "memory.private.jsonl")]) {
      await expectPayloadError(
        () => resolvePayloadPath(payload, ws, "sess_own", RESOLVE_OPTS),
        "SKILL_PAYLOAD_OUT_OF_BOUNDS",
        "$TMPDIR/$SESSION_ID",
        "--message-file",
      );
    }
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - sibling session directory rejected", async () => {
  const ws = setupWorkspace();
  try {
    Deno.writeTextFileSync(join(ws, "tmp", "sess_other", "reply.md"), "other");
    await expectPayloadError(
      () =>
        resolvePayloadPath(join(ws, "tmp", "sess_other", "reply.md"), ws, "sess_own", RESOLVE_OPTS),
      "SKILL_PAYLOAD_OUT_OF_BOUNDS",
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - prefix-sibling directories rejected", async () => {
  const ws = setupWorkspace();
  try {
    for (const sibling of ["sess_own-2", "sess_own2"]) {
      Deno.writeTextFileSync(join(ws, "tmp", sibling, "reply.md"), "sibling");
      await expectPayloadError(
        () =>
          resolvePayloadPath(join(ws, "tmp", sibling, "reply.md"), ws, "sess_own", RESOLVE_OPTS),
        "SKILL_PAYLOAD_OUT_OF_BOUNDS",
      );
    }
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - home-anchored and absolute paths rejected", async () => {
  const ws = setupWorkspace();
  try {
    for (const payload of ["~/.git-credentials", "$HOME/.env", "/etc/passwd"]) {
      await expectPayloadError(
        () => resolvePayloadPath(payload, ws, "sess_own", RESOLVE_OPTS),
        "SKILL_PAYLOAD_OUT_OF_BOUNDS",
      );
    }
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - symlink escape rejected", async () => {
  const ws = setupWorkspace();
  try {
    Deno.symlinkSync("/etc/passwd", join(ws, "tmp", "sess_own", "leak.md"));
    await expectPayloadError(
      () =>
        resolvePayloadPath(join(ws, "tmp", "sess_own", "leak.md"), ws, "sess_own", RESOLVE_OPTS),
      "SKILL_PAYLOAD_OUT_OF_BOUNDS",
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - symlink within staging directory allowed", () => {
  const ws = setupWorkspace();
  try {
    Deno.writeTextFileSync(join(ws, "tmp", "sess_own", "real.md"), "real content");
    Deno.symlinkSync(
      join(ws, "tmp", "sess_own", "real.md"),
      join(ws, "tmp", "sess_own", "link.md"),
    );
    const path = resolvePayloadPath(join(ws, "tmp", "sess_own", "link.md"), ws, "sess_own", {
      flagName: "message",
      example: EXAMPLE,
      fileName: "reply.md",
    });
    assertEquals(Deno.readTextFileSync(path), "real content");
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("resolvePayloadPath - missing file raises SKILL_PAYLOAD_NOT_FOUND", async () => {
  const ws = setupWorkspace();
  try {
    await expectPayloadError(
      () =>
        resolvePayloadPath(
          join(ws, "tmp", "sess_own", "nonexistent.md"),
          ws,
          "sess_own",
          RESOLVE_OPTS,
        ),
      "SKILL_PAYLOAD_NOT_FOUND",
      "edit/write",
      "--message-file",
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - reads content verbatim ($, newlines, empty string)", async () => {
  const ws = setupWorkspace();
  try {
    const staged = join(ws, "tmp", "sess_own", "reply.md");
    Deno.writeTextFileSync(staged, "定價 $0.435\n$HOME line");
    const content = await readPayloadArg(
      ["--session-id", "sess_own", "--message-file", staged],
      "message",
      opts(ws),
    );
    assertEquals(content, "定價 $0.435\n$HOME line");
    // Best-effort deletion after successful read.
    let removed = true;
    try {
      Deno.statSync(staged);
      removed = false;
    } catch {
      // expected: file gone
    }
    assertEquals(removed, true);

    // Empty file content is preserved verbatim.
    const empty = join(ws, "tmp", "sess_own", "empty.md");
    Deno.writeTextFileSync(empty, "");
    const emptyContent = await readPayloadArg(
      ["--message-file", empty],
      "message",
      opts(ws),
    );
    assertEquals(emptyContent, "");
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - supports --flag=value and short alias forms", async () => {
  const ws = setupWorkspace();
  try {
    const staged = join(ws, "tmp", "sess_own", "reply.md");
    Deno.writeTextFileSync(staged, "equals form");
    assertEquals(
      await readPayloadArg([`--message-file=${staged}`], "message", opts(ws)),
      "equals form",
    );
    Deno.writeTextFileSync(staged, "alias form");
    assertEquals(
      await readPayloadArg(["-m", staged], "message", opts(ws, "sess_own", { alias: "m" })),
      "alias form",
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - legacy flags rejected in both forms", async () => {
  const ws = setupWorkspace();
  try {
    const cases: Array<[string[], string]> = [
      [["--message", "定價 $0.435"], "--message"],
      [["--message=定價"], "--message=定價"],
      [["--content", "memory text"], "--content"],
      [["--content=memory"], "--content"],
      [["--query", "search"], "--query"],
      [["--query=search"], "--query"],
      [["--caption", "cap"], "--caption"],
      [["--caption=cap"], "--caption"],
    ];
    for (const [args, flag] of cases) {
      await expectPayloadError(
        () => readPayloadArg(args, flag.replace("--", "").split("=")[0], opts(ws)),
        "SKILL_LEGACY_FLAG",
        "expanded by the shell",
        "--message-file",
      );
    }
    // Distinct tokens are NOT rejected by the legacy pattern.
    assertEquals(LEGACY_FREE_TEXT_FLAG_PATTERN.test("--message-id"), false);
    assertEquals(LEGACY_FREE_TEXT_FLAG_PATTERN.test("--message-file"), false);
    assertEquals(LEGACY_FREE_TEXT_FLAG_PATTERN.test("--content-file"), false);
    assertEquals(LEGACY_FREE_TEXT_FLAG_PATTERN.test("--query-file"), false);
    assertEquals(LEGACY_FREE_TEXT_FLAG_PATTERN.test("--caption-file"), false);
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - missing required flag names it and shows the flow", async () => {
  const ws = setupWorkspace();
  try {
    await expectPayloadError(
      () => readPayloadArg(["--session-id", "sess_own"], "message", opts(ws)),
      "SKILL_MISSING_PAYLOAD",
      "--message-file",
      "$TMPDIR/$SESSION_ID",
      EXAMPLE,
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - optional payload omitted returns undefined", async () => {
  const ws = setupWorkspace();
  try {
    const content = await readPayloadArg(
      ["--session-id", "sess_own", "--type", "recent_messages"],
      "query",
      opts(ws, "sess_own", { required: false, fileName: "query.md" }),
    );
    assertEquals(content, undefined);
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - out-of-bounds payload raises SKILL_PAYLOAD_OUT_OF_BOUNDS with guidance", async () => {
  const ws = setupWorkspace();
  try {
    Deno.writeTextFileSync(join(ws, "memory.private.jsonl"), "{}");
    await expectPayloadError(
      () => readPayloadArg(["--message-file", "memory.private.jsonl"], "message", opts(ws)),
      "SKILL_PAYLOAD_OUT_OF_BOUNDS",
      "session staging directory",
      "--message-file",
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});

Deno.test("readPayloadArg - missing payload file raises SKILL_PAYLOAD_NOT_FOUND", async () => {
  const ws = setupWorkspace();
  try {
    await expectPayloadError(
      () =>
        readPayloadArg(
          ["--message-file", join(ws, "tmp", "sess_own", "absent.md")],
          "message",
          opts(ws),
        ),
      "SKILL_PAYLOAD_NOT_FOUND",
      "written FIRST",
    );
  } finally {
    Deno.removeSync(ws, { recursive: true });
  }
});
