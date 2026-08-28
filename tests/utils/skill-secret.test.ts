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

Deno.test("generateSkillApiSecret - 64 hex chars (256 bits)", () => {
  const secret = generateSkillApiSecret();
  assertEquals(secret.length, 64);
  assert(/^[0-9a-f]{64}$/.test(secret));
});

Deno.test("isValidSkillSecret - enforces the 32-byte minimum", () => {
  assert(isValidSkillSecret("a".repeat(32)));
  assert(!isValidSkillSecret("a".repeat(31)));
  assert(isValidSkillSecret(generateSkillApiSecret()));
});

Deno.test("resolveSkillApiSecret - env var wins and is validated", async () => {
  const secret = generateSkillApiSecret();
  Deno.env.set("AGENT_SKILL_API_SECRET", secret);
  try {
    const result = await resolveSkillApiSecret("/tmp/nonexistent/skill-secret");
    assert(result.ok);
    if (result.ok) {
      assertEquals(result.secret, secret);
      assertEquals(result.source, "env");
    }
  } finally {
    Deno.env.delete("AGENT_SKILL_API_SECRET");
  }
});

Deno.test("resolveSkillApiSecret - short env secret is rejected", async () => {
  Deno.env.set("AGENT_SKILL_API_SECRET", "short");
  try {
    const result = await resolveSkillApiSecret("/tmp/nonexistent/skill-secret");
    assert(!result.ok);
    if (!result.ok) {
      assert(result.error.includes("32 bytes"));
    }
  } finally {
    Deno.env.delete("AGENT_SKILL_API_SECRET");
  }
});

Deno.test("resolveSkillApiSecret - loads an existing secret file", async () => {
  const dir = Deno.makeTempDirSync();
  const secretPath = `${dir}/skill-secret`;
  const secret = generateSkillApiSecret();
  await Deno.writeTextFile(secretPath, secret + "\n");

  const result = await resolveSkillApiSecret(secretPath);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.secret, secret);
    assertEquals(result.source, "file");
  }
});

Deno.test("resolveSkillApiSecret - generates and persists when no file exists", async () => {
  const dir = Deno.makeTempDirSync();
  const secretPath = `${dir}/skill-secret`;

  const result = await resolveSkillApiSecret(secretPath);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.source, "generated");
    assertEquals(result.secret.length, 64);
    // The secret file exists with mode 0600.
    const stat = await Deno.stat(secretPath);
    assertEquals((stat.mode ?? 0) & 0o777, 0o600);
    // Content round-trips (whitespace trimmed).
    const onDisk = (await Deno.readTextFile(secretPath)).trim();
    assertEquals(onDisk, result.secret);
  }
});

Deno.test("ensureSkillJwtDir - creates the directory with mode 0700", async () => {
  const dir = Deno.makeTempDirSync();
  const jwtDir = `${dir}/skill-jwt`;
  await ensureSkillJwtDir(jwtDir);
  const stat = await Deno.stat(jwtDir);
  assertEquals((stat.mode ?? 0) & 0o777, 0o700);
});

Deno.test("ensureSkillJwtDir - idempotent on an existing directory", async () => {
  const dir = Deno.makeTempDirSync();
  await ensureSkillJwtDir(dir);
  await ensureSkillJwtDir(dir);
  const stat = await Deno.stat(dir);
  assert(stat.isDirectory);
});
