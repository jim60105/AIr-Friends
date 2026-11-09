// migration/bun/convert/codemod.spec.ts

import { test } from "bun:test";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { convertSource } from "./codemod.ts";

const TEST_FILE = "tests/sample.test.ts";

function convert(source: string, options: { srcHelpers?: boolean } = {}, fileName = TEST_FILE) {
  return convertSource(source, fileName, options);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Delta spec: Test Registration Rewrite
// ---------------------------------------------------------------------------

test("spec - string form becomes a bun:test test call", () => {
  const result = convert('Deno.test("a - b", async () => { x(); });\n');
  assertStringIncludes(result.code, 'test("a - b", async () => { x(); });');
  assertStringIncludes(result.code, 'import { test } from "bun:test";');
  assertEquals(result.refused, []);
});

test("spec - object form with ignore and sanitizers becomes skipIf", () => {
  const result = convert(
    'Deno.test({ name: "n", ignore: !hasBin, sanitizeOps: false, fn: async () => {} });\n',
  );
  assertStringIncludes(result.code, 'test.skipIf(!hasBin)("n", async () => {});');
  assert(!result.code.includes("sanitizeOps"));
  assert(!result.code.includes("sanitizeResources"));
});

test("spec - steps are reported and left unchanged", () => {
  const source = 'Deno.test("s", async (t) => { await t.step("x", () => {}); });\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("t.step")));
});

// ---------------------------------------------------------------------------
// Delta spec: API Call Rewrite
// ---------------------------------------------------------------------------

test("spec - environment read", () => {
  const result = convert('const v = Deno.env.get("X");\n');
  assertEquals(result.code, 'const v = process.env["X"];\n');
});

test("spec - recursive removal with a single fsp import", () => {
  const result = convert("await Deno.remove(dir, { recursive: true });\n");
  assertStringIncludes(result.code, "await fsp.rm(dir, { recursive: true });");
  assertEquals(count(result.code, 'from "node:fs/promises"'), 1);
});

test("spec - high-risk symbol untouched and reported", () => {
  const result = convert('new Deno.Command("git", { args });\n');
  assertEquals(result.code, 'new Deno.Command("git", { args });\n');
  assert(result.manual.some((entry) => entry.reason.includes("Deno.Command")));
});

// ---------------------------------------------------------------------------
// Delta spec: Residual Report
// ---------------------------------------------------------------------------

test("spec - report lists leftovers and no converted line", () => {
  const result = convert('const a = Deno.readTextFile("x");\nDeno.open("y");\n');
  assertStringIncludes(result.code, 'fsp.readFile("x", "utf8")');
  const open = result.manual.find((entry) => entry.text.includes("Deno.open"));
  assert(open !== undefined);
  assertEquals(open.line, 3);
  assert(!result.manual.some((entry) => entry.text.includes("readTextFile")));
});

test("spec - name collision refuses the file and the CLI exits non-zero", () => {
  const source = 'const fsp = 1;\nconst v = Deno.readTextFile("x");\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assertEquals(result.rewrites, 0);
  assert(result.refused.some((entry) => entry.includes('"fsp"')));

  const directory = mkdtempSync(join(os.tmpdir(), "codemod-collision-"));
  try {
    const file = join(directory, "collision.test.ts");
    writeFileSync(file, source);
    const codemod = new URL("./codemod.ts", import.meta.url).pathname;
    const spawned = spawnSync(
      process.execPath,
      ["run", "--no-env-file", codemod, "--check", file],
      { encoding: "utf8" },
    );
    assertEquals(spawned.status, 1);
    assertStringIncludes(spawned.stdout, "collides");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Design D3 table rows
// ---------------------------------------------------------------------------

test("row - string-template name", () => {
  const result = convert("Deno.test(`a`, () => {});\n");
  assertStringIncludes(result.code, "test(`a`, () => {});");
});

test("row - name with sanitizer options only", () => {
  const result = convert(
    'Deno.test("n", { sanitizeOps: false, sanitizeResources: false }, async () => {});\n',
  );
  assertStringIncludes(result.code, 'test("n", async () => {});');
});

test("row - name with ignore option becomes skipIf", () => {
  const result = convert('Deno.test("n", { ignore: flag }, () => {});\n');
  assertStringIncludes(result.code, 'test.skipIf(flag)("n", () => {});');
});

test("row - name with an unknown option is manual", () => {
  const source = 'Deno.test("n", { permissions: { read: true } }, () => {});\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("permissions")));
});

test("row - object form with method fn", () => {
  const result = convert('Deno.test({ name: "n", async fn() { x(); } });\n');
  assertStringIncludes(result.code, 'test("n", async function () { x(); });');
});

test("row - object form with a non-literal options argument is manual", () => {
  const source = "Deno.test(name, options, fn);\n";
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.length > 0);
});

test("row - name option in the three-argument form is manual", () => {
  const source = 'Deno.test("n", { name: "other" }, () => {});\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("declares name")));
});

test("row - Deno.test.ignore becomes test.skip", () => {
  const result = convert('Deno.test.ignore("n", () => {});\n');
  assertStringIncludes(result.code, 'test.skip("n", () => {});');
});

test("row - env.get", () => {
  assertEquals(convert('Deno.env.get("K");\n').code, 'process.env["K"];\n');
});

test("row - env.set expression statement", () => {
  assertEquals(convert('Deno.env.set("K", v);\n').code, 'process.env["K"] = v;\n');
});

test("row - env.delete expression statement", () => {
  assertEquals(convert('Deno.env.delete("K");\n').code, 'delete process.env["K"];\n');
});

test("row - env.has", () => {
  assertEquals(
    convert('const h = Deno.env.has("K");\n').code,
    'const h = Object.hasOwn(process.env, "K");\n',
  );
});

test("row - env.toObject with note", () => {
  const result = convert("const env = Deno.env.toObject();\n");
  assertEquals(result.code, "const env = ({ ...process.env });\n");
  assert(result.manual.some((entry) => entry.reason.includes("undefined")));
});

test("row - env.toObject in an arrow body stays an expression", () => {
  const result = convert("const f = () => Deno.env.toObject();\n");
  assertEquals(result.code, "const f = () => ({ ...process.env });\n");
});

test("row - cwd and execPath", () => {
  const result = convert("const d = Deno.cwd();\nconst e = Deno.execPath();\n");
  assertStringIncludes(result.code, "const d = process.cwd();");
  assertStringIncludes(result.code, "const e = process.execPath;");
});

test("row - readTextFile and readTextFileSync", () => {
  const result = convert('Deno.readTextFile("p");\nDeno.readTextFileSync("p");\n');
  assertStringIncludes(result.code, 'fsp.readFile("p", "utf8");');
  assertStringIncludes(result.code, 'fs.readFileSync("p", "utf8");');
});

test("row - readFile and readFileSync", () => {
  const result = convert('Deno.readFile("p");\nDeno.readFileSync("p");\n');
  assertStringIncludes(result.code, 'fsp.readFile("p");');
  assertStringIncludes(result.code, 'fs.readFileSync("p");');
});

test("row - writeTextFile, writeFile and sync forms", () => {
  const result = convert(
    'Deno.writeTextFile("p", d);\nDeno.writeTextFileSync("p", d);\nDeno.writeFile("p", d);\nDeno.writeFileSync("p", d);\n',
  );
  assertStringIncludes(result.code, 'fsp.writeFile("p", d);');
  assertStringIncludes(result.code, 'fs.writeFileSync("p", d);');
});

test("row - write option append only", () => {
  const result = convert('Deno.writeTextFile(p, d, { append: true });\n');
  assertStringIncludes(result.code, "fsp.appendFile(p, d);");
});

test("row - write option mode only", () => {
  const result = convert("Deno.writeFile(p, d, { mode: 0o600 });\n");
  assertStringIncludes(result.code, "fsp.writeFile(p, d, { mode: 0o600 });");
});

test("row - other write options are manual", () => {
  const source = "Deno.writeTextFile(p, d, { create: true });\n";
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("wx")));
});

test("row - mkdir and mkdirSync", () => {
  const result = convert('Deno.mkdir("p", { recursive: true });\nDeno.mkdirSync("p");\n');
  assertStringIncludes(result.code, 'fsp.mkdir("p", { recursive: true });');
  assertStringIncludes(result.code, 'fs.mkdirSync("p");');
});

test("row - remove recursive sync", () => {
  const result = convert('Deno.removeSync("p", { recursive: true });\n');
  assertStringIncludes(result.code, 'fs.rmSync("p", { recursive: true });');
});

test("row - remove single path uses removePath helpers", () => {
  const result = convert('await Deno.remove("p");\nDeno.removeSync("p");\n');
  assertStringIncludes(result.code, 'await removePath("p");');
  assertStringIncludes(result.code, 'removePathSync("p");');
  assertStringIncludes(result.code, 'import { removePath, removePathSync } from "../src/utils/fs-compat.ts";');
});

test("row - stat, lstat, realPath, readLink, rename, chmod, copyFile, symlink", () => {
  const result = convert(
    'await Deno.stat(p);\nawait Deno.lstat(p);\nawait Deno.realPath(p);\nawait Deno.readLink(p);\nawait Deno.rename(a, b);\nawait Deno.chmod(p, 0o600);\nawait Deno.copyFile(a, b);\nawait Deno.symlink(a, b);\n',
  );
  assertStringIncludes(result.code, "await fsp.stat(p);");
  assertStringIncludes(result.code, "await fsp.lstat(p);");
  assertStringIncludes(result.code, "await fsp.realpath(p);");
  assertStringIncludes(result.code, "await fsp.readlink(p);");
  assertStringIncludes(result.code, "await fsp.rename(a, b);");
  assertStringIncludes(result.code, "await fsp.chmod(p, 0o600);");
  assertStringIncludes(result.code, "await fsp.copyFile(a, b);");
  assertStringIncludes(result.code, "await fsp.symlink(a, b);");
});

test("row - sync stat family", () => {
  const result = convert(
    'Deno.statSync(p);\nDeno.lstatSync(p);\nDeno.realPathSync(p);\nDeno.readLinkSync(p);\nDeno.renameSync(a, b);\nDeno.chmodSync(p, 0o600);\nDeno.copyFileSync(a, b);\nDeno.symlinkSync(a, b);\n',
  );
  assertStringIncludes(result.code, "fs.statSync(p);");
  assertStringIncludes(result.code, "fs.lstatSync(p);");
  assertStringIncludes(result.code, "fs.realpathSync(p);");
  assertStringIncludes(result.code, "fs.readlinkSync(p);");
  assertStringIncludes(result.code, "fs.renameSync(a, b);");
  assertStringIncludes(result.code, "fs.chmodSync(p, 0o600);");
  assertStringIncludes(result.code, "fs.copyFileSync(a, b);");
  assertStringIncludes(result.code, "fs.symlinkSync(a, b);");
});

test("row - symlink third argument dropped and reported", () => {
  const result = convert('await Deno.symlink("target", "path", "dir");\n');
  assertStringIncludes(result.code, 'await fsp.symlink("target", "path");');
  assert(result.manual.some((entry) => entry.reason.includes("symlink type argument")));
});

test("row - symlink needs both required arguments", () => {
  const source = 'await Deno.symlink("target");\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("argument count")));
});

test("row - for-await readDir", () => {
  const result = convert("for await (const e of Deno.readDir(p)) { f(e); }\n");
  assertEquals(
    result.code,
    'import fsp from "node:fs/promises";\nfor (const e of await fsp.readdir(p, { withFileTypes: true })) { f(e); }\n',
  );
});

test("row - readDirSync", () => {
  const result = convert("const entries = Deno.readDirSync(p);\n");
  assertStringIncludes(result.code, "const entries = fs.readdirSync(p, { withFileTypes: true });");
});

test("row - readDir outside for-await is manual", () => {
  const source = "const entries = Deno.readDir(p);\n";
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("readDir")));
});

