// tests/acp/email-omp-profile.test.ts
//
// `email-omp-intent-profile` — the INTERNAL native deny-all OMP intent profile
// (`src/acp/agent-factory.ts#createEmailIntentAgentConfig("omp", ...)`).
//
// EVIDENCE BOUNDARIES: this file is the DETERMINISTIC layer. It exercises the
// real factory against the REAL authored documents (`agent-config/omp/
// email-intent.yml` and `agent-config/omp/models.yml`) and asserts the launch
// shape, the provisioned environment, the private-root layout, the
// byte-identical model copy and every fail-closed refusal. It claims NOTHING
// about the engine's own behavior: the real installed executable's native
// denial is the separate native leg in
// `tests/integration/email-intent/omp-native.test.ts`.
//
// No subprocess, no network and no engine execution happen here. The native
// runtime payload the launch links is a FIXTURE payload built from this
// module's own published manifest contract, so no extraction ever runs.

import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import {
  createAgentConfig,
  createEmailIntentAgentConfig,
  EMAIL_INTENT_OMP_APPROVAL_MODE,
  EMAIL_INTENT_OMP_CONFIG_PATH,
  EMAIL_INTENT_OMP_IMAGE_CONFIG_PATH,
  EMAIL_INTENT_OMP_MODELS_PATH,
  EMAIL_INTENT_OMP_NATIVE_SURFACES,
  EMAIL_INTENT_OMP_PROVIDER_CREDENTIALS,
  EMAIL_INTENT_PROFILE,
  type EmailIntentProfileOptions,
} from "@acp/agent-factory.ts";
import {
  OMP_INTENT_PROFILE_FLAG,
  OMP_INTENT_PROFILE_FLAG_VALUE,
} from "@acp/omp/extension/native-registration.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  type OmpNativeCache,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "@utils/omp-native-cache.ts";
import {
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  ompHomeModelsPath,
  ompIntentNativeDataDir,
  ompIntentNativesLinkPath,
  ompIntentXdgDataHome,
} from "@utils/omp-paths.ts";
import type { AgentConfig } from "@acp/types.ts";
import type { Config } from "../../src/types/config.ts";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** The authored documents, read from the repository tree (read-only). */
const SHIPPED_SETTINGS_PATH = fromFileUrl(
  new URL("../../agent-config/omp/email-intent.yml", import.meta.url),
);
const SHIPPED_MODELS_PATH = fromFileUrl(
  new URL("../../agent-config/omp/models.yml", import.meta.url),
);

/** The deterministic generated development bundle every launch here resolves. */
const DEVELOPMENT_BUNDLE_PATH = resolve(OMP_TRUSTED_EXTENSION_BUNDLE_PATH);

/** The daemon home every test's injected environment reports. */
const DAEMON_HOME = "/home/test-daemon";

/** The selected provider/model of most cases (declared by the shipped model file). */
const OPENROUTER_SELECTION = {
  providerID: "openrouter",
  modelID: "deepseek/deepseek-v4-pro",
} as const;

/** One decoded YAML object. */
type YamlObject = Record<string, unknown>;

function isObject(value: unknown): value is YamlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): YamlObject {
  if (!isObject(value)) throw new Error(`${label} is not a YAML mapping`);
  return value;
}

/** The approval map of one settings document. */
function approvalMap(document: YamlObject): YamlObject {
  return requireObject(requireObject(document["tools"], "tools")["approval"], "tools.approval");
}

/** The REAL authored settings document, with an optional edit applied. */
function settingsDocument(edit: (document: YamlObject) => void = () => {}): string {
  const document = requireObject(
    parseYaml(Deno.readTextFileSync(SHIPPED_SETTINGS_PATH)),
    "the authored deny-all OMP settings document",
  );
  edit(document);
  return stringifyYaml(document);
}

/** A native model document declaring exactly the given providers. */
function modelsDocument(providers: YamlObject): string {
  return stringifyYaml({ providers });
}

