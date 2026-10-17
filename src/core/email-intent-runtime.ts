// src/core/email-intent-runtime.ts
//
// INTERNAL email intent interpretation runtime (`email-intent-runtime`, row 18).
//
// ONE interpretation of the current authored request, on an isolated private
// launch of either engine, with a bounded hand-off:
//
//   1. Fresh private roots are allocated under a per-interpretation base
//      directory that this module exclusively owns.
//   2. `createEmailIntentAgentConfig` builds the native deny-all intent profile
//      for the selected engine (`email-opencode-intent-profile` /
//      `email-omp-intent-profile`): no user mounts, no mailbox or Skill API
//      material, no external MCP server, no ordinary auth/session state, and
//      exactly the selected model provider's credential.
//   3. The ACP session is driven through the ordinary `AgentConnector`
//      connect/createSession/prompt lifecycle, whose intent branch supplies an
//      EMPTY script inventory and verifies the session's own profile identity
//      and model selection before any prompt is dispatched.
//   4. Final agent text is captured through a BOUNDED in-memory callback — never
//      through logs. The deadline is 30 s and the output bound is 8 KiB.
//   5. Teardown always runs: a bounded cancellation, the connector's disconnect,
//      a confirmation that the launched wrapper is gone, and only then the
//      reclamation of this interpretation's own base directory.
//
// FAIL CLOSED: a tool attempt, a timeout, an output overflow, an incomplete
// result, a session/dispatch failure or a profile that did not prove its
// identity ALL return `unavailable`. No partial text is ever returned, and this
// module writes NOTHING: authored text, captured text and engine stderr reach
// no log, no audit entry, no tool buffer and no file it owns. Whatever state an
// engine keeps lives inside the interpretation's own private roots and is
// reclaimed with them.
//
// This module is an internal host API: there is no skill endpoint, no
// dashboard surface and no configuration field that reaches it. It is
// deliberately NOT wired into production bootstrap — `email-activation` owns
// that cutover — while tests exercise this real implementation.

import { join } from "@std/path";
import type * as acp from "@agentclientprotocol/sdk";
import {
  createEmailIntentAgentConfig,
  EMAIL_INTENT_PROFILE,
  type EmailIntentProfileOptions,
  type EmailIntentProviderSelection,
} from "@acp/agent-factory.ts";
import {
  AgentConnector,
  type AgentProcessEvidence,
  EmailIntentProfileMismatchError,
} from "@acp/agent-connector.ts";
import type {
  AgentConfig,
  AgentConnectorOptions,
  AgentType,
  ClientConfig,
  MCPServerConfig,
} from "@acp/types.ts";
import {
  OMP_INTENT_PROFILE_FLAG,
  OMP_INTENT_PROFILE_FLAG_VALUE,
} from "@acp/omp/extension/native-registration.ts";
import { ompNativeCacheForbiddenRoots } from "@utils/omp-native-cache.ts";
import { getMemoizedOmpVersionProbe } from "@utils/omp-version.ts";
import type { Logger } from "@utils/logger.ts";
import type { Config } from "../types/config.ts";

/**
 * The interpretation deadline: an interpretation that has not produced a
 * complete bounded result within this budget is `unavailable`. Matches the
 * design's 30-second bound.
 */
export const EMAIL_INTENT_DEADLINE_MS = 30 * 1000;

/**
 * The interpretation output bound, in UTF-8 bytes. A result whose captured text
 * exceeds it is discarded entirely (never truncated): the caller must be able
 * to distinguish "no interpretation" from "a possibly cut-off interpretation".
 */
export const EMAIL_INTENT_MAX_OUTPUT_BYTES = 8 * 1024;

/** Name prefix of one interpretation's private base directory. */
export const EMAIL_INTENT_ROOTS_PREFIX = "email-intent-runtime-";

/**
 * Bounded budget for the best-effort ACP prompt cancellation that precedes the
 * hard disconnect. Cancellation is an optimization: a session that will not
 * answer must never delay the deadline's own teardown.
 */
const CANCEL_BUDGET_MS = 1000;

/**
 * Clamp one caller-supplied bound: a usable value may only TIGHTEN the hard
 * limit, and anything unusable (absent, non-finite, zero or negative) falls
 * back to the hard limit instead of silently disabling the bound.
 */
function clampBound(requested: number | undefined, hard: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return hard;
  return Math.min(requested, hard);
}

/**
 * Why an interpretation returned `unavailable`. Every member is a fail-closed
 * outcome of a contract that could not be proven; none of them carries content.
 */
