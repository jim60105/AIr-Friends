// tests/utils/fs-compat.test.ts

import { test } from "bun:test";
import { assertEquals, assertRejects } from "@std/assert";
import os from "node:os";
import { dirname, join } from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  isAlreadyExistsError,
  isNotFoundError,
  isPermissionDeniedError,
  makeTempDir,
  makeTempDirSync,
  makeTempFile,
  makeTempFileSync,
  pathExists,
  removePath,
  removePathSync,
} from "@utils/fs-compat.ts";

async function removeTree(path: string): Promise<void> {
  await fsp.rm(path, { recursive: true, force: true });
}

test("isNotFoundError - missing file", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  try {
    const error = await assertRejects(() => fsp.readFile(join(root, "missing")));
    assertEquals(isNotFoundError(error), true);
    assertEquals(isAlreadyExistsError(error), false);
    assertEquals(isPermissionDeniedError(error), false);
  } finally {
    await removeTree(root);
  }
});

test("isNotFoundError - unrelated error", () => {
  const error = new Error("ENOENT");
  assertEquals(isNotFoundError(error), false);
  assertEquals(isAlreadyExistsError(error), false);
  assertEquals(isPermissionDeniedError(error), false);
  assertEquals(isNotFoundError(null), false);
  assertEquals(isNotFoundError("ENOENT"), false);
});

test("classifiers - map errno codes", () => {
  assertEquals(isAlreadyExistsError(Object.assign(new Error("x"), { code: "EEXIST" })), true);
  assertEquals(isPermissionDeniedError(Object.assign(new Error("x"), { code: "EACCES" })), true);
  assertEquals(isPermissionDeniedError(Object.assign(new Error("x"), { code: "EPERM" })), true);
  assertEquals(isNotFoundError(Object.assign(new Error("x"), { code: "EEXIST" })), false);
});

test("removePath - empty directory", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const directory = join(root, "empty");
  await fsp.mkdir(directory);
  try {
    await removePath(directory);
    assertEquals(await pathExists(directory), false);
  } finally {
    await removeTree(root);
  }
});

test("removePath - regular file", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const file = join(root, "file.txt");
  await fsp.writeFile(file, "content");
  try {
    await removePath(file);
    assertEquals(await pathExists(file), false);
  } finally {
    await removeTree(root);
  }
});

test("removePath - symbolic link", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const target = join(root, "target.txt");
  const link = join(root, "link.txt");
  await fsp.writeFile(target, "content");
  await fsp.symlink(target, link);
  try {
    await removePath(link);
    assertEquals(await pathExists(link), false);
    assertEquals(await fsp.readFile(target, "utf8"), "content");
  } finally {
    await removeTree(root);
  }
});

test("removePath - non-empty directory rejects", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const directory = join(root, "full");
  await fsp.mkdir(directory);
  const file = join(directory, "file.txt");
  await fsp.writeFile(file, "content");
  try {
    await assertRejects(() => removePath(directory));
    assertEquals(await fsp.readFile(file, "utf8"), "content");
  } finally {
    await removeTree(root);
  }
});

test("removePath - missing path rejects with not-found", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  try {
    const error = await assertRejects(() => removePath(join(root, "missing")));
    assertEquals(isNotFoundError(error), true);
  } finally {
    await removeTree(root);
  }
});

test("removePathSync - mirrors removePath", async () => {
  const root = makeTempDirSync({ prefix: "fs-compat-" });
  const file = join(root, "file.txt");
  await fsp.writeFile(file, "content");
  const directory = join(root, "empty");
  await fsp.mkdir(directory);
  try {
    removePathSync(file);
    removePathSync(directory);
    assertEquals(await pathExists(file), false);
    assertEquals(await pathExists(directory), false);
  } finally {
    await removeTree(root);
  }
});

test("makeTempDir - prefix honored", async () => {
  const first = await makeTempDir({ prefix: "abc-" });
  const second = await makeTempDir({ prefix: "abc-" });
  try {
    assertEquals(first === second, false);
    assertEquals(first.split("/").at(-1)?.startsWith("abc-"), true);
    assertEquals(second.split("/").at(-1)?.startsWith("abc-"), true);
    const mode = (await fsp.stat(first)).mode & 0o777;
    assertEquals(mode, 0o700);
    assertEquals(await pathExists(second), true);
  } finally {
    await removeTree(first);
    await removeTree(second);
  }
});

test("makeTempDir - defaults inside the system temporary directory", async () => {
  const created = await makeTempDir();
  const withDirectory = await makeTempDir({ dir: os.tmpdir() });
  try {
    assertEquals(dirname(created), os.tmpdir());
    assertEquals(dirname(withDirectory), os.tmpdir());
  } finally {
    await removeTree(created);
    await removeTree(withDirectory);
  }
});

test("makeTempDirSync - suffix honored", () => {
  const created = makeTempDirSync({ prefix: "sync-", suffix: "-suffix" });
  try {
    assertEquals(created.split("/").at(-1)?.startsWith("sync-"), true);
    assertEquals(created.endsWith("-suffix"), true);
    assertEquals(fs.statSync(created).isDirectory(), true);
  } finally {
    fs.rmSync(created, { recursive: true, force: true });
  }
});

test("makeTempFile - suffix honored", async () => {
  const path = await makeTempFile({ suffix: ".json" });
  try {
    assertEquals(path.endsWith(".json"), true);
    assertEquals((await fsp.stat(path)).isFile(), true);
    assertEquals((await fsp.readFile(path)).length, 0);
  } finally {
    await removeTree(path);
  }
});

test("makeTempFile - defaults inside the system temporary directory", async () => {
  const path = await makeTempFile();
  try {
    assertEquals(dirname(path), os.tmpdir());
    assertEquals((await fsp.stat(path)).isFile(), true);
  } finally {
    await removeTree(path);
  }
});

test("makeTempFileSync - creates an empty file", () => {
  const path = makeTempFileSync({ prefix: "sync-", suffix: ".txt" });
  try {
    assertEquals(fs.statSync(path).isFile(), true);
    assertEquals(fs.readFileSync(path).length, 0);
  } finally {
    fs.rmSync(path, { force: true });
  }
});

test("pathExists - existing path following symbolic links", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const file = join(root, "file.txt");
  const link = join(root, "link.txt");
  await fsp.writeFile(file, "content");
  await fsp.symlink(file, link);
  try {
    assertEquals(await pathExists(file), true);
    assertEquals(await pathExists(link), true);
    assertEquals(await pathExists(join(root, "missing")), false);
  } finally {
    await removeTree(root);
  }
});

test("pathExists - dangling link", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const link = join(root, "dangling.txt");
  await fsp.symlink(join(root, "missing.txt"), link);
  try {
    assertEquals(await pathExists(link), false);
  } finally {
    await removeTree(root);
  }
});

test.skipIf(process.getuid?.() === 0)("pathExists - permission error propagates", async () => {
  const root = await makeTempDir({ prefix: "fs-compat-" });
  const blocked = join(root, "blocked");
  await fsp.mkdir(blocked, { mode: 0o000 });
  try {
    await fsp.chmod(blocked, 0o000);
    const error = await assertRejects(() => pathExists(join(blocked, "file.txt")));
    assertEquals(isPermissionDeniedError(error), true);
  } finally {
    await fsp.chmod(blocked, 0o700).catch(() => {});
    await removeTree(root);
  }
});
