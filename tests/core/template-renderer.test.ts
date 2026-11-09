// tests/core/template-renderer.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import {
  createTemplateEngine,
  renderTemplate,
  renderTemplateString,
} from "@core/template-renderer.ts";
import { ConfigError } from "../../src/types/errors.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

test("renderTemplateString - basic variable interpolation", async () => {
  const env = createTemplateEngine(".");
  const result = await renderTemplateString(env, "Hello {{ name }}", { name: "World" });
  assertEquals(result, "Hello World");
});

test("renderTemplateString - conditional rendering with isDm", async () => {
  const env = createTemplateEngine(".");
  const template = `{{ if isDm }}DM mode{{ else }}Public mode{{ /if }}`;

  const dmResult = await renderTemplateString(env, template, { isDm: true });
  assertEquals(dmResult, "DM mode");

  const publicResult = await renderTemplateString(env, template, { isDm: false });
  assertEquals(publicResult, "Public mode");
});

test("renderTemplateString - platform variable", async () => {
  const env = createTemplateEngine(".");
  const template = `Platform: {{ platform }}`;
  const result = await renderTemplateString(env, template, { platform: "discord" });
  assertEquals(result, "Platform: discord");
});

test("renderTemplateString - platform conditional", async () => {
  const env = createTemplateEngine(".");
  const template =
    `{{ if platform === "discord" }}Discord{{ else if platform === "misskey" }}Misskey{{ /if }}`;

  const discord = await renderTemplateString(env, template, { platform: "discord" });
  assertEquals(discord, "Discord");

  const misskey = await renderTemplateString(env, template, { platform: "misskey" });
  assertEquals(misskey, "Misskey");
});

test("renderTemplateString - set and reuse variable", async () => {
  const env = createTemplateEngine(".");
  const template = `{{- set greeting }}Hello{{ /set -}}\n{{ greeting }}, {{ greeting }}!`;
  const result = await renderTemplateString(env, template, {});
  assertEquals(result, "Hello, Hello!");
});

test("renderTemplateString - trimming whitespace", async () => {
  const env = createTemplateEngine(".");
  const result = await renderTemplateString(env, "  Hello World  ", {});
  assertEquals(result, "Hello World");
});

test("renderTemplate - renders file with variables", async () => {
  const tempDir = await makeTempDir();
  try {
    await fsp.writeFile(`${tempDir}/test.md`, "Hello {{ name }}!");
    const env = createTemplateEngine(tempDir);
    const result = await renderTemplate(env, `${tempDir}/test.md`, { name: "Yuna" });
    assertEquals(result, "Hello Yuna!");
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("renderTemplate - include works", async () => {
  const tempDir = await makeTempDir();
  try {
    await fsp.writeFile(`${tempDir}/fragment.md`, "World");
    await fsp.writeFile(
      `${tempDir}/main.md`,
      '{{- set name }}{{ include "./fragment.md" }}{{ /set -}}\nHello {{ name }}!',
    );
    const env = createTemplateEngine(tempDir);
    const result = await renderTemplate(env, `${tempDir}/main.md`, {});
    assertEquals(result, "Hello World!");
  } finally {
    await fsp.rm(tempDir, { recursive: true });
  }
});

test("renderTemplate - throws ConfigError on missing file", async () => {
  const env = createTemplateEngine(".");
  await assertRejects(
    () => renderTemplate(env, "/nonexistent/path.md", {}),
    ConfigError,
  );
});

test("renderTemplateString - JavaScript expressions", async () => {
  const env = createTemplateEngine(".");
  const template = `{{ isDm ? "Private" : "Public" }}`;
  const result = await renderTemplateString(env, template, { isDm: true });
  assertEquals(result, "Private");
});

test("renderTemplateString - optional variables render empty when undefined", async () => {
  const env = createTemplateEngine(".");
  const template = `{{ if rssItems }}{{ rssItems }}{{ else }}No items{{ /if }}`;
  const result = await renderTemplateString(env, template, {});
  assertEquals(result, "No items");
});

test("renderTemplateString - Vento comment syntax", async () => {
  const env = createTemplateEngine(".");
  const template = `{{# This is a comment #}}Hello`;
  const result = await renderTemplateString(env, template, {});
  assertEquals(result, "Hello");
});

// ============ canWriteAgentWorkspace Template Variable Tests ============

test("canWriteAgentWorkspace - true with yolo false shows write instructions", async () => {
  const env = createTemplateEngine(".");
  const template =
    `{{ if !(yolo || canWriteAgentWorkspace) }}read-only{{ else }}write-enabled{{ /if }}`;
  const result = await renderTemplateString(env, template, {
    yolo: false,
    canWriteAgentWorkspace: true,
  });
  assertEquals(result, "write-enabled");
});

test("canWriteAgentWorkspace - false with yolo false shows read-only", async () => {
  const env = createTemplateEngine(".");
  const template =
    `{{ if !(yolo || canWriteAgentWorkspace) }}read-only{{ else }}write-enabled{{ /if }}`;
  const result = await renderTemplateString(env, template, {
    yolo: false,
    canWriteAgentWorkspace: false,
  });
  assertEquals(result, "read-only");
});

test("canWriteAgentWorkspace - false with yolo true shows write instructions", async () => {
  const env = createTemplateEngine(".");
  const template =
    `{{ if !(yolo || canWriteAgentWorkspace) }}read-only{{ else }}write-enabled{{ /if }}`;
  const result = await renderTemplateString(env, template, {
    yolo: true,
    canWriteAgentWorkspace: false,
  });
  assertEquals(result, "write-enabled");
});

test("canWriteAgentWorkspace - undefined with yolo false shows read-only (backward compat)", async () => {
  const env = createTemplateEngine(".");
  const template =
    `{{ if !(yolo || canWriteAgentWorkspace) }}read-only{{ else }}write-enabled{{ /if }}`;
  const result = await renderTemplateString(env, template, {
    yolo: false,
  });
  assertEquals(result, "read-only");
});