export type EmailIntentUnavailableReason =
  /** The intent profile could not be built, or did not carry its launch identity. */
  | "profile_unavailable"
  /** The model attempted a tool, filesystem, MCP or skill operation. */
  | "tool_attempted"
  /** The 30-second deadline expired. */
  | "timeout"
  /** Captured text exceeded the 8 KiB bound. */
  | "output_overflow"
  /** The prompt ended without a complete reply (no text, or a non-`end_turn` stop). */
  | "incomplete_output"
  /** Connect, session creation, model pinning or dispatch failed. */
  | "session_failed";

/** One interpretation's outcome. `text` exists only on `complete`. */
export type EmailIntentResult =
  | { readonly status: "complete"; readonly text: string }
  | { readonly status: "unavailable"; readonly reason: EmailIntentUnavailableReason };

/** One interpretation request: the current authored text and the launch selection. */
export interface EmailIntentInterpretRequest {
  /** The current authored request. The ONLY content an interpretation receives. */
  readonly authoredText: string;
  /** Provider/model selection the interpretation must run as. */
  readonly model: EmailIntentProviderSelection;
  /** Engine the selected intent profile belongs to. */
  readonly backend: AgentType;
}

/**
 * The slice of `AgentConnector` this runtime drives. `AgentConnector` satisfies
 * it structurally; tests substitute a scripted engine through
 * {@link EmailIntentConnectorFactory}.
 */
export interface EmailIntentConnector {
  connect(): Promise<void>;
  createSession(mcpServers?: MCPServerConfig[], cwd?: string): Promise<string>;
  prompt(sessionId: string, content: string | acp.ContentBlock[]): Promise<acp.PromptResponse>;
  cancel(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;
  getProcessEvidence(): AgentProcessEvidence;
}

/** Creates the connector that drives ONE interpretation. */
export type EmailIntentConnectorFactory = (
  options: AgentConnectorOptions,
) => EmailIntentConnector;

/** Construction inputs of the runtime. */
export interface EmailIntentRuntimeOptions {
  /** Deployment configuration: the OMP native-payload selection and its forbidden roots. */
  readonly config: Config;
  readonly logger: Logger;
  /**
   * Assembly deadline for one interpretation, in milliseconds. Clamped to
   * {@link EMAIL_INTENT_DEADLINE_MS}: a caller may tighten the bound, never
   * widen it.
   */
  readonly deadlineMs?: number;
  /**
   * Output bound in UTF-8 bytes. Clamped to
   * {@link EMAIL_INTENT_MAX_OUTPUT_BYTES} for the same reason.
   */
  readonly maxOutputBytes?: number;
  /** Base directory the per-interpretation roots are allocated under (default: the OS temp dir). */
  readonly rootsBase?: string;
  /**
   * Profile-factory seams (authored documents, fixture native payload). The
   * runtime always supplies the deployment's OMP native-cache selection and
   * forbidden roots; these override them, and tests use that to stay hermetic.
   */
  readonly profileOptions?: EmailIntentProfileOptions;
  /** Connector seam; defaults to the real `AgentConnector`. */
  readonly connectorFactory?: EmailIntentConnectorFactory;
}

/** Internal marker of the deadline arm; never escapes this module. */
class EmailIntentDeadlineError extends Error {
  constructor() {
    super("Email intent interpretation deadline expired");
    this.name = "EmailIntentDeadlineError";
  }
}

/**
 * The bounded capture of ONE interpretation.
 *
 * Chunks are counted as cumulative UTF-8 bytes BEFORE being retained, so the
 * bound cannot be exceeded by a single oversized chunk or by many small ones.
 * Once the bound is crossed nothing further is retained; once a tool attempt is
 * observed the whole capture is discarded at result time. `failure` is latched:
 * a later `end_turn` or a cancellation error can never clear it.
 *
 * Text is only the final answer of the ARMED turn: the runtime arms exactly the
 * session it just created, immediately before dispatching the authored prompt,
 * and disarms it when that prompt settles. Text from any other session — or
 * from this session before/after its own prompt turn — is dropped, so an engine
 * that speaks during setup can never be mistaken for an answer. Tool attempts
 * latch REGARDLESS of arming, so a pre-prompt attempt is never forgotten.
 */
class BoundedIntentCapture {
  private readonly chunks: string[] = [];
  private readonly encoder = new TextEncoder();
  private retainedBytes = 0;
  private overflowed = false;
  private toolAttempted = false;
  private armedSessionId: string | undefined = undefined;

