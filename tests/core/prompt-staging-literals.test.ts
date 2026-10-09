// tests/core/prompt-staging-literals.test.ts
//
// Prompt-render consumer tests for the literal-first staging contract
// (make-skill-staging-agent-portable): every payload-staging session type
// (normal message, spontaneous, lurk, self-research, summary, memory
// maintenance, reminder) renders — through the REAL template engine against
// the REAL bundled templates — the literal Skill API session id and the
// absolute staging directory, with NO unexpanded $TMPDIR/$SESSION_ID token
// anywhere in the staging/session-id instruction surface.

import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createTemplateEngine, renderTemplate } from "@core/template-renderer.ts";

const PROMPTS_DIR = join(import.meta.dirname ?? ".", "..", "..", "prompts");

const SESSION_ID = "sess_literal_42";
const STAGING_DIR = "/data/workspaces/discord/123/tmp/sess_literal_42";

const baseVars = {
  isDm: false,
  platform: "discord",
  userId: "u1",
  channelId: "c1",
  guildId: "",
  agentType: "opencode",
  model: "test-model",
};

// The values every payload-staging render supplies (what the orchestrator /
// assembler now pass for sessionId + tmpDir).
const stagingVars = { sessionId: SESSION_ID, tmpDir: STAGING_DIR };

/** Assert the rendered prompt names the literals and carries no shell token. */
function assertLiteralFirst(
  rendered: string,
  label: string,
  opts: { includesPermissionsFragment?: boolean } = {},
): void {
  assertStringIncludes(rendered, SESSION_ID, `${label}: literal session id`);
  assertStringIncludes(rendered, STAGING_DIR, `${label}: absolute staging dir`);
  // Templates that include the agent_permissions.md fragment (message, lurk,
  // spontaneous, self-research, maintenance) legitimately mention `$TMPDIR`
  // there as a PATH-PERMISSION token (row-2/4 boundary semantics, not a
  // staging instruction), so the token-free assertion is scoped to the
  // Session Information staging block — the surface that tells the agent
  // where to write and which `--session-id` to pass. Templates without the
  // fragment (summary, reminder) are asserted whole-text token-free.
  if (opts.includesPermissionsFragment) {
    const block = rendered.match(/Session Information\n+([\s\S]*?)(?=\n#{1,3} |\s*$)/)?.[1] ?? "";
    assertStringIncludes(block, SESSION_ID, `${label}: staging block names literal id`);
    assertStringIncludes(block, STAGING_DIR, `${label}: staging block names absolute dir`);
    assertFalse(block.includes("$TMPDIR"), `${label}: no $TMPDIR in staging block`);
    assertFalse(block.includes("$SESSION_ID"), `${label}: no $SESSION_ID in staging block`);
  } else {
    assertFalse(rendered.includes("$TMPDIR"), `${label}: no $TMPDIR token`);
    assertFalse(rendered.includes("$SESSION_ID"), `${label}: no $SESSION_ID token`);
  }
}

const env = createTemplateEngine(PROMPTS_DIR);

// Normal message + channel lurk: both deliver the prompt rendered from
// system_reply.md via renderFullPrompt/assembleContext with the pair supplied.
for (
  const [label, template] of [
    ["normal message (system_reply.md)", "system_reply.md"],
    ["channel lurk (system_reply.md render)", "system_reply.md"],
  ] as const
) {
  Deno.test(`prompt staging literals - ${label}`, async () => {
    const rendered = await renderTemplate(env, join(PROMPTS_DIR, template), {
      ...baseVars,
      ...stagingVars,
    });
    assertLiteralFirst(rendered, label, { includesPermissionsFragment: true });
  });
}

Deno.test("prompt staging literals - spontaneous (system_spontaneous.md)", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_spontaneous.md"), {
    ...baseVars,
    ...stagingVars,
  });
  assertLiteralFirst(rendered, "spontaneous");
});

Deno.test("prompt staging literals - self-research (system_self_research.md)", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_self_research.md"), {
    ...baseVars,
    rssItems: "- item one",
    ...stagingVars,
  });
  assertLiteralFirst(rendered, "self-research");
});

Deno.test("prompt staging literals - summary (system_summary.md)", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_summary.md"), stagingVars);
  assertLiteralFirst(rendered, "summary");
  // The inline memory-save example is copy-pasteable with the literals.
  assertStringIncludes(rendered, `--session-id ${SESSION_ID}`);
  assertStringIncludes(rendered, `--content-file "${STAGING_DIR}/summary.md"`);
});

Deno.test("prompt staging literals - memory maintenance (system_memory_maintenance.md)", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_memory_maintenance.md"), {
    ...baseVars,
    workspaceKey: "discord/u1",
    memoriesDump: "[]",
    minMemoryCount: 10,
    ...stagingVars,
  });
  assertLiteralFirst(rendered, "memory maintenance");
});

Deno.test("prompt staging literals - scheduled reminder (system_reminder.md)", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reminder.md"), {
    ...baseVars,
    isDm: true,
    reminderMessage: "站会提醒",
    reminderCreatedAt: "2026-10-10T00:00:00Z",
    reminderScheduledAt: "2026-10-10T01:00:00Z",
    ...stagingVars,
  });
  assertLiteralFirst(rendered, "reminder");
});

// The summary/reminder/maintenance templates must not resurrect the tokens
// even when an operator mounts them without the values (fallback forms removed).
Deno.test("prompt staging literals - no token fallback even without the pair", async () => {
  for (const template of ["system_summary.md", "system_reminder.md"]) {
    const rendered = await renderTemplate(env, join(PROMPTS_DIR, template), {
      ...baseVars,
      isDm: true,
      reminderMessage: "x",
      reminderCreatedAt: "",
      reminderScheduledAt: "",
    });
    assertFalse(rendered.includes("$SESSION_ID"), `${template}: no $SESSION_ID fallback`);
    assertFalse(rendered.includes("$TMPDIR"), `${template}: no $TMPDIR fallback`);
  }
});
