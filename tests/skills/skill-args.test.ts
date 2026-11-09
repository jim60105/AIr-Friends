// Argument-parsing parity tests for the built-in skill scripts.
//
// Every script exports a pure `parse<Name>Args(argv)` function; these tables
// pin the values the previous `@std/flags` `parse` produced for aliases,
// defaults, repeated and numeric flags. The three delta-spec scenarios are at
// the bottom (alias/default, numeric flag, missing required flag).

import { assertEquals } from "@std/assert";
import { test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCancelReminderArgs } from "../../skills/cancel-reminder/scripts/cancel-reminder.ts";
import { parseEditReplyArgs } from "../../skills/edit-reply/scripts/edit-reply.ts";
import { parseFetchContextArgs } from "../../skills/fetch-context/scripts/fetch-context.ts";
import { parseGetMessageArgs } from "../../skills/get-message/scripts/get-message.ts";
import { parseListRemindersArgs } from "../../skills/list-reminders/scripts/list-reminders.ts";
import { parseMemoryExportArgs } from "../../skills/memory-export/scripts/memory-export.ts";
import { parseMemoryPatchArgs } from "../../skills/memory-patch/scripts/memory-patch.ts";
import { parseMemorySaveArgs } from "../../skills/memory-save/scripts/memory-save.ts";
import { parseMemorySearchArgs } from "../../skills/memory-search/scripts/memory-search.ts";
import { parseMemoryStatsArgs } from "../../skills/memory-stats/scripts/memory-stats.ts";
import { parseReactMessageArgs } from "../../skills/react-message/scripts/react-message.ts";
import { parseSendEmailArgs } from "../../skills/send-email/scripts/send-email.ts";
import { parseSendFileArgs } from "../../skills/send-file/scripts/send-file.ts";
import { parseSendReplyArgs } from "../../skills/send-reply/scripts/send-reply.ts";
import { parseSetReminderArgs } from "../../skills/set-reminder/scripts/set-reminder.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("skill args - cancel-reminder: aliases and reminder id", () => {
  const parsed = parseCancelReminderArgs([
    "-s",
    "sess_1",
    "-a",
    "http://localhost:3001",
    "--reminder-id",
    "rem_1",
  ]);
  assertEquals(parsed.sessionId, "sess_1");
  assertEquals(parsed.apiUrl, "http://localhost:3001");
  assertEquals(parsed.reminderId, "rem_1");

  const empty = parseCancelReminderArgs([]);
  assertEquals(empty.sessionId, undefined);
  assertEquals(empty.reminderId, undefined);
});

test("skill args - edit-reply: aliases and message id", () => {
  const parsed = parseEditReplyArgs(["-s", "sess_1", "--message-id", "msg_1"]);
  assertEquals(parsed.sessionId, "sess_1");
  assertEquals(parsed.messageId, "msg_1");
  assertEquals(parsed.apiUrl, undefined);
});

test("skill args - fetch-context: type alias and numeric limit with default", () => {
  const withFlags = parseFetchContextArgs([
    "-s",
    "sess_1",
    "-t",
    "search_messages",
    "--limit",
    "5",
  ]);
  assertEquals(withFlags.type, "search_messages");
  assertEquals(withFlags.limit, 5);

  const defaults = parseFetchContextArgs(["-s", "sess_1", "--type", "recent_messages"]);
  assertEquals(defaults.limit, 20);

  const equalsForm = parseFetchContextArgs(["--type", "recent_messages", "--limit=7"]);
  assertEquals(equalsForm.limit, 7);
});

test("skill args - get-message: optional message id", () => {
  assertEquals(parseGetMessageArgs(["-s", "sess_1"]).messageId, undefined);
  assertEquals(
    parseGetMessageArgs(["-s", "sess_1", "--message-id", "msg_1"]).messageId,
    "msg_1",
  );
});

test("skill args - list-reminders: base aliases only", () => {
  const parsed = parseListRemindersArgs(["-s", "sess_1", "-a", "http://localhost:3002"]);
  assertEquals(parsed.sessionId, "sess_1");
  assertEquals(parsed.apiUrl, "http://localhost:3002");
});

test("skill args - memory-export: format alias, defaults and boolean negation", () => {
  const defaults = parseMemoryExportArgs(["-s", "sess_1"]);
  assertEquals(defaults.format, "markdown");
  assertEquals(defaults.importance, "all");
  assertEquals(defaults.enabledOnly, true);

  const explicit = parseMemoryExportArgs([
    "-s",
    "sess_1",
    "-f",
    "json",
    "--importance",
    "high",
    "--no-enabled-only",
  ]);
  assertEquals(explicit.format, "json");
  assertEquals(explicit.importance, "high");
  assertEquals(explicit.enabledOnly, false);

  assertEquals(
    parseMemoryExportArgs(["--enabled-only=false"]).enabledOnly,
    false,
  );
});

