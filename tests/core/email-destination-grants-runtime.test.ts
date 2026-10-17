// tests/core/email-destination-grants-runtime.test.ts
//
// `email-destination-grants` (row 19) against its REAL predecessor: the
// preflight drives the real `EmailIntentRuntime` (row 18), which builds the
// real native deny-all intent profile for BOTH engines and delivers the
// preflight's own instruction envelope through the runtime's bounded capture.
//
// EVIDENCE BOUNDARIES: the profile factory, its authored-document validation,
// the private-root allocation and the runtime's result mapping are all real;
// only the launched ACP engine is a labeled in-process stub that answers with
// scripted text through the intent-capture seam. NO engine executable, provider,
// credential or model judgment is claimed here, and no subprocess is spawned —
// the subprocess-backed engine contract is owned by
// `tests/acp/email-intent-runtime.test.ts`.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { stringify as stringifyYaml } from "@std/yaml";
import type { EmailIntentProfileOptions } from "@acp/agent-factory.ts";
import type { AgentConnectorOptions, AgentType } from "@acp/types.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  type OmpNativeCache,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "@utils/omp-native-cache.ts";
import { OMP_TRUSTED_EXTENSION_BUNDLE_PATH } from "@utils/omp-paths.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import {
  type EmailDestinationGrantOutcome,
  EmailDestinationGrantPreflight,
} from "@core/email-intent-preflight.ts";
import {
  type EmailIntentConnector,
  type EmailIntentConnectorFactory,
  EmailIntentRuntime,
  type EmailIntentRuntimeOptions,
} from "@core/email-intent-runtime.ts";
import { resolve } from "@std/path";
import type { Config } from "../../src/types/config.ts";

const SHIPPED_OPENCODE_CONFIG = fromFileUrl(
  new URL("../../agent-config/email-intent-opencode.json", import.meta.url),
);
const SHIPPED_OMP_SETTINGS = fromFileUrl(
  new URL("../../agent-config/omp/email-intent.yml", import.meta.url),
);
const SHIPPED_OMP_MODELS = fromFileUrl(
  new URL("../../agent-config/omp/models.yml", import.meta.url),
);

const OWNER = `e_${"b".repeat(64)}`;
const WORK_ID = "99999999-8888-7777-6666-555555555555";
const SESSION_ID = "sess_runtime_fixture";
const AUTHORED_TEXT = "Please email alice@example.com the meeting notes.";
const SELECTION = {
  model: { providerID: "openrouter", modelID: "fixture-model" },
  backend: "opencode" as AgentType,
};

/** The fixture native payload: the pinned addon files plus their manifest. */
function provisionNativeCache(base: string): OmpNativeCache {
  const platform = ompNativeCachePlatform();
  const cache = ompNativeCacheDescriptor(base, platform, "development");
  Deno.mkdirSync(cache.versionDir, { recursive: true, mode: 0o700 });
  const files = ompNativeCacheExpectedAddons(platform).exact.map((name) => {
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
  return cache;
}

function intentProfileOptions(
  workspace: string,
  backend: AgentType,
  env: Record<string, string>,
): EmailIntentProfileOptions {
  const modelsPath = join(workspace, "omp-models.yml");
  const catalogPath = join(workspace, "opencode-catalog.json");
  Deno.writeTextFileSync(
    modelsPath,
    stringifyYaml({ providers: { openrouter: { headers: { "X-Title": "fixture" } } } }),
  );
  Deno.writeTextFileSync(
    catalogPath,
    JSON.stringify({ provider: { openrouter: { models: { "fixture-model": {} } } } }),
  );
  const cache = provisionNativeCache(join(workspace, "native-cache"));
  return {
    env: (name) => env[name],
    authoredConfigPath: backend === "omp" ? SHIPPED_OMP_SETTINGS : SHIPPED_OPENCODE_CONFIG,
    catalogPath: backend === "omp" ? modelsPath : catalogPath,
    ompNativeCache: {
      installRoot: cache.installRoot,
      launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
    },
    readFile: (path) => Deno.readTextFileSync(path),
    exists: (path) =>
      path === SHIPPED_OMP_SETTINGS || path === SHIPPED_OMP_MODELS || path === modelsPath ||
      path === catalogPath || path === SHIPPED_OPENCODE_CONFIG ||
      path === resolve(OMP_TRUSTED_EXTENSION_BUNDLE_PATH),
  };
}

function testConfig(workspace: string): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: { model: "fixture-model", systemPromptPath: "./test.md", tokenLimit: 20000 },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: join(workspace, "repo"), workspacesDir: "workspaces" },
    logging: { level: "INFO" },
  } as unknown as Config;
}

/** One scripted engine turn: the JSON the engine "answers" with. */
interface EngineTurn {
  readonly text: string;
  /** When set, the engine attempts a tool and the turn is refused. */
  readonly toolAttempt?: boolean;
  /** When set, the prompt never completes with `end_turn`. */
  readonly stopReason?: string;
}

interface StubHarness {
  readonly factory: EmailIntentConnectorFactory;
  readonly launches: AgentConnectorOptions[];
  readonly prompts: string[];
}