test("row - makeTempDir, makeTempDirSync, makeTempFile, makeTempFileSync", () => {
  const result = convert(
    'await Deno.makeTempDir({ prefix: "a-" });\nDeno.makeTempDirSync();\nawait Deno.makeTempFile({ suffix: ".json" });\nDeno.makeTempFileSync();\n',
  );
  assertStringIncludes(result.code, 'await makeTempDir({ prefix: "a-" });');
  assertStringIncludes(result.code, "makeTempDirSync();");
  assertStringIncludes(result.code, 'await makeTempFile({ suffix: ".json" });');
  assertStringIncludes(result.code, "makeTempFileSync();");
  assertStringIncludes(
    result.code,
    'import { makeTempDir, makeTempDirSync, makeTempFile, makeTempFileSync } from "../src/utils/fs-compat.ts";',
  );
});

test("row - instanceof Deno.errors classifiers", () => {
  const result = convert(
    "if (e instanceof Deno.errors.NotFound) {}\nif (e instanceof Deno.errors.AlreadyExists) {}\nif (e instanceof Deno.errors.PermissionDenied) {}\n",
  );
  assertStringIncludes(result.code, "if (isNotFoundError(e)) {}");
  assertStringIncludes(result.code, "if (isAlreadyExistsError(e)) {}");
  assertStringIncludes(result.code, "if (isPermissionDeniedError(e)) {}");
});

