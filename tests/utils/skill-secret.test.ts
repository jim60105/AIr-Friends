// tests/utils/skill-secret.test.ts
// Unit tests for the deployment Skill API secret (256-bit CSPRNG, file persistence,
// env override) and the JWT directory creation.

import { assert, assertEquals } from "@std/assert";
import {
  ensureSkillJwtDir,
  generateSkillApiSecret,
  isValidSkillSecret,
  resolveSkillApiSecret,
} from "../../src/utils/skill-secret.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDirSync } from "../../src/utils/fs-compat.ts";

test("generateSkillApiSecret - 64 hex chars (256 bits)", () => {
  const secret = generateSkillApiSecret();
  assertEquals(secret.length, 64);
  assert(/^[0-9a-f]{64}$/.test(secret));
});

test("isValidSkillSecret - enforces the 32-byte minimum", () => {
  assert(isValidSkillSecret("a".repeat(32)));
  assert(!isValidSkillSecret("a".repeat(31)));
  assert(isValidSkillSecret(generateSkillApiSecret()));
});

test("resolveSkillApiSecret - env var wins and is validated", async () => {
  const secret = generateSkillApiSecret();
  process.env["AGENT_SKILL_API_SECRET"] = secret;
  try {
    const result = await resolveSkillApiSecret("/tmp/nonexistent/skill-secret");
    assert(result.ok);
    if (result.ok) {
      assertEquals(result.secret, secret);
      assertEquals(result.source, "env");
    }
  } finally {
    delete process.env["AGENT_SKILL_API_SECRET"];
  }
});

test("resolveSkillApiSecret - short env secret is rejected", async () => {
  process.env["AGENT_SKILL_API_SECRET"] = "short";
  try {
    const result = await resolveSkillApiSecret("/tmp/nonexistent/skill-secret");
    assert(!result.ok);
    if (!result.ok) {
      assert(result.error.includes("32 bytes"));
    }
  } finally {
    delete process.env["AGENT_SKILL_API_SECRET"];
  }
});

test("resolveSkillApiSecret - loads an existing secret file", async () => {
  const dir = makeTempDirSync();
  const secretPath = `${dir}/skill-secret`;
  const secret = generateSkillApiSecret();
  await fsp.writeFile(secretPath, secret + "\n");

  const result = await resolveSkillApiSecret(secretPath);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.secret, secret);
    assertEquals(result.source, "file");
  }
});

test("resolveSkillApiSecret - generates and persists when no file exists", async () => {
  const dir = makeTempDirSync();
  const secretPath = `${dir}/skill-secret`;

  const result = await resolveSkillApiSecret(secretPath);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.source, "generated");
    assertEquals(result.secret.length, 64);
    // The secret file exists with mode 0600.
    const stat = await fsp.stat(secretPath);
    assertEquals((stat.mode ?? 0) & 0o777, 0o600);
    // Content round-trips (whitespace trimmed).
    const onDisk = (await fsp.readFile(secretPath, "utf8")).trim();
    assertEquals(onDisk, result.secret);
  }
});

test("ensureSkillJwtDir - creates the directory with mode 0700", async () => {
  const dir = makeTempDirSync();
  const jwtDir = `${dir}/skill-jwt`;
  await ensureSkillJwtDir(jwtDir);
  const stat = await fsp.stat(jwtDir);
  assertEquals((stat.mode ?? 0) & 0o777, 0o700);
});

test("ensureSkillJwtDir - idempotent on an existing directory", async () => {
  const dir = makeTempDirSync();
  await ensureSkillJwtDir(dir);
  await ensureSkillJwtDir(dir);
  const stat = await fsp.stat(dir);
  assert(stat.isDirectory());
});