/** The shipped model document's provider entry, in the pinned native schema. */
const OPENROUTER_ENTRY: YamlObject = { headers: { "X-Title": "AIr-Friends" } };

/** An environment accessor over an explicit table (deployment defaults included). */
function profileEnv(values: Record<string, string> = {}): (name: string) => string | undefined {
  const table: Record<string, string> = {
    HOME: DAEMON_HOME,
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    USER: "deno",
    OPENROUTER_API_KEY: "key-openrouter",
    GEMINI_API_KEY: "key-gemini",
    ...values,
  };
  return (name) => table[name];
}

/** A provisioned fixture of the shared native payload (manifest + addon files). */
interface NativeCacheFixture {
  readonly cache: OmpNativeCache;
  readonly selection: { installRoot: string; launchExecutableVersion: string };
}

/**
 * Build the fixture payload the launch links: the pinned platform's expected
 * addon files plus their sidecar manifest, written with the published
 * serializer, so completeness is proven against the real manifest contract.
 */
function provisionNativeCache(base: string): NativeCacheFixture {
  const platform = ompNativeCachePlatform();
  const cache = ompNativeCacheDescriptor(base, platform, "development");
  Deno.mkdirSync(cache.versionDir, { recursive: true, mode: 0o700 });
  const expected = ompNativeCacheExpectedAddons(platform);
  const names = [...expected.exact, `pi_natives.fixture.linux-${Deno.build.arch}.node`];
  const files = names.map((name) => {
    const bytes = `fixture addon ${name}`;
    Deno.writeTextFileSync(join(cache.versionDir, name), bytes);
    return { name, size: bytes.length };
  });
  Deno.writeTextFileSync(
    cache.manifestPath,
    serializeOmpNativeCacheManifest({
      version: OMP_NATIVE_CACHE_VERSION,
      platform,
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform],
      files,
    }),
  );
  return {
    cache,
    selection: {
      installRoot: cache.installRoot,
      launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
    },
  };
}

/** One temp workspace: the private roots, both authored sources, the payload. */
interface Workspace {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly settingsPath: string;
  readonly modelsPath: string;
  readonly nativeCache: NativeCacheFixture;
  /** Absolute paths every injected reader observed, in order. */
  readonly readPaths: string[];
}