test("row - Deno.build.os and Deno.build.arch", () => {
  const result = convert("const os = Deno.build.os;\nconst arch = Deno.build.arch;\n");
  assertStringIncludes(result.code, "const os = runtimeOs();");
  assertStringIncludes(result.code, "const arch = runtimeArch();");
  assertStringIncludes(
    result.code,
    'import { runtimeArch, runtimeOs } from "../src/utils/runtime-platform.ts";',
  );
});

test("row - Deno.FileInfo and Deno.DirEntry types", () => {
  const result = convert("function f(a: Deno.FileInfo, b: Deno.DirEntry) {}\n");
  assertStringIncludes(result.code, "function f(a: Stats, b: Dirent) {}");
  assertStringIncludes(result.code, 'import type { Dirent, Stats } from "node:fs";');
});

test("row - @std/path import rewrite", () => {
  const result = convert(
    'import { join, SEPARATOR, fromFileUrl, toFileUrl } from "@std/path";\nconst p = join("a", "b");\n',
  );
  assertStringIncludes(result.code, 'import { join, sep as SEPARATOR } from "node:path";');
  assertStringIncludes(
    result.code,
    'import { fileURLToPath as fromFileUrl, pathToFileURL as toFileUrl } from "node:url";',
  );
});

test("row - @std/path type import keeps import type", () => {
  const result = convert('import type { dirname } from "@std/path";\n');
  assertStringIncludes(result.code, 'import type { dirname } from "node:path";');
});

