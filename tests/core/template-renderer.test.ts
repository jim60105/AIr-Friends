// tests/core/template-renderer.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import {
  createTemplateEngine,
  renderTemplate,
  renderTemplateString,
} from "@core/template-renderer.ts";
import { ConfigError } from "../../src/types/errors.ts";

Deno.test("renderTemplateString - basic variable interpolation", async () => {
  const env = createTemplateEngine(".");
  const result = await renderTemplateString(env, "Hello {{ name }}", { name: "World" });
  assertEquals(result, "Hello World");
});

Deno.test("renderTemplateString - conditional rendering with isDm", async () => {
  const env = createTemplateEngine(".");
  const template = `{{ if isDm }}DM mode{{ else }}Public mode{{ /if }}`;

  const dmResult = await renderTemplateString(env, template, { isDm: true });
  assertEquals(dmResult, "DM mode");

  const publicResult = await renderTemplateString(env, template, { isDm: false });
  assertEquals(publicResult, "Public mode");
});

Deno.test("renderTemplateString - platform variable", async () => {
  const env = createTemplateEngine(".");
  const template = `Platform: {{ platform }}`;
  const result = await renderTemplateString(env, template, { platform: "discord" });
  assertEquals(result, "Platform: discord");
});

Deno.test("renderTemplateString - platform conditional", async () => {
  const env = createTemplateEngine(".");
  const template =
    `{{ if platform === "discord" }}Discord{{ else if platform === "misskey" }}Misskey{{ /if }}`;

  const discord = await renderTemplateString(env, template, { platform: "discord" });
  assertEquals(discord, "Discord");

  const misskey = await renderTemplateString(env, template, { platform: "misskey" });
  assertEquals(misskey, "Misskey");
});

Deno.test("renderTemplateString - set and reuse variable", async () => {
  const env = createTemplateEngine(".");
  const template = `{{- set greeting }}Hello{{ /set -}}\n{{ greeting }}, {{ greeting }}!`;
  const result = await renderTemplateString(env, template, {});
  assertEquals(result, "Hello, Hello!");
});

Deno.test("renderTemplateString - trimming whitespace", async () => {
  const env = createTemplateEngine(".");
  const result = await renderTemplateString(env, "  Hello World  ", {});
  assertEquals(result, "Hello World");
});

Deno.test("renderTemplate - renders file with variables", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/test.md`, "Hello {{ name }}!");
    const env = createTemplateEngine(tempDir);
    const result = await renderTemplate(env, `${tempDir}/test.md`, { name: "Yuna" });
    assertEquals(result, "Hello Yuna!");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("renderTemplate - include works", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/fragment.md`, "World");
    await Deno.writeTextFile(
      `${tempDir}/main.md`,
      '{{- set name }}{{ include "./fragment.md" }}{{ /set -}}\nHello {{ name }}!',
    );
    const env = createTemplateEngine(tempDir);
    const result = await renderTemplate(env, `${tempDir}/main.md`, {});
    assertEquals(result, "Hello World!");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("renderTemplate - throws ConfigError on missing file", async () => {
  const env = createTemplateEngine(".");
  await assertRejects(
    () => renderTemplate(env, "/nonexistent/path.md", {}),
    ConfigError,
  );
});

Deno.test("renderTemplateString - JavaScript expressions", async () => {
  const env = createTemplateEngine(".");
  const template = `{{ isDm ? "Private" : "Public" }}`;
  const result = await renderTemplateString(env, template, { isDm: true });
  assertEquals(result, "Private");
});

Deno.test("renderTemplateString - optional variables render empty when undefined", async () => {
  const env = createTemplateEngine(".");
  const template = `{{ if rssItems }}{{ rssItems }}{{ else }}No items{{ /if }}`;
  const result = await renderTemplateString(env, template, {});
  assertEquals(result, "No items");
});

Deno.test("renderTemplateString - Vento comment syntax", async () => {
  const env = createTemplateEngine(".");
  const template = `{{# This is a comment #}}Hello`;
  const result = await renderTemplateString(env, template, {});
  assertEquals(result, "Hello");
});
