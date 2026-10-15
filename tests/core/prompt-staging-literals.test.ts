// tests/core/prompt-staging-literals.test.ts
//
// Rendered + classified-contract tests for the literal trusted skill-script
// root (`render-delivered-skill-root-contract`, extending the literal-first
// staging contract of `make-skill-staging-agent-portable`).
//
// Every classified session type (normal message, channel lurk, spontaneous,
// self-research, summary, user memory maintenance, channel memory maintenance,
// scheduled reminder) renders — through the REAL Vento engine against the REAL
// bundled templates/fragment — the deployment's ONE resolved literal ABSOLUTE
// trusted root (`unify-skill-root-and-inventory`: identical for both agent
// types), the literal Skill API session id and the absolute staging directory,
// with every recipe argument POSIX single-quoted and no unexpanded
// `$TMPDIR`/`$SESSION_ID` token. Dashboard web-chat keeps its skill
// prohibition and acquires no root requirement.
//
// Honesty boundary: these are render- and helper-level property assertions.
// They prove what the delivered TEXT carries (and that a missing root/mounted
// omission fails before delivery) — never that a native agent enforced
// anything. Argument literalness is proved with the repository's own shell
// tokenizer plus a focused POSIX single-quote reader; no shell, agent,
// provider or platform process is launched.
//
// The same real-template renders also carry the delivered conversational
// instruction contract of `condition-harness-context-gathering`: the reply
// memory section owns the context-sufficiency rule exactly once, reply /
// spontaneous-post / dashboard-chat instructions mandate no think-out-loud
// narration, and the dashboard keeps its direct text output and skill
// prohibition. Those assertions are instruction-contract evidence too — they
// never prove a model's tool choices or its internal reasoning.

import { assert, assertEquals, assertFalse, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { tokenizeShellCommand } from "@acp/command-syntax.ts";
import {
  createTemplateEngine,
  renderTemplate,
  renderTemplateString,
} from "@core/template-renderer.ts";
import { assertSkillsRootDelivered, requireTrustedSkillsRoot } from "@core/skills-root.ts";
import { ConfigError, ErrorCode } from "../../src/types/errors.ts";

const PROMPTS_DIR = join(import.meta.dirname ?? ".", "..", "..", "prompts");

const SESSION_ID = "sess_literal_42";
const STAGING_DIR = "/data/workspaces/discord/123/tmp/sess_literal_42";

/**
 * The ONE deployment-resolved skill-script root
 * (`unify-skill-root-and-inventory`): both agent types render this same
 * configured value, so the render contract is proved once instead of once per
 * agent-specific root.
 */
const RESOLVED_SKILLS_ROOT = "/srv/air/skills";

const baseVars = {
  isDm: false,
  platform: "discord",
  userId: "u1",
  channelId: "c1",
  guildId: "",
  agentType: "opencode",
  model: "test-model",
  skillsDir: RESOLVED_SKILLS_ROOT,
};

// The values every payload-staging render supplies (what the orchestrator /
// assembler pass for sessionId + tmpDir).
const stagingVars = { sessionId: SESSION_ID, tmpDir: STAGING_DIR };

/**
 * One whole-token POSIX single-quoted argument, read the way `sh` reads it.
 *
 * Only the grammar the shared formatter emits is accepted: a run of `'…'`
 * segments, an embedded apostrophe appearing as the quote-close / escaped-quote
 * / reopen triple `'\''`, and nothing else. Returns the reconstructed value, or
 * `undefined` when the token is not one balanced literal.
 */
function readPosixSingleQuoted(value: string): string | undefined {
  let out = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "'") return undefined;
    const end = value.indexOf("'", index + 1);
    if (end === -1) return undefined;
    out += value.slice(index + 1, end);
    index = end + 1;
    if (index === value.length) return out;
    if (value[index] !== "\\" || value[index + 1] !== "'") return undefined;
    out += "'";
    index += 2;
  }
  return undefined;
}