async function withWorkspace(
  run: (ctx: Workspace) => void | Promise<void>,
  fixture: { settings?: string; models?: string } = {},
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "email-intent-omp-profile-" });
  try {
    const settingsPath = join(root, "email-intent.yml");
    const modelsPath = join(root, "models.yml");
    Deno.writeTextFileSync(settingsPath, fixture.settings ?? settingsDocument());
    Deno.writeTextFileSync(
      modelsPath,
      fixture.models ?? modelsDocument({ openrouter: OPENROUTER_ENTRY }),
    );
    await run({
      root,
      home: join(root, "home"),
      cwd: join(root, "cwd"),
      settingsPath,
      modelsPath,
      nativeCache: provisionNativeCache(join(root, "native-cache")),
      readPaths: [],
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/**
 * The seams every case uses: the test-owned authored documents, the fixture
 * native payload, an explicit environment and a REAL filesystem for the
 * private roots.
 */
function seams(ctx: Workspace, env = profileEnv()): EmailIntentProfileOptions {
  return {
    env,
    authoredConfigPath: ctx.settingsPath,
    catalogPath: ctx.modelsPath,
    ompNativeCache: ctx.nativeCache.selection,
    readFile: (path) => {
      ctx.readPaths.push(path);
      return Deno.readTextFileSync(path);
    },
    exists: (path) =>
      path === EMAIL_INTENT_OMP_IMAGE_CONFIG_PATH ? false : path === ctx.settingsPath ||
        path === ctx.modelsPath ||
        path === SHIPPED_SETTINGS_PATH ||
        path === SHIPPED_MODELS_PATH ||
        path === DEVELOPMENT_BUNDLE_PATH,
  };
}

/** Launch the profile with the workspace's seams. */
function launch(
  ctx: Workspace,
  options: Partial<EmailIntentProfileOptions> = {},
  selection: { providerID: string; modelID: string } = OPENROUTER_SELECTION,
): AgentConfig {
  return createEmailIntentAgentConfig(
    "omp",
    selection,
    { home: ctx.home, cwd: ctx.cwd },
    { ...seams(ctx), ...options },
  );
}

/** Launch with explicit private roots instead of the workspace defaults. */
function launchWithRoots(ctx: Workspace, home: string, cwd: string): AgentConfig {
  return createEmailIntentAgentConfig("omp", OPENROUTER_SELECTION, { home, cwd }, seams(ctx));
}

/**
 * Launch at a FRESH pair of private roots inside the workspace. Any refusal
 * case that gets past root adoption would otherwise leave the shared roots
 * populated for the next case in the same workspace, which would then fail for
 * the wrong reason.
 */
let freshRootCounter = 0;
function launchAtFreshRoots(
  ctx: Workspace,
  options: Partial<EmailIntentProfileOptions> = {},
  selection: { providerID: string; modelID: string } = OPENROUTER_SELECTION,
): AgentConfig {
  freshRootCounter += 1;
  return createEmailIntentAgentConfig(
    "omp",
    selection,
    {
      home: join(ctx.root, `home-${freshRootCounter}`),
      cwd: join(ctx.root, `cwd-${freshRootCounter}`),
    },
    { ...seams(ctx), ...options },
  );
}

/** The child environment of one launch. */
function childEnv(config: AgentConfig): Record<string, string> {
  return config.env ?? {};
}

/** The operand of one argument flag, or `undefined` when the flag is absent. */
function argumentValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
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

/** The private model file one launch writes into its private HOME. */
function privateModelsPath(ctx: Workspace): string {
  return ompHomeModelsPath(resolve(ctx.home));
}

/** Synchronous existence probe. */
function existsSync(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A minimal application config for the ORDINARY OMP launch comparison. */
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
      defaultAgentType: "omp",
      geminiApiKey: "gm_test_key",
      openRouterApiKey: "or_test_key",
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: "/tmp/test", workspacesDir: "workspaces" },
    logging: { level: "INFO" },
    replyPolicy: "channels",
    channels: [],
  } as Config;
}

/** Write one test-owned model document beside the workspace's own. */
let siblingCounter = 0;
function writeSibling(ctx: Workspace, providers: YamlObject): string {
  siblingCounter += 1;
  const path = join(ctx.root, `models-sibling-${siblingCounter}.yml`);
  Deno.writeTextFileSync(path, modelsDocument(providers));
  return path;
}

// ---------------------------------------------------------------------------
// Launch shape
// ---------------------------------------------------------------------------

Deno.test("profile - launches the authored deny-all document with its private roots", async () => {
  await withWorkspace((ctx) => {
    const config = launch(ctx);
    const home = resolve(ctx.home);
    const env = childEnv(config);

    assertEquals(config.executionProfile, EMAIL_INTENT_PROFILE);
    assertEquals(config.command, "omp");
    assertEquals(config.cwd, resolve(ctx.cwd));

    // The authored document is the selected `--config`, the SAME generated
    // bundle the ordinary launch consumes is the trusted extension, and the
    // launch passes exactly those two: no user prompt mount, no system-prompt
    // override, no second bundle.
    assertEquals(config.args[0], "acp");
    assertEquals(argumentValue(config.args, "--config"), resolve(ctx.settingsPath));
    assertEquals(argumentValue(config.args, "--trusted-extension"), DEVELOPMENT_BUNDLE_PATH);
    assertEquals(config.args.includes("--system-prompt"), false);
    assertEquals(config.args.length, 5);

    // Isolation: a private HOME with its XDG roots, and the host-only marker.
    assertEquals(env["HOME"], home);
    assertEquals(env["TMPDIR"], join(home, "tmp"));
    assertEquals(env["XDG_DATA_HOME"], ompIntentXdgDataHome(home));
    assertEquals(env["XDG_CACHE_HOME"], join(home, ".cache"));
    assertEquals(env["XDG_STATE_HOME"], join(home, ".local", "state"));
    assertEquals(env[OMP_INTENT_PROFILE_FLAG], OMP_INTENT_PROFILE_FLAG_VALUE);
    // Native OMP resolves its agent (config) directory from HOME, so the
    // profile never relocates XDG_CONFIG_HOME; no skill tree and no Skill JWT
    // staging directory exist on this path.
    assertEquals(env["XDG_CONFIG_HOME"], undefined);
    assertEquals(env["SKILL_JWT_DIR"], undefined);
    assertEquals(env["DENO_DIR"], undefined);
    assertEquals(config.skillsRoot, undefined);

    // The private roots and the native layout really exist, and the reserved
    // loader entry points at the ONE prepared shared payload.
    for (const path of [home, ompIntentNativeDataDir(home)]) {
      assert(Deno.statSync(path).isDirectory, `${path} must exist`);
    }
    assert(Deno.statSync(privateModelsPath(ctx)).isFile, "the model copy must exist");
    assertEquals(
      Deno.readLinkSync(ompIntentNativesLinkPath(home)),
      ctx.nativeCache.cache.payloadDir,
    );
    assertEquals(Deno.statSync(ompIntentNativesLinkPath(home)).isDirectory, true);

    // Mount METADATA for a confinement builder: the private roots are the only
    // writable paths, the authored document and the bundle are read-only inputs
    // and the shared payload is a read-only bind.
    assertEquals(config.runtimeMounts?.writableRuntimePaths, [home, resolve(ctx.cwd)]);
    assertEquals(config.runtimeMounts?.readOnlyPaths, [
      resolve(ctx.settingsPath),
      DEVELOPMENT_BUNDLE_PATH,
    ]);
    assertEquals(config.runtimeMounts?.payloadReadOnlyPaths, [ctx.nativeCache.cache.payloadDir]);
  });
});

Deno.test("profile - ordinary OMP launches stay byte-compatible", async () => {
  await withWorkspace((ctx) => {
    const appConfig = createTestConfig();
    appConfig.agent.ompNativeCache = ctx.nativeCache.selection;
    const ordinary = createAgentConfig("omp", join(ctx.root, "ordinary-ws"), appConfig, true);

    assertEquals(ordinary.command, "omp");
    assertEquals(ordinary.executionProfile, undefined);
    assertEquals(ordinary.args.includes("--system-prompt"), true);
    assertEquals(childEnv(ordinary)[OMP_INTENT_PROFILE_FLAG], undefined);
    assert(ordinary.skillsRoot !== undefined, "an ordinary launch carries its skill root");
  });
});

// ---------------------------------------------------------------------------
// Authored deny-all document
// ---------------------------------------------------------------------------

Deno.test("profile - the shipped document denies every contracted surface exactly", () => {
  const document = requireObject(
    parseYaml(Deno.readTextFileSync(SHIPPED_SETTINGS_PATH)),
    "the shipped settings document",
  );
  const approval = approvalMap(document);

  // BOTH directions: the authored map is exactly the contracted shipped surface
  // set, and every member is an explicit denial. A drifting pair — a renamed
  // surface, or a new pin's tool the contract learned but the document did not
  // deny — fails here instead of at a real email launch.
  assertEquals(Object.keys(approval).sort(), [...EMAIL_INTENT_OMP_NATIVE_SURFACES].sort());
  for (const [name, action] of Object.entries(approval)) {
    assertEquals(action, "deny", `${name} must be denied`);
  }
  assertEquals(
    requireObject(document["tools"], "tools")["approvalMode"],
    EMAIL_INTENT_OMP_APPROVAL_MODE,
  );
  assertEquals(document["skills"], { enabled: false });
  assert(
    EMAIL_INTENT_OMP_NATIVE_SURFACES.includes("lsp"),
    "the ordinary authored documents deny the LSP surface by name, so the contract must too",
  );
});

Deno.test("profile - a document that weakens any surface never launches", async () => {
  const cases: readonly (readonly [string, (document: YamlObject) => void, RegExp])[] = [
    [
      "a renamed denial",
      (document) => {
        const approval = approvalMap(document);
        approval["websearch"] = "deny";
        delete approval["web_search"];
      },
      /must deny the shipped native surface "web_search"/,
    ],
    [
      "an uncontracted denial",
      (document) => {
        approvalMap(document)["task"] = "deny";
      },
      /denies the uncontracted native surface "task"/,
    ],
    [
      "a permissive entry",
      (document) => {
        approvalMap(document)["bash"] = "allow";
      },
      /only explicit denials are allowed/,
    ],
    [
      "an auto-approving mode",
      (document) => {
        requireObject(document["tools"], "tools")["approvalMode"] = "yolo";
      },
      /must pin "approvalMode": "write"/,
    ],
    [
      "an unprovisioned tools member",
      (document) => {
        requireObject(document["tools"], "tools")["web_search"] = { enabled: true };
      },
      /unprovisioned member "web_search"/,
    ],
    [
      "skills left discoverable",
      (document) => {
        document["skills"] = { enabled: false, customDirectories: ["~/.agents/skills"] };
      },
      /declare no skill directory/,
    ],
    [
      "an enabled update check",
      (document) => {
        document["startup"] = { checkUpdate: true };
      },
      /must pin startup.checkUpdate: false/,
    ],
    [
      "an unprovisioned top-level key",
      (document) => {
        document["agent"] = { build: { mode: "primary" } };
      },
      /unprovisioned key "agent"/,
    ],
  ];

  for (const [label, edit, expected] of cases) {
    await withWorkspace((ctx) => {
      assertRefused(
        () => launch(ctx),
        expected,
        `a document with ${label} must never launch`,
      );
    }, { settings: settingsDocument(edit) });
  }
});

Deno.test("profile - an unreadable, malformed or foreign document refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () => launch(ctx, { authoredConfigPath: join(ctx.root, "absent.yml") }),
      /is unreadable/,
    );
    assertRefused(
      () => launch(ctx, { authoredConfigPath: writeScalar(ctx) }),
      /must contain a YAML mapping/,
    );
    // A valid YAML mapping carrying none of the profile's contract.
    assertRefused(
      () => launch(ctx, { authoredConfigPath: ctx.modelsPath }),
      /unprovisioned key "providers"/,
    );
  });
});