/** The in-process stub engine: it answers through the runtime's own capture seam. */
function stubFactory(turn: EngineTurn): StubHarness {
  const launches: AgentConnectorOptions[] = [];
  const prompts: string[] = [];
  const factory: EmailIntentConnectorFactory = (options) => {
    launches.push(options);
    const capture = options.clientConfig.intentCapture;
    const sessionId = "stub-session";
    const connector: EmailIntentConnector = {
      connect: () => Promise.resolve(),
      createSession: () => Promise.resolve(sessionId),
      prompt: (_sessionId, content) => {
        prompts.push(typeof content === "string" ? content : JSON.stringify(content));
        if (turn.toolAttempt === true) capture?.onToolAttempt();
        capture?.onText(turn.text, sessionId);
        return Promise.resolve({
          stopReason: turn.stopReason ?? "end_turn",
        } as Awaited<ReturnType<EmailIntentConnector["prompt"]>>);
      },
      cancel: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      getProcessEvidence: () => ({ generations: 1, pid: undefined }),
    };
    return connector;
  };
  return { factory, launches, prompts };
}

interface CaseHarness {
  readonly runtime: EmailIntentRuntime;
  readonly preflight: EmailDestinationGrantPreflight;
  readonly stub: StubHarness;
}

async function withRuntimeCase(
  backend: AgentType,
  turn: EngineTurn,
  run: (harness: CaseHarness) => Promise<void>,
): Promise<void> {
  const workspace = await Deno.makeTempDir({ prefix: "email-destination-grants-runtime-" });
  const rootsBase = join(workspace, "roots");
  Deno.mkdirSync(rootsBase, { mode: 0o700 });
  const env: Record<string, string> = {
    HOME: "/home/test-daemon",
    PATH: Deno.env.get("PATH") ?? "/usr/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    USER: "deno",
    OPENROUTER_API_KEY: "fixture-provider-key",
  };
  const stub = stubFactory(turn);
  const runtimeOptions: EmailIntentRuntimeOptions = {
    config: testConfig(workspace),
    logger: new Logger("email-destination-grants-runtime-test", { level: LogLevel.ERROR }),
    rootsBase,
    profileOptions: intentProfileOptions(workspace, backend, env),
    connectorFactory: stub.factory,
  };
  const runtime = new EmailIntentRuntime(runtimeOptions);
  const preflight = new EmailDestinationGrantPreflight({
    interpreter: runtime,
    selection: { model: SELECTION.model, backend },
    newGrantId: () => "grant-runtime-1",
  });
  try {
    await run({ runtime, preflight, stub });
  } finally {
    await Deno.remove(workspace, { recursive: true }).catch(() => {});
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    workId: WORK_ID,
    owner: OWNER,
    origin: "email-request" as const,
    authoredText: AUTHORED_TEXT,
    provenanceStatus: "clean" as const,
    selectionContext: {
      sessionType: "message",
      platform: "email",
      userId: OWNER,
      channelId: `email/account/${OWNER}`,
      messageContent: AUTHORED_TEXT,
    },
    ...overrides,
  };
}

function grantsOf(outcome: EmailDestinationGrantOutcome) {
  assertEquals(outcome.decision, "grant");
  return outcome.decision === "grant" ? outcome.grants : [];
}

for (const backend of ["opencode", "omp"] as const) {
  Deno.test(`grants - ${backend}: the real runtime carries the preflight envelope and its decision`, async () => {
    await withRuntimeCase(
      backend,
      {
        text:
          '{"decision":"grant","actions":[{"action":"compose","recipient":"alice@example.com"}]}',
      },
      async ({ preflight, stub }) => {
        const grants = grantsOf(await preflight.derive(request()));
        assertEquals(grants, [{
          grantId: "grant-runtime-1",
          sessionId: SESSION_ID,
          workId: WORK_ID,
          owner: OWNER,
          action: "compose",
          canonicalRecipient: "alice@example.com",
          requestDigest: grants[0].requestDigest,
        }]);

        // The launch is the REAL deny-all intent profile for this engine.
        assertEquals(stub.launches.length, 1);
        assertEquals(stub.launches[0].agentConfig.executionProfile, "email-intent");
        assert(stub.launches[0].clientConfig.intentCapture !== undefined);

        // The prompt the engine received IS the preflight envelope: the fixed
        // schema plus the current authored text inside its data block.
        assertEquals(stub.prompts.length, 1);
        assert(stub.prompts[0].includes('"decision":"grant"'));
        assert(stub.prompts[0].includes("<<<EMAIL-CURRENT-REQUEST"));
        assert(stub.prompts[0].includes(AUTHORED_TEXT));
      },
    );
  });

  Deno.test(`grants - ${backend}: a tool attempt in the real runtime fails the grant closed`, async () => {
    await withRuntimeCase(
      backend,
      {
        text:
          '{"decision":"grant","actions":[{"action":"compose","recipient":"alice@example.com"}]}',
        toolAttempt: true,
      },
      async ({ preflight, stub }) => {
        const outcome = await preflight.derive(request());
        assertEquals(outcome, { decision: "clarify", reason: "intent_unavailable" });
        assertEquals(stub.prompts.length, 1);
      },
    );
  });

  Deno.test(`grants - ${backend}: non-JSON engine output is never a grant`, async () => {
    await withRuntimeCase(
      backend,
      { text: "I think you should email alice@example.com." },
      async ({ preflight }) => {
        assertEquals(await preflight.derive(request()), {
          decision: "clarify",
          reason: "invalid_decision",
        });
      },
    );
  });
}