/** The complete literal value of one quoted recipe argument on a recipe line. */
function recipeArgument(line: string, flag: string): string {
  const tokens = tokenizeShellCommand(line);
  const index = tokens.indexOf(flag);
  assert(index >= 0, `${flag} present on recipe line: ${line}`);
  const token = tokens[index + 1] ?? "";
  const literal = readPosixSingleQuoted(token);
  assert(literal !== undefined, `${flag} argument is a POSIX single-quoted literal: ${token}`);
  return literal;
}

/**
 * The delivered recipe that invokes one skill script: its line, with
 * `\`-continued lines joined so a multi-line recipe tokenizes as one command.
 * Only the invocation itself counts — the quoted executable must START the
 * line, so a prose mention of the path is never mistaken for a recipe.
 */
function recipeLine(rendered: string, skill: string): string {
  const needle = `/${skill}/scripts/${skill}.ts`;
  const lines = rendered.split("\n");
  const start = lines.findIndex((candidate) =>
    candidate.trimStart().startsWith("'") && candidate.includes(needle)
  );
  assert(start >= 0, `a delivered recipe invokes ${skill}`);
  const parts: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? "";
    parts.push(line.replace(/\\\s*$/, "").trim());
    if (!line.trimEnd().endsWith("\\")) break;
  }
  return parts.join(" ");
}

/** The quoted executable of one delivered recipe line, read as POSIX sh would. */
function recipeExecutable(rendered: string, skill: string): string {
  const tokens = tokenizeShellCommand(recipeLine(rendered, skill));
  const executable = readPosixSingleQuoted(tokens[0] ?? "");
  assert(executable !== undefined, `${skill} recipe executable is one quoted literal`);
  return executable ?? "";
}