test("skill args - memory-patch: aliases, booleans, numeric decay and lists", () => {
  const parsed = parseMemoryPatchArgs([
    "-s",
    "sess_1",
    "-m",
    "mem_1",
    "--enabled",
    "--visibility",
    "public",
    "--importance",
    "high",
    "--tier",
    "core",
    "--category",
    "fact",
    "--scope",
    "user",
    "--decay",
    "0.5",
    "--related-to",
    "a,b",
    "--supersedes",
    "c",
  ]);
  assertEquals(parsed.memoryId, "mem_1");
  assertEquals(parsed.enabled, true);
  assertEquals(parsed.disabled, false);
  assertEquals(parsed.visibility, "public");
  assertEquals(parsed.importance, "high");
  assertEquals(parsed.tier, "core");
  assertEquals(parsed.category, "fact");
  assertEquals(parsed.scope, "user");
  assertEquals(parsed.decay, 0.5);
  assertEquals(parsed.relatedTo, "a,b");
  assertEquals(parsed.supersedes, "c");

  const disabled = parseMemoryPatchArgs(["-s", "sess_1", "-m", "mem_1", "--disabled"]);
  assertEquals(disabled.enabled, false);
  assertEquals(disabled.disabled, true);
  assertEquals(disabled.decay, undefined);
});

test("skill args - memory-save: importance alias, default and numeric decay", () => {
  const parsed = parseMemorySaveArgs([
    "-s",
    "sess_1",
    "-i",
    "high",
    "--decay",
    "0.25",
    "--related-to",
    "x,y",
    "--supersedes",
    "z",
  ]);
  assertEquals(parsed.importance, "high");
  assertEquals(parsed.decay, 0.25);
  assertEquals(parsed.relatedTo, "x,y");
  assertEquals(parsed.supersedes, "z");

  const defaults = parseMemorySaveArgs(["-s", "sess_1"]);
  assertEquals(defaults.importance, "normal");
  assertEquals(defaults.decay, undefined);
});

test("skill args - memory-search: aliases, category/scope and numeric limit", () => {
  const parsed = parseMemorySearchArgs([
    "-s",
    "sess_1",
    "--category",
    "fact",
    "--scope",
    "channel",
    "--limit",
    "3",
  ]);
  assertEquals(parsed.sessionId, "sess_1");
  assertEquals(parsed.category, "fact");
  assertEquals(parsed.scope, "channel");
  assertEquals(parsed.limit, 3);
  assertEquals(parseMemorySearchArgs(["--limit", "5"]).limit, 5);
  assertEquals(parseMemorySearchArgs([]).limit, 10);
});

test("skill args - memory-stats and send-reply: base aliases only", () => {
  assertEquals(parseMemoryStatsArgs(["-s", "sess_1"]).sessionId, "sess_1");
  assertEquals(
    parseSendReplyArgs(["-s", "sess_1", "-a", "http://localhost:3005"]).apiUrl,
    "http://localhost:3005",
  );
});

test("skill args - react-message: emoji alias", () => {
  assertEquals(parseReactMessageArgs(["-s", "sess_1", "-e", "👍"]).emoji, "👍");
  assertEquals(parseReactMessageArgs(["--emoji", "🎉"]).emoji, "🎉");
});

test("skill args - send-email: grant id alias", () => {
  const parsed = parseSendEmailArgs(["-s", "sess_1", "-g", "grant-7"]);
  assertEquals(parsed.grantId, "grant-7");
  assertEquals(parseSendEmailArgs(["--grant-id", "grant-8"]).grantId, "grant-8");
});

test("skill args - send-file: repeatable file paths, equals form and short alias", () => {
  assertEquals(
    parseSendFileArgs(["-s", "sess_1", "-f", "a.png", "-f", "b.png"]).filePaths,
    ["a.png", "b.png"],
  );
  assertEquals(
    parseSendFileArgs([
      "-s",
      "sess_1",
      "--file-paths",
      "a.png",
      "--file-paths",
      "b.png",
    ]).filePaths,
    ["a.png", "b.png"],
  );
  assertEquals(parseSendFileArgs(["--file-paths=c.png"]).filePaths, ["c.png"]);
  assertEquals(parseSendFileArgs(["-s", "sess_1"]).filePaths, undefined);
});

test("skill args - set-reminder: aliases and scheduled time", () => {
  const parsed = parseSetReminderArgs([
    "-s",
    "sess_1",
    "--scheduled-at",
    "2025-01-15T10:00:00Z",
  ]);
  assertEquals(parsed.sessionId, "sess_1");
  assertEquals(parsed.scheduledAt, "2025-01-15T10:00:00Z");
});

// ---------------------------------------------------------------------------
// Delta-spec scenarios: Skill Argument Parsing Matches The Previous Parser.
// ---------------------------------------------------------------------------

test("skill args - alias and default: -s abc --query-file q.txt gives sessionId abc and limit 10", () => {
  const parsed = parseMemorySearchArgs(["-s", "abc", "--query-file", "q.txt"]);
  assertEquals(parsed.sessionId, "abc");
  assertEquals(parsed.limit, 10);
  assertEquals(typeof parsed.limit, "number");
});

test("skill args - numeric flag: --limit 5 gives the number 5", () => {
  const parsed = parseMemorySearchArgs(["--limit", "5"]);
  assertEquals(parsed.limit, 5);
  assertEquals(typeof parsed.limit, "number");
});

test("skill args - missing required flag: no --session-id and no pointer exits non-zero before any HTTP request", () => {
  const script = fileURLToPath(
    new URL("../../skills/send-reply/scripts/send-reply.ts", import.meta.url),
  );
  const output = spawnSync(script, [], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "/tmp",
    },
  });
  assertEquals(output.status !== 0, true, output.stderr);
});
