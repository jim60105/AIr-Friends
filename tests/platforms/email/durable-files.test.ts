// tests/platforms/email/durable-files.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import {
  appendDurable,
  assertSafePath,
  canonicalizeRoot,
  computeCrc32Hex,
  DurableDiagnosticCode,
  DurableFileError,
  ensureDurableDir,
  JOURNAL_ENVELOPE_VERSION,
  readJournal,
  replaceSnapshot,
} from "../../../src/platforms/email/durable-files.ts";

Deno.test("computeCrc32Hex - standard IEEE 802.3 CRC32", () => {
  const data = new TextEncoder().encode("Hello World");
  const crc = computeCrc32Hex(data);
  assertEquals(crc.length, 8);
  assertEquals(crc, "4a17b156");
});

Deno.test("readJournal and appendDurable - private sentinel data never leaks into diagnostics", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";
    const fullPath = resolve(root, relPath);

    const privateSentinel = "SUPER_SECRET_PRIVATE_TOKEN_XYZ_12345";
    // Intentionally construct corrupt interior record containing the private sentinel
    const corruptLine = new TextEncoder().encode(
      `{"v":1,"seq":1,"data":{"secret":"${privateSentinel}"},"broken_syntax\n`,
    );
    const validLine = new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        seq: 2,
        data: { text: "after" },
        crc32: computeCrc32Hex(new TextEncoder().encode(JSON.stringify({ text: "after" }))),
      }) + "\n",
    );
    const file = await Deno.open(fullPath, { create: true, write: true });
    await file.write(corruptLine);
    await file.write(validLine);
    file.close();

    const res = await readJournal(root, relPath);
    assertEquals(res.status, "corrupt");
    // Assert message, diagnostic code, and fields NEVER contain the private sentinel
    assertEquals(res.message.includes(privateSentinel), false);
    assertEquals(JSON.stringify(res).includes(privateSentinel), false);

    // Assert append refusal error also never contains private sentinel
    try {
      await appendDurable(root, relPath, { text: "after" });
    } catch (err) {
      if (err instanceof DurableFileError) {
        assertEquals(err.message.includes(privateSentinel), false);
        assertEquals(JSON.stringify(err.toJSON()).includes(privateSentinel), false);
      } else {
        throw err;
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - allowMissing option enforcement", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "missing.jsonl";

    // Default allows missing -> returns clean empty
    const res = await readJournal(root, relPath);
    assertEquals(res.status, "clean");
    assertEquals(res.records, []);

    // Explicit allowMissing: false -> throws DurableFileError
    await assertRejects(
      () => readJournal(root, relPath, { allowMissing: false }),
      DurableFileError,
      "[JOURNAL_NOT_FOUND]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("appendDurable - writer limits enforcement (maxRecordBytes and maxJournalBytes)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "limits.jsonl";

    // Small record limit
    await assertRejects(
      () =>
        appendDurable(root, relPath, { large: "x".repeat(200) }, {
          maxRecordBytes: 100,
        }),
      DurableFileError,
      "[JOURNAL_LIMIT_EXCEEDED]",
    );

    // Normal record passes
    await appendDurable(root, relPath, { a: 1 }, { maxJournalBytes: 500 });

    // Second write exceeds total journal limit
    await assertRejects(
      () =>
        appendDurable(root, relPath, { b: "y".repeat(450) }, {
          maxJournalBytes: 300,
        }),
      DurableFileError,
      "[JOURNAL_LIMIT_EXCEEDED]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("replaceSnapshot - rejects undefined/unserializable snapshot before replacing file", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "snapshot.json";

    // Initial valid snapshot
    await replaceSnapshot(root, relPath, { initial: true });

    // Attempt replacing with undefined or function
    await assertRejects(
      () => replaceSnapshot(root, relPath, undefined as unknown as Record<string, unknown>),
      DurableFileError,
      "[WRITE_FAILED]",
    );

    // Original snapshot is untouched
    const content = JSON.parse(await Deno.readTextFile(resolve(root, relPath)));
    assertEquals(content, { initial: true });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("canonicalizeRoot rejects missing root beneath symlink ancestor", async () => {
  if (Deno.build.os === "windows") return;
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  const outsideDir = await Deno.makeTempDir({ prefix: "email-outside-" });
  try {
    const symlinkAncestor = resolve(tempDir, "link_ancestor");
    await Deno.symlink(outsideDir, symlinkAncestor);

    // root is a missing directory beneath the symlink ancestor
    const missingRootBeneathSymlink = resolve(symlinkAncestor, "missing-root");

    await assertRejects(
      () => canonicalizeRoot(missingRootBeneathSymlink),
      DurableFileError,
      "[SYMLINK_NOT_PERMITTED]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(outsideDir, { recursive: true });
  }
});

Deno.test("serialization failure does not leak private contents into context or message", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const privateSentinel = "SUPER_SECRET_PAYLOAD_LEAK_TEST_999";
    const badObject: Record<string, unknown> = {
      secret: privateSentinel,
      toJSON: () => {
        throw new Error(`Explosion with private text: ${privateSentinel}`);
      },
    };

    try {
      await appendDurable(root, "fail.jsonl", badObject);
      throw new Error("Should have failed");
    } catch (err) {
      if (err instanceof DurableFileError) {
        assertEquals(err.message.includes(privateSentinel), false);
        const json = JSON.stringify(err.toJSON());
        assertEquals(json.includes(privateSentinel), false);
      } else {
        throw err;
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("injected I/O failure - directory sync failure prohibits external side effects", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    let externalSideEffectExecuted = false;

    // Pass an invalid path that cannot establish directory durability or fails write
    // (e.g. attempting to append through an existing regular file as a directory)
    const blockerFile = resolve(root, "blocker");
    await Deno.writeTextFile(blockerFile, "not a directory");

    await assertRejects(
      async () => {
        await appendDurable(root, "blocker/journal.jsonl", { intent: "send_mail" });
        externalSideEffectExecuted = true;
      },
      DurableFileError,
    );

    assertEquals(
      externalSideEffectExecuted,
      false,
      "External side effect must not execute when durability cannot be established",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("predecessor integration - canonical normalized mailbox identity with durable journal", async () => {
  // Consume predecessor row 01 normalizeEmailMailbox
  const { normalizeEmailMailbox } = await import(
    "../../../src/platforms/email/email-identity.ts"
  );
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const identity = normalizeEmailMailbox(" Alice.Smith+tag@Example.COM ");
    assertEquals(identity.canonicalAddress, "Alice.Smith+tag@example.com");
    assertEquals(identity.userId.startsWith("e_"), true);

    // User's journal path scoped by userId
    const relJournalPath = `users/${identity.userId}/journal.jsonl`;

    // Append durable transitions
    await appendDurable(root, relJournalPath, {
      action: "REGISTER_MAILBOX",
      address: identity.canonicalAddress,
    });

    const journal = await readJournal<{ action: string; address: string }>(root, relJournalPath);
    assertEquals(journal.status, "clean");
    assertEquals(journal.records.length, 1);
    assertEquals(journal.records[0].address, "Alice.Smith+tag@example.com");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("controlled writer crash point - torn record recovery", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-crash-" });
  try {
    const root = tempDir;
    const relPath = "crash.jsonl";

    // Subprocess writes valid record 1, then half of record 2 and abruptly exits with SIGKILL
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `
        import { appendDurable } from "./src/platforms/email/durable-files.ts";
        import { resolve } from "@std/path";
        await appendDurable(${JSON.stringify(root)}, ${JSON.stringify(relPath)}, { step: 1 });
        const fullPath = resolve(${JSON.stringify(root)}, ${JSON.stringify(relPath)});
        const file = await Deno.open(fullPath, { append: true });
        await file.write(new TextEncoder().encode('{"v":1,"seq":2,"data":{"intent":"smtp_send"'));
        file.close();
        Deno.exit(42);
        `,
      ],
      cwd: Deno.cwd(),
    });
    const child = await command.output();
    assertEquals(child.code, 42);

    // Reopen in parent
    const recovery = await readJournal<{ step?: number; intent?: string }>(root, relPath);
    assertEquals(recovery.status, "torn-tail");
    assertEquals(recovery.records.length, 1);
    assertEquals(recovery.records[0], { step: 1 });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - Unicode multibyte byteOffset accurately counted in raw UTF-8 bytes", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    // Record 1 contains multibyte characters (Chinese / Emoji)
    await appendDurable(root, relPath, { text: "你好世界 🚀🌟" });
    const fullPath = resolve(root, relPath);

    const bytesBefore = (await Deno.readFile(fullPath)).length;

    // Add a torn second record
    const file = await Deno.open(fullPath, { append: true });
    await file.write(new TextEncoder().encode('{"v":1,"seq":2,"data":{"text":"incompl'));
    file.close();

    const res = await readJournal<{ text: string }>(root, relPath);
    assertEquals(res.status, "torn-tail");
    assertEquals(res.records.length, 1);
    assertEquals(res.records[0], { text: "你好世界 🚀🌟" });
    // The byteOffset must exactly equal the byte length of line 1 (raw UTF-8 byte boundary)
    assertEquals(res.byteOffset, bytesBefore);
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.TORN_TAIL_MISSING_NEWLINE);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("subprocess writer exit and reopen - verified state", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-subprocess-" });
  try {
    const root = tempDir;
    const relPath = "journals/subprocess-journal.jsonl";

    // Run a subprocess that appends a record and exits
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `
        import { appendDurable } from "./src/platforms/email/durable-files.ts";
        await appendDurable(${JSON.stringify(root)}, ${
          JSON.stringify(relPath)
        }, { step: "subprocess_record" });
        Deno.exit(0);
        `,
      ],
      cwd: Deno.cwd(),
    });
    const child = await command.output();
    assertEquals(child.code, 0);

    // Parent process reopens the journal
    const res = await readJournal<{ step: string }>(root, relPath);
    assertEquals(res.status, "clean");
    assertEquals(res.records.length, 1);
    assertEquals(res.records[0], { step: "subprocess_record" });

    // Subsequent append succeeds
    const next = await appendDurable(root, relPath, { step: "parent_record" });
    assertEquals(next.seq, 2);

    const res2 = await readJournal<{ step: string }>(root, relPath);
    assertEquals(res2.status, "clean");
    assertEquals(res2.records.length, 2);
    assertEquals(res2.records[1], { step: "parent_record" });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("assertSafePath and path confinement", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = await canonicalizeRoot(tempDir);

    // Valid relative path
    const valid = await assertSafePath(root, "mailbox/journal.jsonl");
    assertEquals(valid, resolve(root, "mailbox/journal.jsonl"));

    // Absolute path rejected
    await assertRejects(
      () => assertSafePath(root, "/etc/passwd"),
      DurableFileError,
      "[PATH_TRAVERSAL_DETECTED]",
    );

    // Parent escape rejected
    await assertRejects(
      () => assertSafePath(root, "../escaped.jsonl"),
      DurableFileError,
      "[PATH_TRAVERSAL_DETECTED]",
    );

    await assertRejects(
      () => assertSafePath(root, "mailbox/../../escaped.jsonl"),
      DurableFileError,
      "[PATH_TRAVERSAL_DETECTED]",
    );

    // Symlink escape rejected
    if (Deno.build.os !== "windows") {
      const outsideDir = await Deno.makeTempDir({ prefix: "email-outside-" });
      try {
        const linkPath = resolve(root, "symlink_dir");
        await Deno.symlink(outsideDir, linkPath);

        await assertRejects(
          () => assertSafePath(root, "symlink_dir/secret.jsonl"),
          DurableFileError,
          "[SYMLINK_NOT_PERMITTED]",
        );
      } finally {
        await Deno.remove(outsideDir, { recursive: true });
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ensureDurableDir creates directories with mode 0o700", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = await canonicalizeRoot(tempDir);
    const subDir = resolve(root, "sub1/sub2");
    await ensureDurableDir(root, subDir);

    const stat = await Deno.stat(subDir);
    assertEquals(stat.isDirectory, true);
    if (Deno.build.os !== "windows") {
      const mode = (await Deno.lstat(subDir)).mode;
      if (mode !== null) {
        // Permissions masked with 0o777 should be 0o700
        assertEquals(mode & 0o777, 0o700);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("appendDurable and readJournal - clean journal progression", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journals/mailbox.jsonl";

    // Initial read on non-existent file returns clean, empty records
    const initial = await readJournal<{ id: string; action: string }>(root, relPath);
    assertEquals(initial.status, "clean");
    assertEquals(initial.records, []);
    assertEquals(initial.diagnosticCode, DurableDiagnosticCode.JOURNAL_NOT_FOUND);

    // Append first record
    const r1 = await appendDurable(root, relPath, { id: "msg_1", action: "FETCHED" });
    assertEquals(r1.seq, 1);

    // Append second record
    const r2 = await appendDurable(root, relPath, { id: "msg_2", action: "PROCESSED" });
    assertEquals(r2.seq, 2);

    // Read back journal
    const res = await readJournal<{ id: string; action: string }>(root, relPath);
    assertEquals(res.status, "clean");
    assertEquals(res.records.length, 2);
    assertEquals(res.records[0], { id: "msg_1", action: "FETCHED" });
    assertEquals(res.records[1], { id: "msg_2", action: "PROCESSED" });
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.CLEAN);

    // Check file permissions
    if (Deno.build.os !== "windows") {
      const fullPath = resolve(root, relPath);
      const stat = await Deno.lstat(fullPath);
      if (stat.mode !== null) {
        assertEquals(stat.mode & 0o777, 0o600);
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - torn-tail: missing newline at final record", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    await appendDurable(root, relPath, { step: 1 });
    const fullPath = resolve(root, relPath);

    // Add a valid envelope without trailing newline
    const envelope = {
      v: JOURNAL_ENVELOPE_VERSION,
      seq: 2,
      data: { step: 2 },
      crc32: computeCrc32Hex(new TextEncoder().encode(JSON.stringify({ step: 2 }))),
    };
    const lineWithoutNewline = new TextEncoder().encode(JSON.stringify(envelope));
    const file = await Deno.open(fullPath, { append: true });
    await file.write(lineWithoutNewline);
    file.close();

    const res = await readJournal<{ step: number }>(root, relPath);
    assertEquals(res.status, "torn-tail");
    assertEquals(res.records.length, 1);
    assertEquals(res.records[0], { step: 1 });
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.TORN_TAIL_MISSING_NEWLINE);

    // Subsequent append MUST be refused!
    await assertRejects(
      () => appendDurable(root, relPath, { step: 3 }),
      DurableFileError,
      "[DAMAGED_JOURNAL_APPEND_REFUSED]",
    );

    // Ensure journal content was unchanged by refused append
    const resAfter = await readJournal<{ step: number }>(root, relPath);
    assertEquals(resAfter.records.length, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - torn-tail: truncated final JSON record", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    await appendDurable(root, relPath, { step: 1 });
    const fullPath = resolve(root, relPath);

    // Append truncated JSON at end of file (with or without newline)
    const truncated = new TextEncoder().encode('{"v":1,"seq":2,"data":{"intent":"send"\n');
    const file = await Deno.open(fullPath, { append: true });
    await file.write(truncated);
    file.close();

    const res = await readJournal<{ step?: number; intent?: string }>(root, relPath);
    assertEquals(res.status, "torn-tail");
    assertEquals(res.records.length, 1);
    assertEquals(res.records[0], { step: 1 });
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.TORN_TAIL_TRUNCATED_RECORD);

    // Append must be refused
    await assertRejects(
      () => appendDurable(root, relPath, { step: 3 }),
      DurableFileError,
      "[DAMAGED_JOURNAL_APPEND_REFUSED]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - torn-tail: final record checksum mismatch", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    await appendDurable(root, relPath, { step: 1 });
    const fullPath = resolve(root, relPath);

    const badEnvelope = {
      v: JOURNAL_ENVELOPE_VERSION,
      seq: 2,
      data: { step: 2 },
      crc32: "deadbeef",
    };
    const badLine = new TextEncoder().encode(JSON.stringify(badEnvelope) + "\n");
    const file = await Deno.open(fullPath, { append: true });
    await file.write(badLine);
    file.close();

    const res = await readJournal<{ step: number }>(root, relPath);
    assertEquals(res.status, "torn-tail");
    assertEquals(res.records.length, 1);
    assertEquals(res.records[0], { step: 1 });
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.TORN_TAIL_CHECKSUM_MISMATCH);

    await assertRejects(
      () => appendDurable(root, relPath, { step: 3 }),
      DurableFileError,
      "[DAMAGED_JOURNAL_APPEND_REFUSED]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - corrupt interior: invalid JSON in non-final record", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    await appendDurable(root, relPath, { step: 1 });
    const fullPath = resolve(root, relPath);

    // Write corrupt line followed by valid record
    const corruptLine = new TextEncoder().encode("{ corrupted invalid json\n");
    const validEnvelope = {
      v: JOURNAL_ENVELOPE_VERSION,
      seq: 3,
      data: { step: 3 },
      crc32: computeCrc32Hex(new TextEncoder().encode(JSON.stringify({ step: 3 }))),
    };
    const validLine = new TextEncoder().encode(JSON.stringify(validEnvelope) + "\n");

    const file = await Deno.open(fullPath, { append: true });
    await file.write(corruptLine);
    await file.write(validLine);
    file.close();

    const res = await readJournal<{ step: number }>(root, relPath);
    assertEquals(res.status, "corrupt");
    assertEquals(res.records.length, 1);
    assertEquals(res.records[0], { step: 1 });
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.CORRUPT_INTERIOR_INVALID_JSON);

    // Diagnostic message does NOT leak private contents
    assertEquals(res.message.includes("{ corrupted"), false);

    // Append must be refused
    await assertRejects(
      () => appendDurable(root, relPath, { step: 4 }),
      DurableFileError,
      "[DAMAGED_JOURNAL_APPEND_REFUSED]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - corrupt sequence order: gap or duplicate sequence numbers", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    await appendDurable(root, relPath, { step: 1 });
    const fullPath = resolve(root, relPath);

    // Write record with seq=3 (gap: expected 2)
    const gapEnvelope = {
      v: JOURNAL_ENVELOPE_VERSION,
      seq: 3,
      data: { step: 3 },
      crc32: computeCrc32Hex(new TextEncoder().encode(JSON.stringify({ step: 3 }))),
    };
    const gapLine = new TextEncoder().encode(JSON.stringify(gapEnvelope) + "\n");
    const file = await Deno.open(fullPath, { append: true });
    await file.write(gapLine);
    file.close();

    const res = await readJournal<{ step: number }>(root, relPath);
    assertEquals(res.status, "corrupt");
    assertEquals(res.records.length, 1);
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.CORRUPT_SEQUENCE_ORDER);

    await assertRejects(
      () => appendDurable(root, relPath, { step: 4 }),
      DurableFileError,
      "[DAMAGED_JOURNAL_APPEND_REFUSED]",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("readJournal - corrupt: unsupported envelope version", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "journal.jsonl";

    const unsupportedEnvelope = {
      v: 999,
      seq: 1,
      data: { step: 1 },
      crc32: computeCrc32Hex(new TextEncoder().encode(JSON.stringify({ step: 1 }))),
    };
    const line = new TextEncoder().encode(JSON.stringify(unsupportedEnvelope) + "\n");
    const fullPath = resolve(tempDir, relPath);
    await Deno.writeFile(fullPath, line);

    const res = await readJournal<{ step: number }>(root, relPath);
    assertEquals(res.status, "corrupt");
    assertEquals(res.diagnosticCode, DurableDiagnosticCode.UNSUPPORTED_ENVELOPE_VERSION);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("replaceSnapshot - atomic sibling replacement", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const relPath = "state/snapshot.json";

    // Initial snapshot write
    await replaceSnapshot(root, relPath, { version: 1, count: 10 });
    const fullPath = resolve(root, relPath);

    const text1 = await Deno.readTextFile(fullPath);
    const parsed1 = JSON.parse(text1);
    assertEquals(parsed1, { version: 1, count: 10 });

    if (Deno.build.os !== "windows") {
      const stat = await Deno.lstat(fullPath);
      if (stat.mode !== null) {
        assertEquals(stat.mode & 0o777, 0o600);
      }
    }

    // Replace with updated snapshot
    await replaceSnapshot(root, relPath, { version: 2, count: 20 });
    const text2 = await Deno.readTextFile(fullPath);
    const parsed2 = JSON.parse(text2);
    assertEquals(parsed2, { version: 2, count: 20 });

    // No leftover temporary files in directory
    const dirEntries: string[] = [];
    for await (const entry of Deno.readDir(resolve(root, "state"))) {
      dirEntries.push(entry.name);
    }
    assertEquals(dirEntries, ["snapshot.json"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("replaceSnapshot - refuses to replace symlink target", async () => {
  if (Deno.build.os === "windows") return;
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  const outsideDir = await Deno.makeTempDir({ prefix: "email-outside-" });
  try {
    const root = tempDir;
    const targetOutsideFile = resolve(outsideDir, "victim.json");
    await Deno.writeTextFile(targetOutsideFile, "{}");

    const relPath = "state/symlink-snapshot.json";
    const fullSymlink = resolve(root, relPath);
    await ensureDurableDir(root, resolve(root, "state"));
    await Deno.symlink(targetOutsideFile, fullSymlink);

    await assertRejects(
      () => replaceSnapshot(root, relPath, { malicious: true }),
      DurableFileError,
      "[SYMLINK_NOT_PERMITTED]",
    );

    // Outside file was untouched
    const outsideContent = await Deno.readTextFile(targetOutsideFile);
    assertEquals(outsideContent, "{}");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    await Deno.remove(outsideDir, { recursive: true });
  }
});

Deno.test("serialized concurrency - concurrent appends and snapshots do not corrupt state", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "email-durable-test-" });
  try {
    const root = tempDir;
    const journalRel = "data/concurrency.jsonl";
    const snapshotRel = "data/concurrency.json";

    const iterations = 20;

    // Concurrently trigger appends and snapshots on the same state root
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < iterations; i++) {
      promises.push(appendDurable(root, journalRel, { index: i }));
      promises.push(replaceSnapshot(root, snapshotRel, { lastIndex: i }));
    }

    await Promise.all(promises);

    const journal = await readJournal<{ index: number }>(root, journalRel);
    assertEquals(journal.status, "clean");
    assertEquals(journal.records.length, iterations);

    // Assert every submitted index appears exactly once
    const seenIndices = new Set<number>();
    for (const record of journal.records) {
      seenIndices.add(record.index);
    }
    assertEquals(seenIndices.size, iterations);

    const snapshotRaw = await Deno.readTextFile(resolve(root, snapshotRel));
    const snapshot = JSON.parse(snapshotRaw);
    assertEquals(typeof snapshot.lastIndex, "number");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