/** Assert the rendered prompt names the literals and carries no shell token. */
function assertLiteralFirst(
  rendered: string,
  label: string,
  opts: { includesPermissionsFragment?: boolean } = {},
): void {
  assertStringIncludes(rendered, SESSION_ID, `${label}: literal session id`);
  assertStringIncludes(rendered, STAGING_DIR, `${label}: absolute staging dir`);
  assertStringIncludes(
    rendered,
    "## Skill Script Root",
    `${label}: delivered skills-root contract section`,
  );
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

/**
 * Assert one classified render delivered the literal root and no unresolved
 * render artifact.
 *
 * `$HOME` appears ONLY as the fragment's warning prose; the assertion that the
 * root is never DERIVED from HOME is scoped to the delivered recipe lines.
 */
function assertRootContract(rendered: string, root: string, label: string): void {
  const rootSection = rendered.slice(rendered.indexOf("## Skill Script Root"));
  assertStringIncludes(rootSection, root, `${label}: root section carries the literal root`);
  assertFalse(rootSection.includes("undefined"), `${label}: no missing-root placeholder`);
  for (const artifact of ["{{ skillsDir }}", "{{ quoteShellArgument", "{{ skillScript"]) {
    assertFalse(rendered.includes(artifact), `${label}: no unresolved ${artifact}`);
  }
  for (
    const line of rendered.split("\n").filter((candidate) => candidate.includes("/scripts/"))
  ) {
    assertFalse(
      line.includes("$HOME") || line.includes("${HOME}"),
      `${label}: recipe not HOME-derived`,
    );
  }
}

const env = createTemplateEngine(PROMPTS_DIR);

// Every classified render, at the single root every agent type resolves.
for (const root of [RESOLVED_SKILLS_ROOT]) {
  for (
    const [label, template, vars] of [
      ["normal message (system_reply.md)", "system_reply.md", { userContextMessage: "hi" }],
      ["channel lurk (system_reply.md render)", "system_reply.md", { userContextMessage: "hi" }],
      ["spontaneous (system_spontaneous.md)", "system_spontaneous.md", {}],
      ["self-research (system_self_research.md)", "system_self_research.md", { rssItems: "- one" }],
      ["summary (system_summary.md)", "system_summary.md", {}],
      [
        "user memory maintenance (system_memory_maintenance.md)",
        "system_memory_maintenance.md",
        { workspaceKey: "discord/u1", memoriesDump: "[]", minMemoryCount: 10 },
      ],
      [
        "channel memory maintenance (system_memory_maintenance.md, inline render)",
        "system_memory_maintenance.md",
        {
          isDm: false,
          workspaceKey: "channel:discord/123",
          memoriesDump: "[]",
          minMemoryCount: 10,
        },
      ],
      [
        "scheduled reminder (system_reminder.md)",
        "system_reminder.md",
        {
          isDm: true,
          reminderMessage: "站會提醒",
          reminderCreatedAt: "2026-10-10T00:00:00Z",
          reminderScheduledAt: "2026-10-10T01:00:00Z",
        },
      ],
    ] as const
  ) {
    Deno.test(`prompt skills root - ${label} @ ${root}`, async () => {
      const rendered = await renderTemplate(env, join(PROMPTS_DIR, template), {
        ...baseVars,
        skillsDir: root,
        ...vars,
        ...stagingVars,
      });
      // Only `system_summary.md` has no `Session Information` staging heading
      // (its recipe is a self-contained Usage example), so its token-free
      // assertion covers the whole text instead of the staging block.
      assertLiteralFirst(rendered, `${label} @ ${root}`, {
        includesPermissionsFragment: template !== "system_summary.md",
      });
      assertRootContract(rendered, root, `${label} @ ${root}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Quoted complete executable + payload arguments (pointer-only payload flags)
// ---------------------------------------------------------------------------

Deno.test("prompt skills root - reply recipe quotes the complete executable and arguments", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reply.md"), {
    ...baseVars,
    ...stagingVars,
    userContextMessage: "hi",
  });
  const line = recipeLine(rendered, "send-reply");
  assertEquals(
    recipeExecutable(rendered, "send-reply"),
    `${RESOLVED_SKILLS_ROOT}/send-reply/scripts/send-reply.ts`,
  );
  assertEquals(recipeArgument(line, "--session-id"), SESSION_ID);
  assertEquals(recipeArgument(line, "--message-file"), `${STAGING_DIR}/reply.md`);
  // Pointer-only: the free text never reaches the command line.
  assertFalse(line.includes("hi"), "reply text stays in the payload file");
});

Deno.test("prompt skills root - spontaneous post recipe quotes the complete executable", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_spontaneous.md"), {
    ...baseVars,
    ...stagingVars,
  });
  const line = recipeLine(rendered, "send-reply");
  assertEquals(
    recipeExecutable(rendered, "send-reply"),
    `${RESOLVED_SKILLS_ROOT}/send-reply/scripts/send-reply.ts`,
  );
  assertEquals(recipeArgument(line, "--message-file"), `${STAGING_DIR}/reply.md`);
});

Deno.test("prompt skills root - reminder recipe quotes the complete executable", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reminder.md"), {
    ...baseVars,
    isDm: true,
    reminderMessage: "站會提醒",
    reminderCreatedAt: "2026-10-10T00:00:00Z",
    reminderScheduledAt: "2026-10-10T01:00:00Z",
    ...stagingVars,
  });
  const line = recipeLine(rendered, "send-reply");
  assertEquals(
    recipeExecutable(rendered, "send-reply"),
    `${RESOLVED_SKILLS_ROOT}/send-reply/scripts/send-reply.ts`,
  );
  assertEquals(recipeArgument(line, "--session-id"), SESSION_ID);
  assertEquals(recipeArgument(line, "--message-file"), `${STAGING_DIR}/reply.md`);
});

Deno.test("prompt skills root - summary recipe quotes memory-save and its content file", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_summary.md"), {
    ...baseVars,
    ...stagingVars,
  });
  const line = recipeLine(rendered, "memory-save");
  assertEquals(
    recipeExecutable(rendered, "memory-save"),
    `${RESOLVED_SKILLS_ROOT}/memory-save/scripts/memory-save.ts`,
  );
  assertEquals(recipeArgument(line, "--session-id"), SESSION_ID);
  assertEquals(recipeArgument(line, "--content-file"), `${STAGING_DIR}/summary.md`);
});

Deno.test("prompt skills root - maintenance recipe quotes memory-save and its content file", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_memory_maintenance.md"), {
    ...baseVars,
    workspaceKey: "discord/u1",
    memoriesDump: "[]",
    minMemoryCount: 10,
    ...stagingVars,
  });
  const line = recipeLine(rendered, "memory-save");
  assertEquals(
    recipeExecutable(rendered, "memory-save"),
    `${RESOLVED_SKILLS_ROOT}/memory-save/scripts/memory-save.ts`,
  );
  assertEquals(recipeArgument(line, "--content-file"), `${STAGING_DIR}/memory.md`);
  // The patch script is named with the same complete, quoted path.
  assertStringIncludes(
    rendered,
    `'${RESOLVED_SKILLS_ROOT}/memory-patch/scripts/memory-patch.ts'`,
  );
  // No reply capability is added to a maintenance session.
  assertFalse(rendered.includes("send-reply/scripts/send-reply.ts"));
});

// ---------------------------------------------------------------------------
// Root / staging values with spaces and shell characters stay literal
// ---------------------------------------------------------------------------

for (
  const [label, hostileValue] of [
    ["space", "/opt/air/my skills"],
    ["apostrophe", "/opt/air/ro'ot"],
    ["dollar", "/opt/air/a$b"],
    ["backtick", "/opt/air/a`b"],
    ["double quote", '/opt/air/a"b'],
  ] as const
) {
  Deno.test(`prompt skills root - a root with a ${label} stays one literal argument`, async () => {
    const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reply.md"), {
      ...baseVars,
      skillsDir: hostileValue,
      ...stagingVars,
      userContextMessage: "hi",
    });
    const line = recipeLine(rendered, "send-reply");
    assertStringIncludes(rendered, hostileValue, `${label}: literal root rendered`);
    // The whole executable is ONE shell token, read back verbatim.
    assertEquals(tokenizeShellCommand(line).length > 0, true);
    assertEquals(
      recipeExecutable(rendered, "send-reply"),
      `${hostileValue}/send-reply/scripts/send-reply.ts`,
    );
    assertEquals(recipeArgument(line, "--message-file"), `${STAGING_DIR}/reply.md`);
    // No expansion operator is introduced by the quoting: the value is literal.
    assertFalse(line.includes("${HOME}"), `${label}: no HOME expansion`);
  });
}

Deno.test("prompt skills root - a staging dir with a space stays one literal argument", async () => {
  const staging = "/data/my workspaces/discord/123/tmp/sess_literal_42";
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reply.md"), {
    ...baseVars,
    sessionId: SESSION_ID,
    tmpDir: staging,
    userContextMessage: "hi",
  });
  const line = recipeLine(rendered, "send-reply");
  assertEquals(recipeArgument(line, "--message-file"), `${staging}/reply.md`);
});