/** Write one YAML document that is not a mapping and return its path. */
function writeScalar(ctx: Workspace): string {
  const path = join(ctx.root, "scalar.yml");
  Deno.writeTextFileSync(path, stringifyYaml("tools"));
  return path;
}

// ---------------------------------------------------------------------------
// Provider-only provisioning
// ---------------------------------------------------------------------------

Deno.test("profile - provisions exactly the selected provider and its credential", async () => {
  await withWorkspace((ctx) => {
    const env = childEnv(launch(ctx));

    assertEquals(env["OPENROUTER_API_KEY"], "key-openrouter");
    assertEquals(env["GEMINI_API_KEY"], undefined);
    assertEquals(Object.keys(EMAIL_INTENT_OMP_PROVIDER_CREDENTIALS).sort(), [
      "gemini",
      "google",
      "openrouter",
    ]);
  });
});

Deno.test("profile - a required credential the environment lacks refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () => launch(ctx, { env: profileEnv({ OPENROUTER_API_KEY: "" }) }),
      /requires the model-provider credential "OPENROUTER_API_KEY"/,
    );
  });
});

Deno.test("profile - an undeclared or unprovisionable provider refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () => launchAtFreshRoots(ctx, {}, { providerID: "not-declared", modelID: "m" }),
      /is not declared in/,
    );
    // A second declared provider is unprovisioned material: the profile refuses
    // the catalog instead of shipping a provider the deployment never selected.
    assertRefused(
      () =>
        launchAtFreshRoots(ctx, {
          catalogPath: writeSibling(ctx, {
            openrouter: OPENROUTER_ENTRY,
            gemini: { headers: { "X-Title": "AIr-Friends" } },
          }),
        }),
      /declares the unprovisioned provider gemini/,
    );
    // No credential mapping and no explicit credential-free declaration.
    assertRefused(
      () =>
        launchAtFreshRoots(
          ctx,
          { catalogPath: writeSibling(ctx, { "unmapped-provider": { headers: {} } }) },
          { providerID: "unmapped-provider", modelID: "some-model" },
        ),
      /launches no unprovisionable provider/,
    );
    // A declared model list that does not carry the selection.
    assertRefused(
      () =>
        launchAtFreshRoots(
          ctx,
          {
            catalogPath: writeSibling(ctx, {
              openrouter: { auth: "none", models: [{ id: "other-model", name: "other" }] },
            }),
          },
          { providerID: "openrouter", modelID: "deepseek/deepseek-v4-pro" },
        ),
      /is not in the "openrouter" catalog/,
    );
  });
});