  constructor(private readonly maxBytes: number) {}

  /** Arm the one session whose prompt turn is the interpretation. */
  arm(sessionId: string): void {
    this.armedSessionId = sessionId;
  }

  /** Close the armed turn; later text can no longer join the answer. */
  disarm(): void {
    this.armedSessionId = undefined;
  }

  onText(text: string, sessionId: string): void {
    if (this.armedSessionId === undefined || sessionId !== this.armedSessionId) return;
    if (this.overflowed || this.toolAttempted) return;
    const bytes = this.encoder.encode(text).length;
    if (this.retainedBytes + bytes > this.maxBytes) {
      this.overflowed = true;
      this.chunks.length = 0;
      return;
    }
    this.retainedBytes += bytes;
    this.chunks.push(text);
  }

  onToolAttempt(): void {
    this.toolAttempted = true;
    this.overflowed = false;
    this.chunks.length = 0;
    this.retainedBytes = 0;
  }

  get failure(): "tool_attempted" | "output_overflow" | undefined {
    if (this.toolAttempted) return "tool_attempted";
    if (this.overflowed) return "output_overflow";
    return undefined;
  }

  /** The captured text, or the empty string when the capture already failed. */
  text(): string {
    return this.failure === undefined ? this.chunks.join("") : "";
  }
}

/**
 * The isolated intent interpretation runtime.
 *
 * One instance owns nothing between calls: every `interpret` allocates its own
 * private roots, spawns its own launch and reclaims its own directory. A
 * deployment may construct one and call it concurrently, because no call reads
 * or writes another call's state.
 */
export class EmailIntentRuntime {
  private readonly deadlineMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: EmailIntentRuntimeOptions) {
    this.deadlineMs = clampBound(options.deadlineMs, EMAIL_INTENT_DEADLINE_MS);
    this.maxOutputBytes = clampBound(options.maxOutputBytes, EMAIL_INTENT_MAX_OUTPUT_BYTES);
  }