// ---------------------------------------------------------------------------
// Missing / empty / relative root fails explicitly; a mounted template that
// renders without the literal root fails before delivery
// ---------------------------------------------------------------------------

Deno.test("prompt skills root - required root validation rejects absent, empty and relative roots", () => {
  for (
    const [label, value] of [
      ["absent", undefined],
      ["null", null],
      ["empty", ""],
      ["relative", "skills"],
      ["relative parent", "../skills"],
    ] as const
  ) {
    const error = assertThrows(
      () => requireTrustedSkillsRoot(value, "test classified render"),
      ConfigError,
      undefined,
      `${label} root must fail`,
    ) as ConfigError;
    assertEquals(error.code, ErrorCode.CONFIG_INVALID);
    assertStringIncludes(error.message, "test classified render");
  }
  // A validated absolute root is returned unchanged — no HOME expansion.
  assertEquals(requireTrustedSkillsRoot(RESOLVED_SKILLS_ROOT, "test"), RESOLVED_SKILLS_ROOT);
});

Deno.test("prompt skills root - a mounted classified template without the root fails before delivery", async () => {
  // An operator-mounted classified template that never interpolates the root
  // (the pre-change bundled shape) renders a rootless prompt.
  const rootless = await renderTemplateString(
    env,
    "You are a helpful assistant.\n\n{{ if tmpDir }}Staging: {{ tmpDir }}{{ /if }}",
    { ...stagingVars } as unknown as Record<string, unknown>,
  );
  const error = assertThrows(
    () => assertSkillsRootDelivered(rootless, RESOLVED_SKILLS_ROOT, "mounted template delivery"),
    ConfigError,
  ) as ConfigError;
  assertEquals(error.code, ErrorCode.CONFIG_INVALID);
  assertStringIncludes(error.message, RESOLVED_SKILLS_ROOT);
  assertStringIncludes(error.message, "mounted template delivery");
});