Deno.test("profile - a credential-free provider launches with no credential", async () => {
  await withWorkspace((ctx) => {
    const config = launch(
      ctx,
      {
        catalogPath: writeSibling(ctx, {
          "parity-fixture": {
            auth: "none",
            baseUrl: "http://127.0.0.1:43187/v1",
            models: [{ id: "parity-fixture", name: "parity-fixture" }],
          },
        }),
      },
      { providerID: "parity-fixture", modelID: "parity-fixture" },
    );
    const env = childEnv(config);

    assertEquals(env["OPENROUTER_API_KEY"], undefined);
    assertEquals(env["GEMINI_API_KEY"], undefined);
    assertEquals(env["HOME"], resolve(ctx.home));
  });
});

Deno.test("profile - the deployed native model file wins over the development tree", async () => {
  await withWorkspace((ctx) => {
    const deployed = ompHomeModelsPath(DAEMON_HOME);
    const bytes = modelsDocument({ gemini: { headers: { "X-Title": "AIr-Friends" } } });
    const config = launch(
      ctx,
      {
        catalogPath: undefined,
        readFile: (path) => path === deployed ? bytes : Deno.readTextFileSync(path),
        exists: (path) =>
          path === deployed || path === ctx.settingsPath || path === DEVELOPMENT_BUNDLE_PATH,
      },
      { providerID: "gemini", modelID: "gemini-2.5-pro" },
    );

    assertEquals(Deno.readTextFileSync(privateModelsPath(ctx)), bytes);
    assertEquals(childEnv(config)["GEMINI_API_KEY"], "key-gemini");
  });
});