test("row - SEPARATOR_PATTERN is manual", () => {
  const source = 'import { SEPARATOR_PATTERN } from "@std/path";\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("SEPARATOR_PATTERN")));
});

test("row - @std/fs exists becomes pathExists alias", () => {
  const result = convert('import { exists } from "@std/fs";\nif (await exists("p")) {}\n');
  assertEquals(
    result.code,
    'import { pathExists as exists } from "../src/utils/fs-compat.ts";\nif (await exists("p")) {}\n',
  );
});

test("row - @std/fs exists is manual with --no-src-helpers", () => {
  const source = 'import { exists } from "@std/fs";\n';
  const result = convert(source, { srcHelpers: false });
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("--no-src-helpers")));
});

test("row - @std/yaml import and stringify report", () => {
  const result = convert(
    'import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";\nconst a = parseYaml("a: 1");\nconst b = stringifyYaml({});\n',
  );
  assertStringIncludes(result.code, 'from "yaml";');
  assert(result.manual.some((entry) => entry.reason.includes("stringify")));
});

test("row - ventojs environment extension", () => {
  const result = convert('import type { Environment } from "ventojs/core/environment.ts";\n');
  assertStringIncludes(result.code, 'from "ventojs/core/environment.js";');
});

test("row - @std/fs/copy is manual", () => {
  const source = 'import { copy } from "@std/fs/copy";\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("@std/fs/copy")));
});

test("row - @std/flags is manual", () => {
  const source = 'import { parse } from "@std/flags";\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("@std/flags")));
});

// ---------------------------------------------------------------------------
// Flagged patterns and import behaviour
// ---------------------------------------------------------------------------