// The summary/reminder/maintenance templates must not resurrect the tokens
// even when an operator mounts them without the staging pair (fallback forms
// removed). The trusted root is still supplied: a classified render always
// resolves one.
Deno.test("prompt skills root - no staging token fallback even without the pair", async () => {
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
    assertRootContract(
      rendered,
      RESOLVED_SKILLS_ROOT,
      `${template}: root present without the pair`,
    );
  }
});

// A Skill-API-disabled session has NO literal session id: the recipe block is
// omitted (it cannot name an id the skill library would honor) instead of
// rendering an empty or placeholder argument, and the render must not fail.
Deno.test("prompt skills root - summary without a session id renders the root and omits the recipe", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_summary.md"), {
    ...baseVars,
    tmpDir: STAGING_DIR,
  });
  assertRootContract(rendered, RESOLVED_SKILLS_ROOT, "summary without session id");
  // The named script path and the flag documentation stay (they describe the
  // root's own layout), but the two-step INVOCATION is omitted: with no id to
  // pass there is no runnable command.
  assertFalse(rendered.includes("--importance normal"), "no recipe parameters without an id");
  assertFalse(rendered.includes("--content-file "), "no payload-file invocation without an id");
  assertFalse(
    rendered.split("\n").some((line) => line.startsWith("'")),
    "no quoted invocation is offered without a literal session id",
  );
});

// ---------------------------------------------------------------------------
// Dashboard web-chat and generic renders acquire nothing
// ---------------------------------------------------------------------------

Deno.test("prompt skills root - dashboard web-chat keeps its skill prohibition and acquires no recipe", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_web_chat.md"), {
    ...baseVars,
    isDm: true,
  });
  assertStringIncludes(rendered, "These skills are not available in this mode.");
  assertFalse(rendered.includes("## Skill Script Root"), "web-chat gets no skills-root section");
  assertFalse(rendered.includes("/scripts/"), "web-chat gets no skill invocation recipe");
});

Deno.test("prompt skills root - a generic render needs no root and gains no recipe", async () => {
  const rendered = await renderTemplateString(env, "Generic {{ label }} prompt.", {
    label: "assistant",
  });
  assertEquals(rendered, "Generic assistant prompt.");
  assertFalse(rendered.includes("Skill Script Root"));
});

// ---------------------------------------------------------------------------
// Delivered conversational instruction contract
// (`condition-harness-context-gathering`)
//
// The reply memory section owns the information-gathering decision; a render
// with adequate supplied context still delivers the missing-history and
// explicit-recall directions, and neither the reply template nor the
// spontaneous-post and dashboard-chat sections mandate narration. The
// spontaneous workflow deliberately keeps its own notes-gathering step, which
// the reply gathering rule does not govern.
// ---------------------------------------------------------------------------