// ---------------------------------------------------------------------------
// Private roots and the model copy
// ---------------------------------------------------------------------------

Deno.test("profile - copies only the authored model bytes into the private HOME", async () => {
  await withWorkspace((ctx) => {
    const authored = Deno.readTextFileSync(ctx.modelsPath);
    launch(ctx);

    assertEquals(Deno.readTextFileSync(privateModelsPath(ctx)), authored);
    assertEquals(
      Deno.statSync(privateModelsPath(ctx)).mode! & 0o777,
      0o600,
      "the private model copy is not group/world readable",
    );
    assertEquals(Deno.readTextFileSync(ctx.modelsPath), authored, "the source is read only");
  });
});

Deno.test("profile - provisions no native state beyond the model copy and the payload link", async () => {
  await withWorkspace((ctx) => {
    launch(ctx);
    const home = resolve(ctx.home);

    // Nothing else of a deployment's native state is provisioned: no auth
    // database, no sessions, no skills, no extensions, no mailbox material and
    // no Skill JWT staging directory.
    for (
      const forbidden of [
        "auth.json",
        "agent.db",
        "sessions",
        "skills",
        "extensions",
        "jwt",
        ".config/omp",
      ]
    ) {
      assert(!existsSync(join(home, forbidden)), `${forbidden} must not be provisioned`);
    }
    assertEquals(Deno.statSync(join(home, ".omp", "agent")).mode! & 0o777, 0o700);
    assertEquals(Deno.statSync(ompIntentNativeDataDir(home)).mode! & 0o777, 0o700);
  });
});