test("flag - Stats and Dirent property access", () => {
  const result = convert(
    "function f(info: Deno.FileInfo) { return info.isFile || info.isDirectory || info.isSymlink; }\n",
  );
  assert(result.manual.some((entry) => entry.reason.includes(".isFile")));
  assert(result.manual.some((entry) => entry.reason.includes("isSymbolicLink")));
});

test("flag - timestamp compared with null", () => {
  const result = convert("if (info.mtime === null) {}\n");
  assert(result.manual.some((entry) => entry.reason.includes("timestamp")));
});

test("flag - remaining Deno reference reports its line", () => {
  const result = convert('const a = Deno.readTextFile("x");\nconst b = Deno.exit(0);\n');
  const exit = result.manual.find((entry) => entry.text.includes("Deno.exit"));
  assert(exit !== undefined);
  assertEquals(exit.line, 3);
  assertStringIncludes(exit.reason, "high-risk");
});

test("import - inserts after the last existing import", () => {
  const result = convert('import { a } from "./a.ts";\nconst v = Deno.readTextFile("x");\n');
  const lines = result.code.split("\n");
  assertEquals(lines[0], 'import { a } from "./a.ts";');
  assertEquals(lines[1], 'import fsp from "node:fs/promises";');
});

test("import - extends an existing bun:test import", () => {
  const result = convert('import { describe } from "bun:test";\nDeno.test("x", () => {});\n');
  assertStringIncludes(result.code, 'import { describe, test } from "bun:test";');
  assertEquals(count(result.code, 'from "bun:test"'), 1);
});

test("import - helper import only once per file", () => {
  const result = convert("Deno.makeTempDir();\nDeno.makeTempDir();\n");
  assertEquals(count(result.code, 'from "../src/utils/fs-compat.ts"'), 1);
});

test("import - inserted after a shebang", () => {
  const result = convert('#!/usr/bin/env -S deno run\nDeno.test("x", () => {});\n');
  const lines = result.code.split("\n");
  assertEquals(lines[0], "#!/usr/bin/env -S deno run");
  assertEquals(lines[1], 'import { test } from "bun:test";');
});

test("guard - --no-src-helpers reports helper rewrites", () => {
  const source = "const d = Deno.makeTempDir();\n";
  const result = convert(source, { srcHelpers: false });
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("--no-src-helpers")));
});

test("guard - a shadowed fs binding is manual", () => {
  const source =
    "Deno.test(\"a\", () => {});\nfunction f() { const fs = { readFileSync: () => 1 }; Deno.readFileSync(\"x\"); }\n";
  const result = convert(source);
  assertStringIncludes(result.code, "Deno.readFileSync");
  assert(result.manual.some((entry) => entry.reason.includes("shadowed")));
});

test("guard - a shadowed process binding is manual", () => {
  const source = 'function f() { const process = { env: {} }; return Deno.env.get("X"); }\n';
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("process is shadowed")));
});

test("guard - a local test wrapper is reported, not refused", () => {
  const source = 'function test(name, run) { Deno.test(name, run); }\ntest("x", () => {});\n';
  const result = convert(source);
  assertEquals(result.refused, []);
  assert(result.manual.length > 0);
});

test("guard - readDirSync iterator consumer is manual", () => {
  const source = "if (Deno.readDirSync(p).next().done !== true) {}\n";
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("iterator")));
});

test("guard - spread of a Stats result is manual", () => {
  const source = "const s = { ...Deno.lstatSync(p), dev: 1 };\n";
  const result = convert(source);
  assertEquals(result.code, source);
  assert(result.manual.some((entry) => entry.reason.includes("spread")));
});

test("guard - parse errors refuse the file", () => {
  const result = convert("const = ;\n");
  assertEquals(result.refused.length, 1);
  assertStringIncludes(result.refused[0], "parse error");
});

test("report - bare Deno reference", () => {
  const result = convert("const D = Deno;\n");
  assertEquals(result.code, "const D = Deno;\n");
  assert(result.manual.some((entry) => entry.reason.includes("bare Deno")));
});

test("report - Deno element access", () => {
  const result = convert('Deno["open"]("p");\n');
  assertEquals(result.code, 'Deno["open"]("p");\n');
  assert(result.manual.some((entry) => entry.reason.includes("element access")));
});