/** The one owning sufficiency permission the reply memory section must carry once. */
const CONTEXT_SUFFICIENCY_RULE = "reply directly in character without gathering anything further";

/** The missing-history direction the same section owns. */
const MISSING_HISTORY_TRIGGER = "missing from the supplied context and recent messages";

/** A greeting whose supplied context suffices for a first reply. */
const GREETING_CONTEXT = "[User] 早安！今天過得好嗎？";

/** A request whose answer needs history absent from the supplied context. */
const MISSING_HISTORY_CONTEXT = "[User] 你還記得我們上週決定的專案方向嗎？";

/** The `# Instructions` … `## Critical Rules` slice of one reply render. */
function instructionSection(rendered: string): string {
  const start = rendered.indexOf("# Instructions");
  assert(start >= 0, "render carries the `# Instructions` section");
  const end = rendered.indexOf("## Critical Rules", start);
  assert(end > start, "render carries `## Critical Rules` after the instruction section");
  return rendered.slice(start, end);
}

/** Assert one reply render delivers the single conditional retrieval contract. */
function assertRetrievalContract(rendered: string, label: string): void {
  const instructions = instructionSection(rendered);
  assertEquals(
    instructions.split(CONTEXT_SUFFICIENCY_RULE).length - 1,
    1,
    `${label}: the memory section owns the context-sufficiency rule exactly once`,
  );
  assertEquals(
    instructions.split('skill({ name: "memory-search" })').length - 1,
    1,
    `${label}: the memory section owns the retrieval directive exactly once`,
  );
  assertStringIncludes(
    instructions,
    MISSING_HISTORY_TRIGGER,
    `${label}: missing-history direction`,
  );
  assertStringIncludes(
    instructions,
    "the user explicitly asks you to recall past events",
    `${label}: explicit-recall direction`,
  );
  assertStringIncludes(instructions, "--category", `${label}: category filter retained`);
  assertStringIncludes(instructions, "--scope", `${label}: scope filter retained`);
  assertStringIncludes(
    instructions,
    'the workspace notes check in "Your Personal Workspace" above is subject to the same condition',
    `${label}: sufficiency condition governs the workspace notes check`,
  );
  assertFalse(
    rendered.includes("Always use skills to gather enough information"),
    `${label}: no unconditional gathering bullet`,
  );
  assertFalse(
    rendered.includes("**Gather information**"),
    `${label}: no duplicate critical gathering rule`,
  );
  assertStringIncludes(
    rendered,
    '**ALWAYS follow the skill({ name: "send-reply" }) instructions to send your final response**',
    `${label}: mandatory delivery instruction retained`,
  );
  // `clarify-delivery-recovery-guidance` owns this sentence and will replace
  // it: update this expectation with that change instead of treating the
  // failure as a regression.
  assertStringIncludes(
    rendered,
    '- **No second attempt**: If you fail to send the reply or if the script encounters an error, you won\'t get a second chance to send another reply. Make sure your message is final and well-crafted before executing this skill({ name: "send-reply" }).',
    `${label}: no-second-attempt rule untouched`,
  );
  assertStringIncludes(rendered, "**Review in character**", `${label}: in-character reply review`);
  assertStringIncludes(rendered, "**Check before you send**", `${label}: pre-send review retained`);
  assertStringIncludes(rendered, "**Save information**", `${label}: memory saving retained`);
  assertStringIncludes(
    instructions,
    'skill({ name: "memory-patch" })',
    `${label}: memory correction retained`,
  );
  for (const mandate of ["Think out loud", "**Think first**", "**Think before you send**"]) {
    assertFalse(rendered.includes(mandate), `${label}: no ${mandate} narration mandate`);
  }
  assertFalse(rendered.includes("YOUR thought process"), `${label}: no narrated thought process`);
}