Deno.test("profile - a root spelling that is not an absolute private path refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(() => launchWithRoots(ctx, "relative-home", ctx.cwd), /absolute path/);
    assertRefused(() => launchWithRoots(ctx, ctx.home, "relative-cwd"), /absolute path/);
    assertRefused(() => launchWithRoots(ctx, "/", ctx.cwd), /filesystem root/);
  });
});

Deno.test("profile - a root inside a repository ancestry refuses", async () => {
  await withWorkspace((ctx) => {
    const inside = join(ctx.root, "repo");
    Deno.mkdirSync(join(inside, ".git"), { recursive: true });
    assertRefused(
      () => launchWithRoots(ctx, join(inside, "home"), join(inside, "cwd")),
      /repository ancestry/,
    );
  });
});

Deno.test("profile - a root overlapping the daemon home refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () => launchWithRoots(ctx, `${DAEMON_HOME}/fake-home`, `${DAEMON_HOME}/cwd`),
      /overlaps the daemon home/,
    );
  });
});

Deno.test("profile - a symlinked or occupied root refuses", async () => {
  await withWorkspace((ctx) => {
    const target = join(ctx.root, "target-home");
    const linked = join(ctx.root, "linked-home");
    Deno.mkdirSync(target);
    Deno.symlinkSync(target, linked);
    assertRefused(
      () => launchWithRoots(ctx, linked, join(ctx.root, "linked-cwd")),
      /symlink/,
    );

    Deno.mkdirSync(ctx.home, { recursive: true });
    Deno.writeTextFileSync(join(ctx.home, "auth.json"), "{}");
    assertRefused(() => launch(ctx), /is not fresh/);
  });
});

// ---------------------------------------------------------------------------
// Native runtime payload
// ---------------------------------------------------------------------------

Deno.test("profile - a missing, foreign or incomplete payload refuses before launch", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () => launchAtFreshRoots(ctx, { ompNativeCache: { installRoot: join(ctx.root, "absent") } }),
      /does not match the supported identity/,
    );
    assertRefused(
      () =>
        launchAtFreshRoots(ctx, {
          ompNativeCache: { installRoot: join(ctx.root, "absent", ompNativeCachePlatform()) },
        }),
      /payload directory .* is missing/,
    );

    // A payload prepared by the OTHER pinned executable identity.
    const foreign = provisionNativeCache(join(ctx.root, "foreign-cache"));
    Deno.writeTextFileSync(
      foreign.cache.manifestPath,
      serializeOmpNativeCacheManifest({
        version: OMP_NATIVE_CACHE_VERSION,
        platform: foreign.cache.platform,
        executableSha256: "0".repeat(64),
        files: [],
      }),
    );
    assertRefused(
      () => launchAtFreshRoots(ctx, { ompNativeCache: foreign.selection }),
      /executable identity mismatch/,
    );

    // An incomplete payload: the manifest advertises a file that is absent.
    const incomplete = provisionNativeCache(join(ctx.root, "incomplete-cache"));
    Deno.writeTextFileSync(
      incomplete.cache.manifestPath,
      serializeOmpNativeCacheManifest({
        version: OMP_NATIVE_CACHE_VERSION,
        platform: incomplete.cache.platform,
        executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256[incomplete.cache.platform],
        files: [{ name: "absent-addon.node", size: 1 }],
      }),
    );
    assertRefused(
      () => launchAtFreshRoots(ctx, { ompNativeCache: incomplete.selection }),
      /is missing or has the wrong size|incomplete/,
    );

    // The launcher's OWN version must agree with the payload identity: the
    // check RUNS when a version is observed, instead of being skipped.
    assertRefused(
      () =>
        launchAtFreshRoots(ctx, {
          ompNativeCache: { ...ctx.nativeCache.selection, launchExecutableVersion: "18.10.3" },
        }),
      /resolved launch executable reports "18.10.3"/,
    );
  });
});

