// tests/acp/email-opencode-profile.test.ts
//
// `email-opencode-intent-profile` — the INTERNAL native deny-all OpenCode
// intent profile (`src/acp/agent-factory.ts#createEmailIntentAgentConfig`).
//
// EVIDENCE BOUNDARIES: this file is the DETERMINISTIC layer. It exercises the
// real factory against the REAL authored documents (`agent-config/
// email-intent-opencode.json` and `agent-config/opencode.json`) and asserts the
// launch shape, the composed engine configuration, the provisioned environment
// and every fail-closed refusal. It claims NOTHING about the engine's own
// behavior: the real installed executable's native denial is the separate
// native leg in `tests/integration/email-intent/opencode-native.test.ts`.
//
// No subprocess, no network and no engine execution happen here.

import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import {
  createAgentConfig,
  createEmailIntentAgentConfig,
  EMAIL_INTENT_AGENT_NAME,
  EMAIL_INTENT_DENIED_NATIVE_SURFACES,
  EMAIL_INTENT_DISABLED_BUILTIN_AGENTS,
  EMAIL_INTENT_OPENCODE_CONFIG_PATH,
  EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH,
  EMAIL_INTENT_ORDINARY_CONFIG_PATH,
  type EmailIntentProfileOptions,
  getSessionModeOverride,
} from "@acp/agent-factory.ts";
import type { AgentConfig } from "@acp/types.ts";
import type { Config } from "../../src/types/config.ts";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** The authored documents, read from the repository tree (read-only). */
const SHIPPED_ASSET_PATH = fromFileUrl(
  new URL("../../agent-config/email-intent-opencode.json", import.meta.url),
);
const SHIPPED_CATALOG_PATH = fromFileUrl(
  new URL("../../agent-config/opencode.json", import.meta.url),
);

/** The daemon home every test's injected environment reports. */
const DAEMON_HOME = "/home/test-daemon";

/** The deployment's declared providers, in the shape the ordinary catalog uses. */
const PROVIDERS = {
  openrouter: {
    models: { "deepseek/deepseek-v4-pro": {} },
    options: {
      apiKey: "{env:OPENROUTER_API_KEY}",
      headers: { "X-Title": "AIr-Friends" },
    },
  },
  gemini: {
    models: {},
    options: { apiKey: "{env:GEMINI_API_KEY}" },
  },
} as const;

/** One selected provider/model pair used by most cases. */
const OPENROUTER_SELECTION = {
  providerID: "openrouter",
  modelID: "deepseek/deepseek-v4-pro",
} as const;

/** A catalog carrying TWO providers plus ordinary agent/compaction policy. */
function catalogDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    provider: structuredClone(PROVIDERS),
    autoupdate: false,
    compaction: { auto: true, prune: true },
    default_agent: "build",
    agent: {
      build: { mode: "primary", permission: { "*": "allow", bash: "allow" } },
      yolo: { mode: "primary", permission: { "*": "allow" } },
    },
    ...overrides,
  };
}

/** The authored deny-all document, with an optional JSON-level edit applied. */
function assetDocument(
  edit: (document: Record<string, unknown>) => void = () => {},
): Record<string, unknown> {
  const document = requireObject(
    JSON.parse(Deno.readTextFileSync(SHIPPED_ASSET_PATH)),
    "the authored deny-all document",
  );
  edit(document);
  return document;
}

/** One agent entry of a profile document. */
function agentEntry(
  document: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return requireObject(requireObject(document["agent"], "agent")[name], `agent "${name}"`);
}

/** Replace one agent entry of a profile document. */
function setAgent(
  document: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  requireObject(document["agent"], "agent")[name] = value;
}

/** A profile environment accessor over an explicit table (defaults included). */
function profileEnv(values: Record<string, string> = {}): (name: string) => string | undefined {
  const table: Record<string, string> = {
    HOME: DAEMON_HOME,
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
    OPENROUTER_API_KEY: "key-openrouter",
    GEMINI_API_KEY: "key-gemini",
    ...values,
  };
  return (name) => table[name];
}