  /**
   * Interpret ONE authored request. Always resolves: every failure is an
   * `unavailable` result with a bounded reason, never a thrown error, because a
   * caller must be able to distinguish "no grant" from "the interpreter itself
   * broke".
   */
  async interpret(request: EmailIntentInterpretRequest): Promise<EmailIntentResult> {
    const deadlineAt = Date.now() + this.deadlineMs;
    const base = await this.allocateRoots();
    if (base === undefined) {
      return { status: "unavailable", reason: "session_failed" };
    }

    const capture = new BoundedIntentCapture(this.maxOutputBytes);
    const state = { deadline: false };
    let launchFailed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let connector: EmailIntentConnector | undefined;
    let sessionId: string | undefined;
    let completion: acp.PromptResponse | undefined;
    let failure: EmailIntentUnavailableReason | undefined;

    try {
      let launch: { config: AgentConfig; cwd: string };
      try {
        launch = this.buildLaunch(request, base);
      } catch (error) {
        launchFailed = true;
        this.options.logger.warn(
          "Email intent interpretation could not build its launch profile",
          {
            backend: request.backend,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }

      connector = this.createConnector(
        request.backend,
        launch.config,
        capture,
        `${request.model.providerID}/${request.model.modelID}`,
      );

      const deadline = Promise.withResolvers<never>();
      timer = setTimeout(() => {
        state.deadline = true;
        deadline.reject(new EmailIntentDeadlineError());
      }, Math.max(deadlineAt - Date.now(), 0));
      const deadlinePromise = deadline.promise;

      // Every awaited stage re-checks the deadline, so a late connect or
      // session creation can never dispatch a prompt against roots that
      // teardown has already begun to reclaim.
      const runPromise = (async (): Promise<acp.PromptResponse> => {
        await connector!.connect();
        if (state.deadline) throw new EmailIntentDeadlineError();
        const created = await connector!.createSession([], launch.cwd);
        sessionId = created;
        if (state.deadline) throw new EmailIntentDeadlineError();
        // Only the final text of THIS session's own authored prompt may become
        // the answer: anything the engine said while setting up (or on another
        // session) is not this interpretation's result.
        capture.arm(created);
        try {
          return await connector!.prompt(created, request.authoredText);
        } finally {
          capture.disarm();
        }
      })();
      // The losing arm's settlement is always observed, so a post-race
      // rejection can never surface as an unhandled rejection.
      void runPromise.catch(() => {});

      completion = await Promise.race([runPromise, deadlinePromise]);
    } catch (error) {
      failure = this.classifyFailure(error, state.deadline, launchFailed);
    } finally {
      clearTimeout(timer);
      await this.teardown(connector, sessionId, state.deadline || failure !== undefined, base);
    }

    const result = this.resolveResult(request, capture, completion, failure);
    this.options.logger.info(
      "Email intent interpretation {status} ({backend})",
      {
        backend: request.backend,
        status: result.status,
        reason: result.status === "unavailable" ? result.reason : undefined,
      },
    );
    return result;
  }

  /**
   * Map one thrown failure to its bounded reason. The deadline arm and the
   * launch-profile arms are the specific ones; everything else is a session or
   * dispatch failure.
   */
  private classifyFailure(
    error: unknown,
    deadlineReached: boolean,
    launchFailed: boolean,
  ): EmailIntentUnavailableReason {
    if (deadlineReached || error instanceof EmailIntentDeadlineError) return "timeout";
    if (launchFailed) return "profile_unavailable";
    if (error instanceof EmailIntentProfileMismatchError) return "profile_unavailable";
    return "session_failed";
  }

  /**
   * Decide the final result. The capture's latched failures come first (a tool
   * attempt or an overflow invalidates the whole interpretation), then the
   * prompt's own completion evidence.
   */
  private resolveResult(
    request: EmailIntentInterpretRequest,
    capture: BoundedIntentCapture,
    completion: acp.PromptResponse | undefined,
    failure: EmailIntentUnavailableReason | undefined,
  ): EmailIntentResult {
    if (failure !== undefined) return { status: "unavailable", reason: failure };
    const captureFailure = capture.failure;
    if (captureFailure !== undefined) return { status: "unavailable", reason: captureFailure };
    if (completion === undefined || completion.stopReason !== "end_turn") {
      return { status: "unavailable", reason: "incomplete_output" };
    }
    const text = capture.text();
    if (text.trim() === "") return { status: "unavailable", reason: "incomplete_output" };
    this.options.logger.debug("Email intent interpretation captured {bytes} bytes", {
      backend: request.backend,
      bytes: new TextEncoder().encode(text).length,
    });
    return { status: "complete", text };
  }

  /** Allocate this interpretation's exclusively-owned base directory. */
  private async allocateRoots(): Promise<string | undefined> {
    let base: string | undefined;
    try {
      base = await Deno.makeTempDir({
        prefix: EMAIL_INTENT_ROOTS_PREFIX,
        ...(this.options.rootsBase === undefined ? {} : { dir: this.options.rootsBase }),
      });
      Deno.chmodSync(base, 0o700);
      return base;
    } catch (error) {
      // Never leak a directory this call created: a partially prepared base is
      // removed before the failure is reported.
      if (base !== undefined) {
        await Deno.remove(base, { recursive: true }).catch(() => {});
      }
      this.options.logger.error("Email intent interpretation could not allocate private roots", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Build the selected engine's intent launch. The identity is read back off
   * the factory's own config and re-verified here, so a launch that is not the
   * authored deny-all profile never receives the authored text.
   */
  private buildLaunch(
    request: EmailIntentInterpretRequest,
    base: string,
  ): { config: AgentConfig; cwd: string } {
    const config = createEmailIntentAgentConfig(
      request.backend,
      request.model,
      { home: join(base, "home"), cwd: join(base, "cwd") },
      this.profileOptions(),
    );
    if (config.executionProfile !== EMAIL_INTENT_PROFILE) {
      throw new EmailIntentProfileMismatchError(
        "(launch)",
        "launch_profile",
        "the factory did not stamp the intent-profile identity",
      );
    }
    if (
      request.backend === "omp" &&
      config.env?.[OMP_INTENT_PROFILE_FLAG] !== OMP_INTENT_PROFILE_FLAG_VALUE
    ) {
      throw new EmailIntentProfileMismatchError(
        "(launch)",
        "omp_launch_marker",
        "the launch environment does not carry the host-only intent marker",
      );
    }
    return { config, cwd: config.cwd };
  }

  /**
   * The profile-factory seams this deployment supplies: the OMP native-cache
   * selection and its forbidden roots, merged UNDER the caller's overrides so a
   * test's explicit payload still wins while an explicit launch version is
   * never replaced by an absent probe result.
   */
  private profileOptions(): EmailIntentProfileOptions {
    const supplied = this.options.profileOptions ?? {};
    const deployment = this.options.config.agent?.ompNativeCache;
    return {
      ...supplied,
      ompNativeCacheForbiddenRoots: supplied.ompNativeCacheForbiddenRoots ??
        ompNativeCacheForbiddenRoots(this.options.config.workspace),
      ompNativeCache: {
        ...deployment,
        ...supplied.ompNativeCache,
        launchExecutableVersion: supplied.ompNativeCache?.launchExecutableVersion ??
          deployment?.launchExecutableVersion ??
          getMemoizedOmpVersionProbe(),
      },
    };
  }

  /**
   * Build the connector for ONE interpretation. The client configuration
   * carries opaque identifiers only — no skill session, no trusted skill
   * provenance, no YOLO flag, no stream logging — and the intent capture seam
   * that makes the session content-blind and deny-all.
   */
  private createConnector(
    backend: AgentType,
    config: AgentConfig,
    capture: BoundedIntentCapture,
    modelSelection: string,
  ): EmailIntentConnector {
    const clientConfig: ClientConfig = {
      workingDir: config.cwd,
      platform: "email",
      userId: "email-intent-runtime",
      channelId: "email-intent-runtime",
      isDM: true,
      logAgentStreamChunks: false,
      agentType: backend,
      intentCapture: capture,
    };
    const options: AgentConnectorOptions = {
      agentConfig: config,
      clientConfig,
      // The intent profile provisions no skill tree, no registry and no Skill
      // API material; the client never reaches this value in an intent session.
      skillRegistry: {},
      logger: this.options.logger,
      agentType: backend,
      // The interpretation owns its own 30-second deadline; the connector's
      // 5-minute idle detector must never be the arm that ends a session.
      idleTimeoutConfig: {
        enabled: false,
        timeoutMs: EMAIL_INTENT_DEADLINE_MS,
        checkIntervalMs: EMAIL_INTENT_DEADLINE_MS,
      },
      // The session must run as the requested selection, not as whatever the
      // engine would otherwise default to.
      intentModelSelection: modelSelection,
    };
    const factory = this.options.connectorFactory;
    if (factory !== undefined) return factory(options);
    return new AgentConnector(options);
  }

  /**
   * Reclaim this interpretation's resources, in a fixed order that never lets
   * one failure skip a later step:
   *
   *   1. a BOUNDED best-effort prompt cancellation (only when the run did not
   *      complete, so a finished session is never cancelled spuriously);
   *   2. the connector's own disconnect (SIGTERM, then SIGKILL after its own
   *      timeout);
   *   3. a read of that termination evidence;
   *   4. removal of this interpretation's own base directory — and nothing
   *      else.
   *
   * Unless step 3 proves quiescence (no producer was ever spawned, or its exit
   * was positively observed), the base is RETAINED with a bounded warning
   * instead of being reclaimed under a possible live producer — the
   * producer-safe posture the workspace tmp lifecycle uses. An unknown
   * observation is never treated as success.
   */
  private async teardown(
    connector: EmailIntentConnector | undefined,
    sessionId: string | undefined,
    cancelPrompt: boolean,
    base: string,
  ): Promise<void> {
    const logger = this.options.logger;
    if (connector !== undefined) {
      if (cancelPrompt && sessionId !== undefined) {
        try {
          const cancelBudget = Promise.withResolvers<void>();
          const cancelTimer = setTimeout(cancelBudget.resolve, CANCEL_BUDGET_MS);
          await Promise.race([
            connector.cancel(sessionId).catch(() => {}),
            cancelBudget.promise,
          ]);
          clearTimeout(cancelTimer);
        } catch {
          // Best effort: the disconnect below is the authoritative stop.
        }
      }
      try {
        await connector.disconnect();
      } catch (error) {
        logger.warn("Email intent session disconnect reported an error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Read AFTER the disconnect: that is the call which records the positive
    // termination observation.
    let evidence: AgentProcessEvidence | undefined;
    try {
      evidence = connector?.getProcessEvidence();
    } catch {
      evidence = undefined;
    }
    // No connector at all means no wrapper was ever created for this
    // interpretation (a launch refused before it could be built), so there is
    // no producer to protect. Any connector that exists must prove quiescence.
    const producerQuiescent = connector === undefined ||
      (evidence !== undefined &&
        (evidence.generations === 0 || evidence.terminationConfirmed === true));
    if (!producerQuiescent) {
      logger.warn(
        "Retaining email intent private roots: the launched wrapper's exit is unconfirmed",
        {
          base,
          generations: evidence?.generations ?? 0,
          terminationConfirmed: evidence?.terminationConfirmed,
        },
      );
      return;
    }
    try {
      await Deno.remove(base, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        logger.warn("Failed to reclaim email intent private roots", {
          base,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