Deno.test("profile - a payload inside a forbidden root refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () =>
        launchAtFreshRoots(ctx, {
          ompNativeCacheForbiddenRoots: [ctx.nativeCache.cache.installRoot],
        }),
      /overlaps the configured data\/workspace root/,
    );
  });
});

Deno.test("profile - a pre-populated private root never adopts foreign state", async () => {
  await withWorkspace((ctx) => {
    const home = resolve(ctx.home);
    // A reserved `natives` entry left behind by anything else is never adopted,
    // followed or migrated: the private native root must be fresh.
    Deno.mkdirSync(ompIntentNativeDataDir(home), { recursive: true });
    Deno.symlinkSync(ctx.root, ompIntentNativesLinkPath(home));
    assertRefused(() => launch(ctx), /is not fresh/);

    // The same holds for a real directory at the reserved entry.
    const second = join(ctx.root, "occupied-home");
    Deno.mkdirSync(join(ompIntentNativeDataDir(resolve(second)), "natives"), { recursive: true });
    assertRefused(
      () => launchWithRoots(ctx, second, join(ctx.root, "occupied-cwd")),
      /is not fresh/,
    );
  });
});

Deno.test("profile - a missing generated extension bundle refuses with the build remedy", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () =>
        launch(ctx, {
          exists: (path) => path === ctx.settingsPath || path === ctx.modelsPath,
        }),
      /build it first from canonical source and locked dependencies/,
    );
  });
});

Deno.test("profile - an unsupported backend refuses", async () => {
  await withWorkspace((ctx) => {
    assertRefused(
      () =>
        createEmailIntentAgentConfig(
          "codex" as never,
          OPENROUTER_SELECTION,
          { home: ctx.home, cwd: ctx.cwd },
          seams(ctx),
        ),
      /unsupported backend/,
    );
  });
});

// ---------------------------------------------------------------------------
// Source-path resolution
// ---------------------------------------------------------------------------

Deno.test("profile - falls back to the development-tree documents outside an image", async () => {
  await withWorkspace((ctx) => {
    const config = launch(ctx, {
      authoredConfigPath: undefined,
      catalogPath: undefined,
      readFile: (path) => {
        ctx.readPaths.push(path);
        if (path === resolve(EMAIL_INTENT_OMP_CONFIG_PATH)) {
          return Deno.readTextFileSync(SHIPPED_SETTINGS_PATH);
        }
        if (path === resolve(EMAIL_INTENT_OMP_MODELS_PATH)) {
          return Deno.readTextFileSync(SHIPPED_MODELS_PATH);
        }
        return Deno.readTextFileSync(path);
      },
      exists: (path) =>
        path === resolve(EMAIL_INTENT_OMP_CONFIG_PATH) ||
        path === resolve(EMAIL_INTENT_OMP_MODELS_PATH) ||
        path === DEVELOPMENT_BUNDLE_PATH,
    });

    assertEquals(ctx.readPaths, [
      resolve(EMAIL_INTENT_OMP_CONFIG_PATH),
      resolve(EMAIL_INTENT_OMP_MODELS_PATH),
    ]);
    assertEquals(argumentValue(config.args, "--config"), resolve(EMAIL_INTENT_OMP_CONFIG_PATH));
    assertEquals(
      Deno.readTextFileSync(privateModelsPath(ctx)),
      Deno.readTextFileSync(SHIPPED_MODELS_PATH),
    );
    assertEquals(childEnv(config)["OPENROUTER_API_KEY"], "key-openrouter");
  });
});