for (const agentType of ["opencode", "omp"] as const) {
  for (const yolo of [false, true] as const) {
    const label = `reply ${agentType} ${yolo ? "YOLO" : "restricted"}`;
    Deno.test(`prompt instructions - ${label} owns one conditional retrieval rule`, async () => {
      const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reply.md"), {
        ...baseVars,
        agentType,
        yolo,
        ...stagingVars,
        userContextMessage: GREETING_CONTEXT,
      });
      assertRetrievalContract(rendered, label);
      // Variant gating is untouched: the OMP-only shell section and the
      // restricted-only capability section keep their exact conditions.
      assertEquals(rendered.includes("## OMP Shell Usage"), agentType === "omp", label);
      assertEquals(rendered.includes("## Agent Capabilities"), !yolo, label);
    });
  }
}

Deno.test("prompt instructions - the retrieval rule follows context sufficiency, not message text", async () => {
  const render = (userContextMessage: string) =>
    renderTemplate(env, join(PROMPTS_DIR, "system_reply.md"), {
      ...baseVars,
      ...stagingVars,
      userContextMessage,
    });
  const greeting = await render(GREETING_CONTEXT);
  const missingHistory = await render(MISSING_HISTORY_CONTEXT);
  // Channel-lurk replies reuse `system_reply.md`; that shape renders the same
  // instruction section.
  const channelLurk = await render(
    `${MISSING_HISTORY_CONTEXT}\n\n## Relevant Channel Notes\n- [from c1] earlier channel topic`,
  );

  // The fixture really reached the render, so the equality below compares two
  // populated contexts rather than two dropped ones.
  assertStringIncludes(greeting, GREETING_CONTEXT);
  assertStringIncludes(missingHistory, MISSING_HISTORY_CONTEXT);
  assertEquals(
    instructionSection(greeting),
    instructionSection(missingHistory),
    "greeting and missing-history renders deliver identical instructions",
  );
  assertEquals(
    instructionSection(greeting),
    instructionSection(channelLurk),
    "the lurk render delivers identical instructions",
  );
  // No hard-coded greeting branch: the fixture's own greeting text never
  // reaches the instruction section, yet the recall directions stay delivered.
  assertFalse(
    instructionSection(greeting).includes("早安"),
    "no greeting string in the instructions",
  );
  assertStringIncludes(instructionSection(missingHistory), CONTEXT_SUFFICIENCY_RULE);
  assertStringIncludes(instructionSection(missingHistory), MISSING_HISTORY_TRIGGER);
});

Deno.test("prompt instructions - spontaneous posting keeps its purpose without narration mandates", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_spontaneous.md"), {
    ...baseVars,
    ...stagingVars,
  });
  assertStringIncludes(
    rendered,
    "### 2. Pick ONE topic that interests YOU",
    "topic selection retained",
  );
  assertStringIncludes(
    rendered,
    "Craft a post in your own voice",
    "character-authored posting retained",
  );
  assertStringIncludes(
    rendered,
    'Use the skill({ name: "send-reply" }) to post your content',
    "delivery retained",
  );
  for (const mandate of ["Think out loud", "**Think first**", "**Think before you send**"]) {
    assertFalse(rendered.includes(mandate), `spontaneous: no ${mandate} narration mandate`);
  }
});

Deno.test("prompt instructions - dashboard chat stays direct and skill-free without narration mandates", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_web_chat.md"), {
    ...baseVars,
    isDm: true,
  });
  assertStringIncludes(
    rendered,
    "These skills are not available in this mode.",
    "dashboard skill prohibition retained",
  );
  assertStringIncludes(rendered, "**Respond directly**", "direct text output retained");
  assertStringIncludes(rendered, "**Review in character**", "in-character review retained");
  assertFalse(rendered.includes("## Skill Script Root"), "no skills root");
  for (const mandate of ["Think out loud", "**Think first**", "**Think before you send**"]) {
    assertFalse(rendered.includes(mandate), `dashboard: no ${mandate} narration mandate`);
  }
  assertFalse(rendered.includes("YOUR thought process"), "dashboard: no narrated thought process");
});
