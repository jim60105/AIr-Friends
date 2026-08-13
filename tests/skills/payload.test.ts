// Unit tests for skills/lib/payload.ts — payload-file resolution, session-scoped
// containment, and instructive error codes.

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  isWithinDir,
  LEGACY_FREE_TEXT_FLAG_PATTERN,
  PayloadError,
  readPayloadArg,
  resolvePayloadBase,
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

Deno.test("resolvePayloadBase - session-scoped and fallback", () => {
  assertEquals(resolvePayloadBase("/ws", "sess_1"), resolve("/ws/tmp/sess_1"));
  assertEquals(resolvePayloadBase("/ws", ""), resolve("/ws/tmp"));
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