/** One temp workspace: private roots, a catalog document and a scratch area. */
interface Workspace {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly catalogPath: string;
  /** Absolute paths every injected reader observed, in order. */
  readonly readPaths: string[];
}

async function withWorkspace(
  run: (ctx: Workspace) => void | Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "email-intent-profile-" });
  try {
    const catalogPath = join(root, "catalog.json");
    Deno.writeTextFileSync(catalogPath, JSON.stringify(catalogDocument()));
    await run({
      root,
      home: join(root, "home"),
      cwd: join(root, "cwd"),
      catalogPath,
      readPaths: [],
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/**
 * The seams every case uses: an explicit catalog document, the REAL shipped
 * deny-all document, an explicit environment, and a REAL filesystem.
 */
function seams(ctx: Workspace, env = profileEnv()): EmailIntentProfileOptions {
  return {
    catalogPath: ctx.catalogPath,
    readFile: (path) => {
      ctx.readPaths.push(path);
      if (path === SHIPPED_ASSET_PATH || path === EMAIL_INTENT_OPENCODE_CONFIG_PATH) {
        return Deno.readTextFileSync(SHIPPED_ASSET_PATH);
      }
      if (
        path === SHIPPED_CATALOG_PATH ||
        path === EMAIL_INTENT_ORDINARY_CONFIG_PATH ||
        path === ctx.catalogPath
      ) {
        return Deno.readTextFileSync(ctx.catalogPath);
      }
      return Deno.readTextFileSync(path);
    },
    exists: (path) => {
      if (path === EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH) return false;
      return path === EMAIL_INTENT_OPENCODE_CONFIG_PATH ||
        path === resolve(EMAIL_INTENT_OPENCODE_CONFIG_PATH) ||
        path === ctx.catalogPath;
    },
    env,
  };
}

/** Launch the profile with the workspace's seams. */
function launch(
  ctx: Workspace,
  options: Partial<EmailIntentProfileOptions> = {},
): AgentConfig {
  return createEmailIntentAgentConfig(
    "opencode",
    OPENROUTER_SELECTION,
    { home: ctx.home, cwd: ctx.cwd },
    { ...seams(ctx), ...options },
  );
}

/** The child environment of one launch. */
function childEnv(config: AgentConfig): Record<string, string> {
  return config.env ?? {};
}

/**
 * Require one launch to be refused with a message matching `expected`. The
 * refusal MESSAGE is part of the contract: a profile that fails closed for the
 * wrong reason is a different defect.
 */
function assertRefused(run: () => unknown, expected: RegExp, msg?: string): void {
  const error = assertThrows(run, Error);
  assertMatch(error.message, expected, msg ?? "the refusal must name its reason");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} is not a JSON object`);
  return value;
}

/** The composed `OPENCODE_CONFIG_CONTENT` document of one launch. */
function composed(config: AgentConfig): Record<string, unknown> {
  const content = childEnv(config)["OPENCODE_CONFIG_CONTENT"];
  assert(content !== undefined, "the launch must carry OPENCODE_CONFIG_CONTENT");
  return requireObject(JSON.parse(content), "OPENCODE_CONFIG_CONTENT");
}

/** The permission map of the authored agent inside a composed document. */
function agentPermission(document: Record<string, unknown>): Record<string, unknown> {
  const agents = requireObject(document["agent"], "agent");
  const primary = requireObject(agents[EMAIL_INTENT_AGENT_NAME], EMAIL_INTENT_AGENT_NAME);
  return requireObject(primary["permission"], "agent permission");
}

/** A minimal application config for the ORDINARY launch comparison. */
function createTestConfig(): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "oc1",
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: "/tmp/test", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    replyPolicy: "channels",
    channels: [],
  } as Config;
}

// ---------------------------------------------------------------------------
// Launch shape
// ---------------------------------------------------------------------------

Deno.test("profile - launches the authored deny-all agent with its private roots", async () => {
  await withWorkspace((ctx) => {
    const config = launch(ctx);
    const home = resolve(ctx.home);
    const env = childEnv(config);

    assertEquals(config.executionProfile, "email-intent");
    assertEquals(config.command, "opencode");
    assertEquals(config.args, ["acp"]);
    assertEquals(config.cwd, resolve(ctx.cwd));
    assertEquals(env["HOME"], home);
    assertEquals(env["TMPDIR"], join(home, "tmp"));
    assertEquals(env["XDG_CONFIG_HOME"], join(home, ".config"));
    assertEquals(env["XDG_DATA_HOME"], join(home, ".local", "share"));
    assertEquals(env["XDG_CACHE_HOME"], join(home, ".cache"));
    assertEquals(env["XDG_STATE_HOME"], join(home, ".local", "state"));

    // The profile provisions no skill tree, so it carries no skills-root
    // observation at all: the ordinary connector's mandatory input is simply
    // absent on this path.
    assertEquals(config.skillsRoot, undefined);
    assertEquals(config.runtimeMounts?.writableRuntimePaths, [home, resolve(ctx.cwd)]);

    // The private roots and their XDG children really exist, and only the
    // private roots are described as writable.
    for (
      const path of [
        home,
        join(home, ".config"),
        join(home, ".local", "share"),
        join(home, ".cache"),
        join(home, ".local", "state"),
        join(home, "tmp"),
        resolve(ctx.cwd),
      ]
    ) {
      assert(Deno.statSync(path).isDirectory, `${path} must be a private directory`);
    }
  });
});

// ---------------------------------------------------------------------------
// Composed engine configuration
// ---------------------------------------------------------------------------

Deno.test("profile - composed configuration denies every native surface and adds only the selection", async () => {
  await withWorkspace((ctx) => {
    const document = composed(launch(ctx));
    const permission = agentPermission(document);

    assertEquals(document["default_agent"], EMAIL_INTENT_AGENT_NAME);
    assertEquals(document["autoupdate"], false);
    assertEquals(document["permission"], { "*": "deny" });
    assertEquals(permission["*"], "deny");
    for (const surface of EMAIL_INTENT_DENIED_NATIVE_SURFACES) {
      assertEquals(permission[surface], "deny", `${surface} must be denied explicitly`);
    }

    // Every built-in agent is disabled with exactly that member, so the real
    // launch advertises ONE selectable session mode.
    const agents = requireObject(document["agent"], "agent");
    assertEquals(
      Object.keys(agents).sort(),
      [EMAIL_INTENT_AGENT_NAME, ...EMAIL_INTENT_DISABLED_BUILTIN_AGENTS].sort(),
    );
    for (const name of EMAIL_INTENT_DISABLED_BUILTIN_AGENTS) {
      assertEquals(agents[name], { disable: true }, `${name} must be disabled`);
    }

    // Provider-only provisioning: exactly the selected provider, the selected
    // model, and a provider allow-list.
    assertEquals(Object.keys(requireObject(document["provider"], "provider")), ["openrouter"]);
    assertEquals(document["model"], "openrouter/deepseek/deepseek-v4-pro");
    assertEquals(document["enabled_providers"], ["openrouter"]);

    // Nothing permissive and nothing ordinary leaks into the document: the
    // ordinary document's build/yolo agents, compaction policy and any
    // discovery/execution surface are absent.
    const serialized = JSON.stringify(document);
    assert(!serialized.includes('"allow"'), "no permissive rule may survive");
    assert(!serialized.includes('"ask"'), "no approval rule may survive");
    for (const key of ["compaction", "plugin", "mcp", "skills", "instructions", "command"]) {
      assert(!(key in document), `${key} must never be provisioned`);
    }
    assert(!serialized.includes("yolo"), "the yolo agent must never be reachable");
    assert(!serialized.includes("{file:"), "no server-side file reference may survive");
  });
});

Deno.test("profile - gemini selection binds the selected model only", async () => {
  await withWorkspace((ctx) => {
    const config = createEmailIntentAgentConfig(
      "opencode",
      { providerID: "gemini", modelID: "gemini-2.5-pro" },
      { home: ctx.home, cwd: ctx.cwd },
      seams(ctx),
    );
    const document = composed(config);
    assertEquals(Object.keys(requireObject(document["provider"], "provider")), ["gemini"]);
    assertEquals(document["enabled_providers"], ["gemini"]);
    assertEquals(document["model"], "gemini/gemini-2.5-pro");
    assertEquals(childEnv(config)["GEMINI_API_KEY"], "key-gemini");
    assertEquals(childEnv(config)["OPENROUTER_API_KEY"], undefined);
  });
});

// ---------------------------------------------------------------------------
// Environment provisioning
// ---------------------------------------------------------------------------

Deno.test("profile - provisions only the selected model provider credential", async () => {
  await withWorkspace((ctx) => {
    const env = profileEnv({
      EMAIL_IMAP_PASSWORD: "mailbox-secret",
      SKILL_API_SECRET: "skill-secret",
      DISCORD_TOKEN: "bot-token",
      MISSKEY_TOKEN: "bot-token",
    });
    const config = createEmailIntentAgentConfig(
      "opencode",
      OPENROUTER_SELECTION,
      { home: ctx.home, cwd: ctx.cwd },
      { ...seams(ctx, env), env },
    );
    const child = childEnv(config);
    assertEquals(child["OPENROUTER_API_KEY"], "key-openrouter");
    assertEquals(child["GEMINI_API_KEY"], undefined);
    for (const key of Object.keys(child)) {
      assert(
        !key.startsWith("EMAIL_") && !key.startsWith("SKILL_") &&
          !key.startsWith("DISCORD_") && !key.startsWith("MISSKEY_"),
        `${key} must never be provisioned`,
      );
    }
    // No ordinary-launch surface reaches the profile either.
    for (
      const key of [
        "SKILL_JWT_DIR",
        "SESSION_ID",
        "AGENT_WORKSPACE",
        "SKILL_SHARED_PROCESS",
        "AGENT_BROWSER_EXECUTABLE_PATH",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
      ]
    ) {
      assertEquals(child[key], undefined, `${key} must be absent`);
    }
    assert(child["HOME"] !== DAEMON_HOME, "the launch must not reuse the daemon home");
  });
});

Deno.test("profile - refuses credentials outside the model-provider family", async () => {
  await withWorkspace((ctx) => {
    const cases: readonly [string, RegExp][] = [
      ["HOME", /reserved variable "HOME"/],
      ["XDG_CONFIG_HOME", /excluded credential family/],
      ["EMAIL_IMAP_PASSWORD", /excluded credential family/],
      ["SKILL_API_SECRET", /excluded credential family/],
      ["DISCORD_TOKEN", /excluded credential family/],
      ["SOME_PASSWORD", /excluded credential family/],
    ];
    for (const [name, expected] of cases) {
      Deno.writeTextFileSync(
        ctx.catalogPath,
        JSON.stringify(
          catalogDocument({
            provider: {
              openrouter: {
                models: { "deepseek/deepseek-v4-pro": {} },
                options: { apiKey: `{env:${name}}` },
              },
            },
          }),
        ),
      );
      assertRefused(
        () => launch(ctx),
        expected,
        `reference to ${name} must be refused`,
      );
    }
  });
});

Deno.test("profile - refuses a launch whose model credential is unavailable", async () => {
  await withWorkspace((ctx) => {
    assertThrows(
      () => launch(ctx, { env: profileEnv({ OPENROUTER_API_KEY: "" }) }),
      Error,
      'credential "OPENROUTER_API_KEY"',
    );
  });
});

// ---------------------------------------------------------------------------
// Ordinary launches stay unchanged
// ---------------------------------------------------------------------------

Deno.test("profile - ordinary OpenCode launches carry no profile identity", () => {
  const config = createAgentConfig("opencode", "/tmp/workspace", createTestConfig());
  assertEquals(config.executionProfile, undefined);
  assertEquals(config.env?.["OPENCODE_CONFIG_CONTENT"], undefined);
  assertEquals(config.env?.["XDG_CONFIG_HOME"], undefined);
  assertEquals(config.command, "opencode");
  assertEquals(config.args, ["acp"]);
  // The ordinary session-mode override (build/yolo) is untouched: the profile
  // is not selectable through it, and the authored deny-all document declares
  // no yolo agent at all.
  assertEquals(getSessionModeOverride("opencode", true), "yolo");
});

// ---------------------------------------------------------------------------
// Private-root refusals
// ---------------------------------------------------------------------------

Deno.test("profile - refuses roots inside repository ancestry", async () => {
  await withWorkspace((ctx) => {
    const repository = join(ctx.root, "checkout");
    Deno.mkdirSync(join(repository, ".git"), { recursive: true });
    const inside = join(repository, "work");
    Deno.mkdirSync(inside, { recursive: true });
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        OPENROUTER_SELECTION,
        { home: ctx.home, cwd: inside },
        seams(ctx),
      ), /repository ancestry/);
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        OPENROUTER_SELECTION,
        { home: join(repository, "home"), cwd: ctx.cwd },
        seams(ctx),
      ), /repository ancestry/);
  });
});

Deno.test("profile - refuses relative, overlapping, symlinked and non-fresh roots", async () => {
  await withWorkspace((ctx) => {
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        OPENROUTER_SELECTION,
        { home: "relative/home", cwd: ctx.cwd },
        seams(ctx),
      ), /must be an absolute path/);
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        OPENROUTER_SELECTION,
        { home: join(DAEMON_HOME, "private"), cwd: ctx.cwd },
        seams(ctx),
      ), /overlaps the daemon home/);

    const occupied = join(ctx.root, "occupied");
    Deno.mkdirSync(occupied, { recursive: true });
    Deno.writeTextFileSync(join(occupied, "auth.json"), "{}");
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        OPENROUTER_SELECTION,
        { home: occupied, cwd: ctx.cwd },
        seams(ctx),
      ), /not fresh/);

    const target = join(ctx.root, "target");
    Deno.mkdirSync(target, { recursive: true });
    const link = join(ctx.root, "linked-home");
    Deno.symlinkSync(target, link);
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        OPENROUTER_SELECTION,
        { home: link, cwd: ctx.cwd },
        seams(ctx),
      ), /symlink/);
  });
});

// ---------------------------------------------------------------------------
// Provider-selection refusals
// ---------------------------------------------------------------------------

Deno.test("profile - refuses undeclared providers, unlisted models and file references", async () => {
  await withWorkspace((ctx) => {
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        { providerID: "not-declared", modelID: "m" },
        { home: ctx.home, cwd: ctx.cwd },
        seams(ctx),
      ), /not declared/);
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "opencode",
        { providerID: "openrouter", modelID: "not/in/catalog" },
        { home: ctx.home, cwd: ctx.cwd },
        seams(ctx),
      ), /is not in the "openrouter" catalog/);

    Deno.writeTextFileSync(
      ctx.catalogPath,
      JSON.stringify(
        catalogDocument({
          provider: {
            openrouter: {
              models: { "deepseek/deepseek-v4-pro": {} },
              options: { apiKey: "{file:/etc/passwd}" },
            },
          },
        }),
      ),
    );
    assertRefused(() => launch(ctx, { catalogPath: ctx.catalogPath }), /never resolves/);
  });
});

// ---------------------------------------------------------------------------
// Authored-document refusals (fail closed)
// ---------------------------------------------------------------------------

Deno.test("profile - refuses an authored document that drops a surface or adds policy", async () => {
  await withWorkspace((ctx) => {
    const tampered = join(ctx.root, "tampered.json");

    const cases: readonly [(document: Record<string, unknown>) => void, RegExp][] = [
      [
        (document) => delete agentPermission(document)["bash"],
        /must deny the shipped native surface "bash"/,
      ],
      [
        (document) => {
          agentPermission(document)["edit"] = "ask";
        },
        /only explicit denials are allowed/,
      ],
      [
        (document) => setAgent(document, "plan", { mode: "primary" }),
        /must disable the built-in "plan" agent/,
      ],
      [
        (document) => setAgent(document, "helper", { mode: "subagent" }),
        /unprovisioned agent "helper"/,
      ],
      [
        (document) => {
          document["plugin"] = ["evil"];
        },
        /unprovisioned key "plugin"/,
      ],
      [
        (document) => {
          document["default_agent"] = "build";
        },
        /must launch the "email-intent" agent/,
      ],
      [
        (document) => {
          document["autoupdate"] = true;
        },
        /must pin "autoupdate": false/,
      ],
      [
        (document) => {
          requireObject(document["permission"], "permission")["*"] = "allow";
        },
        /only explicit denials are allowed/,
      ],
      [
        (document) => {
          agentEntry(document, EMAIL_INTENT_AGENT_NAME)["description"] = "{file:/app/secret}";
        },
        /must not carry any/,
      ],
      [
        (document) => {
          agentEntry(document, EMAIL_INTENT_AGENT_NAME)["prompt"] =
            "/app/prompts/system_prompt_override.md";
        },
        /carries the unprovisioned member "prompt"/,
      ],
    ];

    for (const [edit, expected] of cases) {
      Deno.writeTextFileSync(tampered, JSON.stringify(assetDocument(edit)));
      assertRefused(
        () => launch(ctx, { authoredConfigPath: tampered }),
        expected,
        "a tampered authored document must never launch",
      );
    }
  });
});

Deno.test("profile - refuses a missing authored document", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () => launch(ctx, { authoredConfigPath: join(ctx.root, "absent.json") }),
      /is unreadable/,
    );
  });
});

// ---------------------------------------------------------------------------
// Asset and packaging resolution
// ---------------------------------------------------------------------------

Deno.test("profile - resolves the installed image document and the Containerfile installs it there", async () => {
  await withWorkspace((ctx) => {
    const config = createEmailIntentAgentConfig(
      "opencode",
      OPENROUTER_SELECTION,
      { home: ctx.home, cwd: ctx.cwd },
      {
        catalogPath: ctx.catalogPath,
        exists: (path) => path === EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH,
        readFile: (path) => {
          ctx.readPaths.push(path);
          if (path === EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH) {
            return Deno.readTextFileSync(SHIPPED_ASSET_PATH);
          }
          return Deno.readTextFileSync(ctx.catalogPath);
        },
        env: profileEnv(),
      },
    );
    assert(
      ctx.readPaths.includes(EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH),
      "the installed document must be read when it is present",
    );
    assert(
      !ctx.readPaths.includes(resolve(EMAIL_INTENT_OPENCODE_CONFIG_PATH)),
      "the development spelling must not be read when the installed copy exists",
    );
    assertEquals(composed(config)["default_agent"], EMAIL_INTENT_AGENT_NAME);
  });

  const containerfile = Deno.readTextFileSync(
    new URL("../../Containerfile", import.meta.url).pathname,
  );
  assert(
    containerfile.includes(
      `agent-config/email-intent-opencode.json ${EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH}`,
    ),
    `the Containerfile must install the authored document at ${EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH}`,
  );
  assert(
    containerfile.includes(
      "install -d -m 775 -o $UID -g 0 /opt/air/opencode/config",
    ),
    "the Containerfile must prepare the intent-profile directory",
  );
  // The deployed ORDINARY document keeps its byte-identical install: the engine
  // merges that directory, so the deny-all agent must never land beside it.
  assert(
    containerfile.includes(
      "agent-config/opencode.json /home/deno/.config/opencode/opencode.json",
    ),
    "the ordinary OpenCode install must stay unchanged",
  );
  assert(
    !containerfile.includes(
      "agent-config/email-intent-opencode.json /home/deno/.config/opencode/",
    ),
    "the deny-all document must never be installed into the ordinary config directory",
  );
});

Deno.test("profile - the deployed ordinary document is the catalog source when present", async () => {
  await withWorkspace((ctx) => {
    const deployed = join(DAEMON_HOME, ".config", "opencode", "opencode.json");
    const config = createEmailIntentAgentConfig(
      "opencode",
      OPENROUTER_SELECTION,
      { home: ctx.home, cwd: ctx.cwd },
      {
        exists: (path) => path === deployed,
        readFile: (path) => {
          ctx.readPaths.push(path);
          if (path === deployed) return Deno.readTextFileSync(SHIPPED_CATALOG_PATH);
          if (path === EMAIL_INTENT_OPENCODE_CONFIG_PATH) {
            return Deno.readTextFileSync(SHIPPED_ASSET_PATH);
          }
          throw new Deno.errors.NotFound(path);
        },
        env: profileEnv(),
      },
    );
    assertEquals(ctx.readPaths, [EMAIL_INTENT_OPENCODE_CONFIG_PATH, deployed]);
    const document = composed(config);
    assertEquals(Object.keys(requireObject(document["provider"], "provider")), ["openrouter"]);
    assertEquals(document["model"], "openrouter/deepseek/deepseek-v4-pro");
  });
});

// ---------------------------------------------------------------------------
// Backend dispatch
// ---------------------------------------------------------------------------

Deno.test("profile - falls back to the development-tree catalog outside an image", async () => {
  await withWorkspace((ctx) => {
    const config = createEmailIntentAgentConfig(
      "opencode",
      { providerID: "gemini", modelID: "gemini-2.5-pro" },
      { home: ctx.home, cwd: ctx.cwd },
      {
        exists: (path) => path === EMAIL_INTENT_OPENCODE_CONFIG_PATH,
        readFile: (path) => {
          ctx.readPaths.push(path);
          if (path === EMAIL_INTENT_OPENCODE_CONFIG_PATH) {
            return Deno.readTextFileSync(SHIPPED_ASSET_PATH);
          }
          if (path === EMAIL_INTENT_ORDINARY_CONFIG_PATH) {
            return Deno.readTextFileSync(SHIPPED_CATALOG_PATH);
          }
          throw new Deno.errors.NotFound(path);
        },
        env: profileEnv(),
      },
    );
    assertEquals(ctx.readPaths, [
      EMAIL_INTENT_OPENCODE_CONFIG_PATH,
      EMAIL_INTENT_ORDINARY_CONFIG_PATH,
    ]);
    const document = composed(config);
    // The SHIPPED ordinary catalog declares gemini and openrouter; only the
    // selected entry is provisioned.
    assertEquals(Object.keys(requireObject(document["provider"], "provider")), ["gemini"]);
    assertEquals(document["enabled_providers"], ["gemini"]);
  });
});

Deno.test("profile - the OMP intent profile is not implemented on this path", async () => {
  await withWorkspace((ctx) => {
    assertRefused(() =>
      createEmailIntentAgentConfig(
        "omp",
        OPENROUTER_SELECTION,
        { home: ctx.home, cwd: ctx.cwd },
        seams(ctx),
      ), /email-omp-intent-profile/);
  });
});
