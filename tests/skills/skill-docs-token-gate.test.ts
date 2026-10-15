// tests/skills/skill-docs-token-gate.test.ts
//
// Pinned instruction-surface gate (make-skill-staging-agent-portable, tasks
// 3.1/3.2, skills-and-reply scenario "Skill instruction files direct to the
// same literal paths"): no bundled SKILL.md may instruct the agent to build
// staging paths or session ids from the `$TMPDIR`/`$SESSION_ID` shell tokens.
// The prompts side of the same invariant is pinned by
// tests/core/prompt-staging-literals.test.ts; this closes the docs gate so a
// future SKILL.md edit resurrecting a token recipe fails CI instead of
// quietly regressing the literal-first contract.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { globSync } from "node:fs";
import { resolve } from "@std/path";
import { ContextAssembler } from "@core/context-assembler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { DiscordAdapter } from "@platforms/discord/discord-adapter.ts";
import { MisskeyAdapter } from "@platforms/misskey/misskey-adapter.ts";
import type { PlatformEmoji } from "../../src/types/platform.ts";

const TOKENS = ["$TMPDIR", "$SESSION_ID", "${TMPDIR}", "${SESSION_ID}"] as const;

Deno.test("skill docs gate - every SKILL.md is free of $TMPDIR/$SESSION_ID token instructions", () => {
  const docs = globSync("skills/*/SKILL.md").sort();
  // Guard the sweep's enumeration: the change swept every published skill.
  assert(docs.length >= 14, `expected all bundled skills documented, found ${docs.length}`);
  const offenders: string[] = [];
  for (const doc of docs) {
    const text = Deno.readTextFileSync(doc);
    for (const token of TOKENS) {
      if (text.includes(token)) offenders.push(`${doc}: ${token}`);
    }
  }
  assertEquals(offenders, [], `SKILL.md token instructions: ${offenders.join(", ")}`);
});

