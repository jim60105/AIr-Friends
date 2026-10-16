// tests/core/prompt-permission-guidance.test.ts
//
// Delivered-prompt regression matrix for `scope-agent-permission-guidance`:
// bundled capability/browser/OMP-shell instructions are rendered through the REAL
// Vento engine against the REAL bundled templates and fragments for both engines
// crossed with both modes, plus both shared-workspace write authorizations where
// the capability fragment appears.
//
// What these assertions establish (and what they do NOT): they prove the TEXT
// delivered to the agent scopes its permission claims to the selected engine and
// effective mode — restricted wording keeps the real command/operator/path rules
// (including the tolerated `2>&1`/`1>&2` standard-stream fd redirects), OpenCode's
// pre-gate denial list appears only for OpenCode, OMP never attributes the upstream
// policy to OpenCode, and YOLO wording carries no restricted shell-denial claim.
// They never prove that a native engine accepted or rejected any actual command;
// no shell, agent, provider or platform process is launched.

import { assert, assertFalse, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createTemplateEngine, renderTemplate } from "@core/template-renderer.ts";

const PROMPTS_DIR = join(import.meta.dirname ?? ".", "..", "..", "prompts");
const SKILLS_ROOT = "/srv/air/skills";
const SESSION_ID = "sess_permissions_1";
const STAGING_DIR = "/data/workspaces/discord/123/tmp/sess_permissions_1";

const env = createTemplateEngine(PROMPTS_DIR);

/**
 * Every existing entry template that includes one of the edited fragments:
 * `system_reply.md` carries the capability + browser + OMP fragments,
 * `system_spontaneous.md` and `system_self_research.md` carry the browser and OMP
 * fragments. `rssItems` is only supplied where the template reads it.
 */
const ENTRY_TEMPLATES = [
  { label: "reply", template: "system_reply.md", vars: {}, hasCapability: true },
  { label: "spontaneous", template: "system_spontaneous.md", vars: {}, hasCapability: false },
  {
    label: "self-research",
    template: "system_self_research.md",
    vars: { rssItems: "- one" },
    hasCapability: false,
  },
] as const;

/** The agent-visible slice of the fragment under test, or the whole render. */
function render(entry: (typeof ENTRY_TEMPLATES)[number], vars: Record<string, unknown>) {
  return renderTemplate(env, join(PROMPTS_DIR, entry.template), {
    isDm: false,
    platform: "discord",
    userId: "u1",
    channelId: "c1",
    guildId: "",
    model: "test-model",
    skillsDir: SKILLS_ROOT,
    sessionId: SESSION_ID,
    tmpDir: STAGING_DIR,
    ...entry.vars,
    ...vars,
  });
}

// ---------------------------------------------------------------------------
// Restricted mode: the real restrictions stay, scoped to the selected engine
// ---------------------------------------------------------------------------

