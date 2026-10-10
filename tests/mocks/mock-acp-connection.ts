/**
 * Shared scripted in-process ACP connection harness (mock-acp-lifecycle-coverage).
 *
 * Extracts the inline `connector["connection"] = { ... }` pattern proven in
 * `tests/acp/agent-connector.test.ts` into a reusable recorder so the OMP
 * lifecycle suite drives the REAL AgentConnector without any subprocess.
 * The existing connector suite is intentionally untouched (it must pass
 * unmodified); this module is additive.
 *
 * Mock-only: every response here is scripted data. Nothing in this module —
 * and nothing asserted through it — demonstrates anything about the native
 * OMP binary's transport behavior.
 *
 * Crash semantics (deterministic, no timers): a step marked `crash: true`
 * makes the RPC return a promise that NEVER settles, so the caller's
 * `raceAgainstCrash()` is won only by a caller-injected `crashSignal`
 * rejection (standing in for the real subprocess-death signal). The harness
 * never rejects or resolves on its own — timing comes exclusively from the
 * injected signal.
 */

/** One recorded outbound RPC from the connector through the scripted connection. */
export interface RecordedRpc {
  readonly method: string;
  readonly params: unknown;
}

/**
 * Scripted response for one RPC method (bounded call count via `times`,
 * default Infinity; later calls fall back to the default response):
 * - `response`: resolve with this value (structured-cloned per call).
 * - `crash`: never settle — the caller must arm a crashSignal to unstick it.
 * - `error`: reject with `new Error(error)`.
 * - `notifications`: after resolving, deliver follow-up session notifications
 *   through the harness's `deliverNotification` callback.
 */
export interface ScriptedStep {
  response?: unknown;
  crash?: boolean;
  error?: string;
  notifications?: readonly unknown[];
  times?: number;
}

/** Script keyed by the connector's connection method names. */
export interface MockAcpConnectionScript {
  initialize?: ScriptedStep;
  newSession?: ScriptedStep;
  loadSession?: ScriptedStep;
  prompt?: ScriptedStep;
  cancel?: ScriptedStep;
  setSessionMode?: ScriptedStep;
  unstable_setSessionModel?: ScriptedStep;
  setSessionConfigOption?: ScriptedStep;
}

export interface MockAcpConnectionOptions {
  /**
   * Sink for scripted follow-up notifications (e.g. `config_option_update`).
   * Consumers route this into the live ChatbotClient, e.g.
   * `(n) => void connector.getClient()?.sessionUpdate(n as acp.SessionNotification)`.
   */
  deliverNotification?: (notification: unknown) => void;
}

export interface MockAcpConnection {
  /** Every RPC the connector made, in call order. */
  readonly calls: RecordedRpc[];
  /** Calls for a method, in order. */
  callsFor(method: string): readonly RecordedRpc[];
  /** Config ids+values passed to setSessionConfigOption, in order. */
  configOptionCalls(): Array<{ configId: unknown; value: unknown }>;
  /** The scripted connection object to inject as `connector["connection"]`. */
  connection: Record<string, (params: never) => Promise<unknown>>;
}

/** Build an OMP-shaped grouped config-option catalog fixture (synthetic shape). */
export function ompGroupedCatalog(params: {
  modelCurrentValue?: string;
  models?: readonly string[];
  thoughtLevels?: readonly string[];
  thoughtLevelCurrent?: string;
}): Array<Record<string, unknown>> {
  const models = params.models ?? ["mock-model-canonical", "mock-model-other"];
  const thoughtLevels = params.thoughtLevels ?? ["off", "low", "medium", "high"];
  return [
    {
      type: "group",
      id: "model_group",
      name: "Model",
      children: [{
        type: "select",
        id: "model",
        name: "Model",
        currentValue: params.modelCurrentValue ?? "mock-model-canonical",
        options: models.map((v) => ({ value: v, name: v })),
      }],
    },
    {
      type: "select",
      id: "thought_level",
      name: "Reasoning",
      currentValue: params.thoughtLevelCurrent ?? "off",
      options: thoughtLevels.map((v) => ({ value: v, name: v })),
    },
  ];
}

const CONNECTION_METHODS = [
  "initialize",
  "newSession",
  "loadSession",
  "prompt",
  "cancel",
  "setSessionMode",
  "unstable_setSessionModel",
  "setSessionConfigOption",
] as const;

function defaultResponse(method: string): unknown {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: "mock", version: "0.0.0" },
      };
    case "newSession":
      return { sessionId: "mock-session-1", configOptions: [] };
    case "loadSession":
      return { configOptions: [] };
    case "prompt":
      return { stopReason: "end_turn" };
    default:
      return {};
  }
}

/**
 * Create a scripted in-process connection recorder. Inject the returned
 * `connection` into a real AgentConnector via `connector["connection"]`.
 */
export function createMockAcpConnection(
  script: MockAcpConnectionScript,
  options: MockAcpConnectionOptions = {},
): MockAcpConnection {
  const calls: RecordedRpc[] = [];
  const remainingCalls = new Map<string, number>();
  const stepByMethod: Record<string, ScriptedStep | undefined> = { ...script };

  const connection: Record<string, (params: never) => Promise<unknown>> = {};

  for (const method of CONNECTION_METHODS) {
    connection[method] = async (params: never): Promise<unknown> => {
      calls.push({ method, params });
      const step = stepByMethod[method];
      let left = remainingCalls.get(method) ?? step?.times ?? Infinity;
      if (!step || left <= 0) {
        return defaultResponse(method);
      }
      left -= 1;
      remainingCalls.set(method, left);
      if (step.crash) {
        // Never settles: only an externally armed crashSignal can end the
        // racing caller (deterministic — no timers, no self-rejection).
        return await new Promise<never>(() => {});
      }
      if (step.error) {
        throw new Error(step.error);
      }
      const response = step.response !== undefined
        ? structuredClone(step.response)
        : defaultResponse(method);
      if (step.notifications) {
        for (const notification of step.notifications) {
          options.deliverNotification?.(notification);
        }
      }
      return response;
    };
  }

  return {
    calls,
    callsFor: (method) => calls.filter((c) => c.method === method),
    configOptionCalls: () =>
      calls.filter((c) => c.method === "setSessionConfigOption").map((c) => {
        const p: Record<string, unknown> = typeof c.params === "object" && c.params !== null
          ? c.params as Record<string, unknown>
          : {};
        return { configId: p["configId"], value: p["value"] };
      }),
    connection: connection as MockAcpConnection["connection"],
  };
}