Deno.test("skill docs gate - script examples carry no token-form staging strings", () => {
  const scripts = globSync("skills/*/scripts/*.ts").sort();
  assert(scripts.length >= 7, `expected swept skill scripts, found ${scripts.length}`);
  const offenders: string[] = [];
  for (const script of scripts) {
    const text = Deno.readTextFileSync(script);
    for (const token of ["$TMPDIR/$SESSION_ID", '--session-id "$SESSION_ID"']) {
      if (text.includes(token)) offenders.push(`${script}: ${token}`);
    }
  }
  assertEquals(offenders, [], `script token-form examples: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Platform recipes (clarify-platform-skill-recipes): the reaction recipe quotes
// the values the REAL adapters publish and the REAL emoji-section renderer
// emits, and the attachment recipe matches the REAL handler's path resolution.
//
// Honesty boundary: platform data is mocked at the client/transport seam, so
// these assertions prove the delivered instructions agree with this
// repository's adapter transformation, rendering and path resolution — never
// that a public platform accepted a reaction or a file.
// ---------------------------------------------------------------------------

const DISCORD_EMOJI_ID = "123456789012345678";
const DISCORD_ANIMATED_EMOJI_ID = "223456789012345678";

/**
 * The seeded shape of the adapter's private discord.js client cache. An
 * unchecked cast is the only way in: `client` is private, and this is the same
 * seam the repository's adapter tests use.
 */
interface DiscordClientCacheStub {
  guilds: { cache: Map<string, { emojis: { cache: Map<string, unknown> } }> };
}

/**
 * The REAL `DiscordAdapter.fetchEmojis()` transformation over a seeded guild
 * emoji cache (the transport seam is the mocked platform data): one static and
 * one animated guild emoji, i.e. exactly the values the recipes quote.
 */
async function discordEmojiFixture(): Promise<{
  adapter: DiscordAdapter;
  emojis: PlatformEmoji[];
}> {
  const adapter = new DiscordAdapter({ token: "fixture-token" });
  // `client` is private, and its runtime type is a discord.js Client the
  // adapter test seam already seeds directly.
  const adapterInternals = adapter as unknown as { client: DiscordClientCacheStub };
  adapterInternals.client.guilds.cache.set("guild-fixture", {
    emojis: {
      cache: new Map([
        ["e1", {
          id: DISCORD_EMOJI_ID,
          name: "wave",
          animated: false,
          roles: { cache: new Map<string, unknown>() },
        }],
        ["e2", {
          id: DISCORD_ANIMATED_EMOJI_ID,
          name: "wave_anim",
          animated: true,
          roles: { cache: new Map<string, unknown>() },
        }],
      ]),
    },
  });
  // `botId` is null before login, so the application-emoji REST block is skipped.
  return { adapter, emojis: await adapter.fetchEmojis() };
}

/** The REAL `MisskeyAdapter.fetchEmojis()` transformation over one mocked instance response. */
async function misskeyEmojiFixture(): Promise<{
  adapter: MisskeyAdapter;
  emojis: PlatformEmoji[];
  requestedEndpoints: string[];
}> {
  const adapter = new MisskeyAdapter({
    host: "localhost",
    token: "fixture-token",
    secure: false,
  });
  const requestedEndpoints: string[] = [];
  // The Misskey API client is private; stubbing its `request` at the transport
  // seam is how the repository's Misskey adapter test exercises the same method.
  const adapterInternals = adapter as unknown as {
    client: { request: (endpoint: string) => Promise<unknown> };
  };
  adapterInternals.client = {
    request: (endpoint: string) => {
      requestedEndpoints.push(endpoint);
      if (endpoint === "emojis") {
        return Promise.resolve({
          emojis: [{
            name: "wave",
            category: "Reactions",
            aliases: [],
            url: "https://example.invalid/wave.png",
          }],
        });
      }
      return Promise.resolve({});
    },
  };
  return { adapter, emojis: await adapter.fetchEmojis(), requestedEndpoints };
}

/** Run `fn` with the REAL assembler whose emoji section the prompts deliver. */
async function withEmojiAssembler(
  fn: (assembler: ContextAssembler) => Promise<void> | void,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const assembler = new ContextAssembler(new MemoryStore(manager, {}), {
      recentMessageLimit: 20,
      tokenLimit: 20000,
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
      skillsDir: Deno.realPathSync(resolve(import.meta.dirname ?? ".", "../../skills")),
    });
    await fn(assembler);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("skill docs gate - reaction recipe quotes the adapter values the emoji section renders", async () => {
  const { adapter: discord, emojis: discordEmojis } = await discordEmojiFixture();
  try {
    const { emojis: misskeyEmojis, requestedEndpoints } = await misskeyEmojiFixture();

    // Real adapter transformation: Discord reacts with `name:id`, Misskey with `:name:`.
    assertEquals(
      discordEmojis.map((e) => e.useAsReaction),
      [`wave:${DISCORD_EMOJI_ID}`, `wave_anim:${DISCORD_ANIMATED_EMOJI_ID}`],
    );
    assertEquals(discordEmojis[0].useInText, `<:wave:${DISCORD_EMOJI_ID}>`);
    // Animated: only the text markup carries the `a`; the reaction shape is unchanged.
    assertEquals(discordEmojis[1].useInText, `<a:wave_anim:${DISCORD_ANIMATED_EMOJI_ID}>`);
    assertEquals(discordEmojis[1].useAsReaction, `wave_anim:${DISCORD_ANIMATED_EMOJI_ID}`);
    assertEquals(requestedEndpoints, ["emojis"]);
    assertEquals(misskeyEmojis.map((e) => e.useAsReaction), [":wave:"]);
    assertEquals(misskeyEmojis[0].useInText, ":wave:");

    await withEmojiAssembler((assembler) => {
      // The REAL renderer the delivered prompt uses presents the reaction value in `<r>`.
      const rendered = assembler.formatEmojiSection([...discordEmojis, ...misskeyEmojis]);
      assertStringIncludes(
        rendered,
        `<e><t><:wave:${DISCORD_EMOJI_ID}></t><r>wave:${DISCORD_EMOJI_ID}</r></e>`,
      );
      assertStringIncludes(rendered, "<e><t>:wave:</t><r>:wave:</r></e>");
      assertStringIncludes(
        rendered,
        `<e><t><a:wave_anim:${DISCORD_ANIMATED_EMOJI_ID}></t>` +
          `<r>wave_anim:${DISCORD_ANIMATED_EMOJI_ID}</r></e>`,
      );

      const doc = Deno.readTextFileSync("skills/react-message/SKILL.md");
      // Every rendered `<r>` value, and only those, are the documented `--emoji` values.
      assertStringIncludes(doc, `<r>wave:${DISCORD_EMOJI_ID}</r>`);
      assertStringIncludes(doc, "<r>:wave:</r>");
      assertStringIncludes(doc, `--emoji "wave:${DISCORD_EMOJI_ID}"`);
      assertStringIncludes(doc, '--emoji ":wave:"');
      // Embedded entry lines mirror both rendered entries verbatim.
      assertStringIncludes(
        doc,
        `<e><t><:wave:${DISCORD_EMOJI_ID}></t><r>wave:${DISCORD_EMOJI_ID}</r></e>`,
      );
      assertStringIncludes(doc, "<e><t>:wave:</t><r>:wave:</r></e>");
      // The animated claim is quoted from the same animated adapter fixture, so a
      // wrong animated reaction value (e.g. one carrying the `a` flag) fails here.
      assertStringIncludes(
        doc,
        `<e><t><a:wave_anim:${DISCORD_ANIMATED_EMOJI_ID}></t>` +
          `<r>wave_anim:${DISCORD_ANIMATED_EMOJI_ID}</r></e>`,
      );
      assertStringIncludes(doc, `--emoji "wave_anim:${DISCORD_ANIMATED_EMOJI_ID}"`);
      // Platform-labeled: the Discord value is never presented as grouped with Misskey.
      for (const platform of ["Discord", "Misskey"]) {
        assertStringIncludes(doc, platform);
      }
      assertStringIncludes(doc, "Discord does not accept `:name:`");
      // Exact-provided-value guidance, Unicode use, optional reaction and once-only rule survive.
      assertStringIncludes(doc, "exact string this platform accepts");
      assertStringIncludes(doc, "useAsReaction");
      assertStringIncludes(doc, '--emoji "❤️"');
      assertStringIncludes(doc, "Reaction is optional");
      assertStringIncludes(doc, "React only ONCE");
      // A restricted emoji is never presented as usable via the recipe.
      assertStringIncludes(doc, "reaction restricted");
      assertStringIncludes(doc, "does not bypass those platform restrictions");
    });
  } finally {
    await discord.disconnect();
  }
});

/** The code lines of one Skill document: fenced content that is not a `#` comment. */
function fencedCodeLines(text: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence && !line.trimStart().startsWith("#")) lines.push(line);
  }
  return lines;
}

Deno.test("skill docs gate - attachment recipe sends an existing nested workspace file in place", () => {
  const doc = Deno.readTextFileSync("skills/send-file/SKILL.md");
  const prose = doc.replace(/\s+/g, " ");

  // The delta's fixture mapping, including the literal session id it belongs to.
  assertStringIncludes(doc, '--file-paths "tmp/sess_42/file.png"');
  assertStringIncludes(doc, '--session-id "sess_42"');
  assertStringIncludes(doc, "/work/discord/123/tmp/sess_42/file.png");
  assertStringIncludes(
    prose,
    "Copying or moving that nested file to the workspace root is unnecessary",
  );
  assertStringIncludes(prose, "resolved against the session workspace root");

  // Root-relative and accepted in-workspace absolute attachment paths stay documented,
  // and caption payload paths stay absolute and session-scoped.
  assertStringIncludes(doc, '--file-paths "output/chart.png"');
  assertStringIncludes(doc, '--file-paths "exports/report.pdf"');
  assertStringIncludes(doc, '--file-paths "/work/discord/123/tmp/sess_42/file.png"');
  assertStringIncludes(
    prose,
    "absolute path inside the workspace or agent-workspace is also accepted",
  );
  assertStringIncludes(prose, "Attachment paths need NOT be session-staged");
  assertStringIncludes(
    doc,
    '--caption-file "<absolute staging directory rendered in your system prompt>/caption.md"',
  );

  // No boundary was relaxed: traversal, symlink escape, limits and the one-send quota survive.
  assertStringIncludes(prose, "Path traversal (../) is not allowed");
  assertStringIncludes(prose, "symlink that resolves outside the workspace or agent-workspace");
  assertStringIncludes(prose, "At most 10 files can be sent per invocation");
  assertStringIncludes(prose, "ONE successful `send-file` call is allowed per session");

  // No removed singular or inline-caption flag reappears as an executable recipe argument.
  for (const line of fencedCodeLines(doc)) {
    assertFalse(/--file-path(?!s)/.test(line), `singular --file-path flag reintroduced: ${line}`);
    assertFalse(/--caption(?!-file)/.test(line), `inline caption flag reintroduced: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// Tool-neutral cancellation wording (clarify-platform-skill-recipes)
// ---------------------------------------------------------------------------

/**
 * Every published instruction surface: bundled skill documents, the bundled
 * skill scripts the agents execute, and the prompt templates. Directory-only
 * glob hits are avoided by enumerating file extensions.
 */
const PUBLISHED_DOCS = [
  ...globSync("skills/**/*.md"),
  ...globSync("skills/*/scripts/*.ts"),
  ...globSync("skills/*/scripts/*.sh"),
  ...globSync("skills/*/scripts/*.py"),
  ...globSync("prompts/*.md"),
].sort();

/** The published surfaces the change rewrote: every document carrying a timeout rule. */
const CANCELLATION_DOCS = [
  "prompts/system_summary.md",
  "skills/cancel-reminder/SKILL.md",
  "skills/fetch-context/SKILL.md",
  "skills/list-reminders/SKILL.md",
  "skills/memory-export/SKILL.md",
  "skills/memory-patch/SKILL.md",
  "skills/memory-save/SKILL.md",
  "skills/memory-search/SKILL.md",
  "skills/memory-stats/SKILL.md",
  "skills/react-message/SKILL.md",
  "skills/send-file/SKILL.md",
  "skills/send-reply/SKILL.md",
  "skills/set-reminder/SKILL.md",
].sort();

/** The surfaces whose operations never deliver anything and must keep their no-retry rule. */
const NO_RETRY_DOCS = [
  "prompts/system_summary.md",
  "skills/cancel-reminder/SKILL.md",
  "skills/fetch-context/SKILL.md",
  "skills/list-reminders/SKILL.md",
  "skills/memory-export/SKILL.md",
  "skills/memory-patch/SKILL.md",
  "skills/memory-save/SKILL.md",
  "skills/memory-search/SKILL.md",
  "skills/memory-stats/SKILL.md",
  "skills/set-reminder/SKILL.md",
];

Deno.test("skill docs gate - no published instruction prescribes a stale cancellation tool name", () => {
  assert(
    PUBLISHED_DOCS.length >= 60,
    `expected all published surfaces, found ${PUBLISHED_DOCS.length}`,
  );

  const sweptWithCancellationAdvice: string[] = [];
  for (const doc of PUBLISHED_DOCS) {
    const text = Deno.readTextFileSync(doc);
    assertFalse(text.includes("stop_bash"), `${doc} still prescribes stop_bash`);
    // Cancellation advice names no tool (so no speculative alias), and no doc
    // claims that stopping a script proves nothing reached the platform.
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("If it hangs")) continue;
      sweptWithCancellationAdvice.push(doc);
      // The whole timeout bullet, continuation lines included, must stay tool-neutral.
      const bullet = [lines[i]];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === "" || /^\s*(\d+\.|[-*#])/.test(next)) break;
        bullet.push(next);
      }
      const advice = bullet.join(" ");
      assertStringIncludes(advice, "running-command controls your agent documents");
      assertFalse(
        /`[a-z_]+`/.test(advice),
        `${doc} names a tool in cancellation advice: ${advice}`,
      );
    }
    assertFalse(
      /cancel[^.]*proves?[^.]*(nothing|no delivery)/i.test(text),
      `${doc} treats cancellation as proof of non-delivery`,
    );
  }
  // Enumeration guard: exactly the twelve skill documents the change rewrote
  // plus the summary template carry cancellation advice — a new or reworded
  // surface fails here instead of escaping the per-line assertions.
  assertEquals(sweptWithCancellationAdvice.sort(), CANCELLATION_DOCS);

  for (const doc of NO_RETRY_DOCS) {
    assertStringIncludes(
      Deno.readTextFileSync(doc),
      "then do not retry; return an error message in JSON format",
    );
  }

  // Sending skills keep their own non-retry rules and their delivery uncertainty.
  const sendFile = Deno.readTextFileSync("skills/send-file/SKILL.md");
  assertStringIncludes(sendFile, "never retry that send");
  assertStringIncludes(sendFile, "may still have reached the platform");
  const sendReply = Deno.readTextFileSync("skills/send-reply/SKILL.md");
  assertStringIncludes(sendReply, "may still have reached the platform");
});

// ---------------------------------------------------------------------------
// Delivery recovery ownership (`clarify-delivery-recovery-guidance`): the
// send-reply skill OWNS the outcome-dependent recovery policy, send-file owns
// its partial-delivery rule, and neither document promises an API the system
// does not have. Honesty boundary: these are document-contract assertions
// over the REAL bundled SKILL.md files — they prove what the agent is handed,
// never that a platform accepted anything.
// ---------------------------------------------------------------------------

Deno.test("skill docs gate - send-reply owns the outcome-dependent delivery recovery policy", () => {
  const sendReply = Deno.readTextFileSync("skills/send-reply/SKILL.md");

  // The blanket irreversible-failure warning is gone; the outcome table owns
  // the decision instead.
  assertFalse(sendReply.includes("No second attempt"), "blanket finality warning removed");
  assertFalse(sendReply.includes("there's no going back"), "irreversible-send wording removed");
  assertStringIncludes(sendReply, "## Delivery Recovery");
  for (
    const outcome of [
      "**Confirmed success**",
      "**Confirmed pre-delivery failure**",
      "**Uncertain delivery**",
      "**Partial or ambiguous file output**",
    ]
  ) {
    assertStringIncludes(sendReply, outcome);
  }

  // Confirmed pre-delivery rejection: correctable, quota untouched.
  for (
    const code of [
      "`SKILL_LEGACY_FLAG`",
      "`SKILL_MISSING_PAYLOAD`",
      "`SKILL_PAYLOAD_OUT_OF_BOUNDS`",
      "`SKILL_PAYLOAD_NOT_FOUND`",
    ]
  ) {
    assertStringIncludes(sendReply, code);
  }
  assertStringIncludes(sendReply, "the one-reply limit is untouched");
  assertStringIncludes(sendReply, "correct the reported cause and invoke the skill again");

  // Confirmed success: exit, no resend, no readback, and the ONE scoped
  // correction bounded to an already-known error in the active session.
  assertStringIncludes(sendReply, "Known-error correction after a confirmed success");
  assertStringIncludes(sendReply, "and this session is still active");
  assertStringIncludes(sendReply, "No follow-up `send-reply`");
  assertStringIncludes(sendReply, "nothing here promises another correction opportunity");
  assertStringIncludes(sendReply, "an acknowledged success is a finished job");

  // Inspection limits: no invented status API, no hidden state, and no
  // negative inference from a missing ID or a rolled-back internal flag.
  assertStringIncludes(sendReply, "no delivery-status API");
  assertStringIncludes(sendReply, "the session's last delivered file message");
  assertStringIncludes(
    sendReply,
    "is NEVER confirmation that a text reply was delivered",
  );
  assertStringIncludes(sendReply, "the failed result simply carrying no `messageId`");
  assertStringIncludes(sendReply, "internal reply flag having been rolled back");
});

Deno.test("skill docs gate - send-file owns the partial-delivery slot rule", () => {
  const sendFile = Deno.readTextFileSync("skills/send-file/SKILL.md");

  // Positive delivered output is a consumed slot, not a retryable failure.
  assertStringIncludes(sendFile, "positive `filesCount`");
  assertStringIncludes(sendFile, "the remaining files are abandoned for this session");
  assertStringIncludes(sendFile, "The slot is consumed");
  // Preflight-only failure is the distinct case.
  assertStringIncludes(sendFile, "Only a failure BEFORE any platform send");
  // A pending text reply keeps its own quota and the last-file anchor.
  assertStringIncludes(sendFile, "keeps its own separate quota");
  assertStringIncludes(sendFile, "threaded to the last delivered file message");
});