for (const entry of ENTRY_TEMPLATES) {
  for (const agentType of ["opencode", "omp"] as const) {
    Deno.test(`permission guidance - ${entry.label} restricted ${agentType}`, async () => {
      const rendered = await render(entry, { agentType, yolo: false });
      const label = `${entry.label} restricted ${agentType}`;

      // The browser workflow and its fallback survive in every mode.
      assertStringIncludes(rendered, "## Browser Automation", label);
      assertStringIncludes(rendered, "agent-browser close", label);
      assertStringIncludes(rendered, "403 or 429", label);
      assertStringIncludes(rendered, "Multi-command rule", label);
      assertStringIncludes(rendered, "always rejected", label);
      // The tolerated fd redirects are distinguished from the rejected ones.
      assertStringIncludes(rendered, "`2>&1`", label);
      assertStringIncludes(rendered, "writes no file and is tolerated", label);

      // Restricted wording is never described as read-only.
      assertFalse(rendered.includes("Only read-only operations"), label);

      if (entry.hasCapability) {
        assertStringIncludes(rendered, "## Agent Capabilities", label);
        assertStringIncludes(rendered, "**Allowed bash commands:**", label);
        assertStringIncludes(rendered, "`jq`", label);
        assertStringIncludes(rendered, "individually allowed", label);
        assertStringIncludes(rendered, "`> file`, `2>/dev/null`", label);
        assertStringIncludes(rendered, "newline separators", label);
        assertStringIncludes(rendered, "`git`, `echo`, `mkdir`, `curl`, and `rm`", label);
      }

      if (agentType === "opencode") {
        assertFalse(rendered.includes("## OMP Shell Usage"), label);
        if (entry.hasCapability) {
          // OpenCode's own pre-gate denials remain, named as OpenCode's.
          assertStringIncludes(
            rendered,
            "Commands denied by OpenCode before the permission gate",
            label,
          );
          assertStringIncludes(rendered, "`echo`", label);
          assertStringIncludes(rendered, "`strace`", label);
          // `||` itself is not the denial — the attribution is to `echo`, and the
          // allowed-when-qualifying form is stated rather than called impossible.
          assertStringIncludes(rendered, "fails because `echo` is denied", label);
          assertStringIncludes(
            rendered,
            "`||` itself is allowed when every command in the chain qualifies",
            label,
          );
        } else {
          // Without the capability fragment there is no command-policy prose at all.
          assertFalse(rendered.includes("Commands denied by OpenCode"), label);
        }
      } else {
        assertStringIncludes(rendered, "## OMP Shell Usage", label);
        assertStringIncludes(rendered, "language-server (LSP) tool is denied", label);
        assertStringIncludes(rendered, "omit `name`, `ready`, and `async`", label);
        assertStringIncludes(rendered, "completion notice", label);
        // OMP never attributes its session policy to OpenCode.
        assertFalse(rendered.includes("OpenCode"), label);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Restricted shared-workspace write authorization (capability fragment only)
// ---------------------------------------------------------------------------

for (const canWriteAgentWorkspace of [false, true]) {
  Deno.test(
    `permission guidance - reply restricted shared-workspace writes authorized=${canWriteAgentWorkspace}`,
    async () => {
      const rendered = await render(ENTRY_TEMPLATES[0], {
        agentType: "opencode",
        yolo: false,
        canWriteAgentWorkspace,
      });
      const label = `shared-workspace writes authorized=${canWriteAgentWorkspace}`;
      assertFalse(rendered.includes("Only read-only operations"), label);
      // Staging writes are always permitted in restricted mode.
      assertStringIncludes(rendered, "writes into this session's staging directory", label);
      if (canWriteAgentWorkspace) {
        assertStringIncludes(rendered, "Writes to the shared agent workspace are permitted", label);
        assertStringIncludes(rendered, "allowed-extension policy", label);
        assertFalse(
          rendered.includes("shared agent workspace is read-only"),
          `${label}: an authorized session is not told the workspace is read-only`,
        );
      } else {
        assertStringIncludes(rendered, "shared agent workspace is read-only", label);
        assertFalse(
          rendered.includes("Writes to the shared agent workspace are permitted"),
          `${label}: no shared-workspace write grant without authorization`,
        );
      }
    },
  );
}

// ---------------------------------------------------------------------------
// YOLO: no restricted shell claims, no blanket permission claim
// ---------------------------------------------------------------------------

for (const entry of ENTRY_TEMPLATES) {
  for (const agentType of ["opencode", "omp"] as const) {
    Deno.test(`permission guidance - ${entry.label} YOLO ${agentType}`, async () => {
      const rendered = await render(entry, { agentType, yolo: true });
      const label = `${entry.label} YOLO ${agentType}`;

      assertFalse(rendered.includes("## Agent Capabilities"), label);
      assertFalse(rendered.includes("Only read-only operations"), label);
      assertFalse(rendered.includes("Commands denied by OpenCode"), label);
      assertFalse(rendered.includes("individually allowed"), label);
      assertFalse(rendered.includes("always rejected"), label);
      assertFalse(rendered.includes("Multi-command rule"), label);
      // Never claim every operation or path is permitted either.
      for (
        const claim of ["all operations are permitted", "any path is allowed", "no restrictions"]
      ) {
        assertFalse(rendered.includes(claim), `${label}: no blanket-permission claim`);
      }

      // The browser contract survives unchanged in YOLO.
      assertStringIncludes(rendered, "## Browser Automation", label);
      assertStringIncludes(rendered, "agent-browser close", label);
      assertStringIncludes(rendered, "403 or 429", label);

      const ompSection = "## OMP Shell Usage";
      if (agentType === "omp") {
        assertStringIncludes(rendered, ompSection, label);
        // Native LSP denial and service/background semantics are retained.
        assertStringIncludes(rendered, "language-server (LSP) tool is denied", label);
        assertStringIncludes(rendered, "Adding `name` selects service mode", label);
        assertStringIncludes(rendered, "completion notice", label);
        // Reading stdout is a recommendation, not a redirection prohibition.
        assertStringIncludes(rendered, "recommended way to capture a command's output", label);
      } else {
        assertFalse(rendered.includes(ompSection), label);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// OMP stdout handling is a recommendation in every mode
// ---------------------------------------------------------------------------

for (const yolo of [false, true]) {
  Deno.test(`permission guidance - OMP stdout reading is a recommendation (YOLO=${yolo})`, async () => {
    const rendered = await render(ENTRY_TEMPLATES[0], { agentType: "omp", yolo });
    assert(
      rendered.includes("recommended way to capture a command's output"),
      "stdout handling is delivered as a recommendation",
    );
    assertFalse(
      /redirection to a file is (prohibited|forbidden|rejected)/.test(rendered),
      "the recommendation never asserts shell redirection is prohibited",
    );
  });
}

// ---------------------------------------------------------------------------
// Generic renders keep the pre-change default interpretation (design D1):
// an absent engine reads as OpenCode and an absent mode as restricted. These are
// the OPTIONAL-variable rendering defaults, not a runtime shim.
// ---------------------------------------------------------------------------

Deno.test("permission guidance - absent engine and mode render the restricted OpenCode default", async () => {
  const rendered = await renderTemplate(env, join(PROMPTS_DIR, "system_reply.md"), {
    isDm: false,
    platform: "discord",
    userId: "u1",
    channelId: "c1",
    guildId: "",
    model: "test-model",
    skillsDir: SKILLS_ROOT,
    sessionId: SESSION_ID,
    tmpDir: STAGING_DIR,
    userContextMessage: "hi",
  });
  assertStringIncludes(rendered, "## Agent Capabilities");
  assertStringIncludes(rendered, "Commands denied by OpenCode before the permission gate");
  assertStringIncludes(rendered, "shared agent workspace is read-only");
  assertFalse(rendered.includes("## OMP Shell Usage"));
});
