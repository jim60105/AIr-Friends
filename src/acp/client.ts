// src/acp/client.ts

import * as acp from "@agentclientprotocol/sdk";
import { join, resolve, SEPARATOR } from "@std/path";
import { PINNED_CRITICAL_SKILLS } from "./omp/discovery-guard.ts";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import type { ClientConfig, PermissionRejection } from "./types.ts";
import type { SkillContext } from "@skills/types.ts";
import type { SessionAuditWriter } from "@core/audit-logger.ts";
import { sha256Hash } from "@utils/hash.ts";
import {
  commandWithoutFdRedirects,
  containsShellOperators,
  containsUnquotedShellExpansion,
  FD_REDIRECT_TOKEN_PATTERN,
  splitCommandSegments,
  tokenizeShellCommand,
} from "./command-syntax.ts";
import {
  type CommandGateContext,
  type GenericCommandRejection,
  genericCommandRejectionReason,
} from "./command-path-policy.ts";
import {
  canonicalizeSessionRoots,
  type CanonicalSessionRoots,
  resolveFilesystemTarget,
  resolveSessionPath,
  type RootPathResult,
  type SessionContext,
} from "./filesystem-roots.ts";
import { readCanonicalTextFile, writeCanonicalTextFile } from "./filesystem-access.ts";
import {
  authorizeDestructiveTargets,
  decodeDestructiveIntent,
  destructiveDenialReason,
  type DestructiveIntentInput,
  isDestructiveRequest,
  legacyDestructiveIntentInput,
  normalizeDestructiveIntent,
} from "./destructive-policy.ts";
import {
  authorizeFilesystemRead,
  authorizeFilesystemWrite,
  buildSessionFilesystemContext,
  type FilesystemDenialReason,
  mapAccessFailureToDenial,
  mapRootPathFailureToDenial,
  type TrustedSkillsSource,
} from "./filesystem-policy.ts";
import { matchesScriptEntrypoint, type SkillAutoApproveList } from "./skill-inventory.ts";
import { normalizeOmpDestructivePermissionInput } from "./omp/destructive-ingress.ts";

/**
 * Read-extension allowlist for `readTextFile` (F4). Intentionally BROADER than the
 * write allowlist (`.md`/`.txt`): the agent legitimately reads workspace memory JSONL
 * (`.jsonl`), markdown notes/prompts (`.md`), and plain text (`.txt`). Any other
 * extension (e.g. a `.json` cache/token file) is denied.
 */
export const ALLOWED_READ_EXTENSIONS = [".jsonl", ".md", ".txt"];

/**
 * Boundary-safe containment check (F4).
 *
 * Returns `true` only when the resolved candidate path equals the resolved base
 * directory OR begins with the resolved base followed by a path separator. This
 * rejects sibling-prefix escapes such as `/data/workspaces/discord/1234` matching
 * base `/data/workspaces/discord/123` — a real risk because Discord snowflake IDs
 * are variable-length, so a naive `startsWith` could leak a sibling user's files.
 * Note: retained for skill-matching and unit test parity; Layer-3 generic-command path
 * decisions use canonical physical containment in command-path-policy.ts.
 */
export function isWithinDir(path: string, base: string): boolean {
  try {
    const resolvedPath = resolve(path);
    const resolvedBase = resolve(base);
    if (resolvedPath === resolvedBase) return true;
    return resolvedPath.startsWith(resolvedBase + SEPARATOR);
  } catch {
    return false;
  }
}

/**
 * Legacy free-text skill argument flags (D5). A skill command carrying one of
 * these in either form (`--message x` or `--message=x`) is rejected by the gate
 * as defense-in-depth — free-text content must never reach a shell command line
 * (bash would expand `$VAR` in it). Distinct tokens such as `--message-id`,
 * `--message-file`, `--content-file`, `--query-file`, `--caption-file` do not
 * match and are unaffected.
 */
export const LEGACY_FREE_TEXT_FLAG_PATTERN = /^--(?:message|content|query|caption)(?:=|$)/;

/**
 * Determine whether an argument token references a path OUTSIDE the workspace.
 * Rejects absolute paths (`/etc/...`), home-anchored paths (`~/...`, `$HOME/...`),
 * and parent-traversal (`../`). Workspace-relative paths and non-path flags/values
 * are allowed. Used to keep a whitelisted command prefix from being used to read
 * sensitive files (e.g. `agent-browser /home/deno/.git-credentials`).
 */
export function referencesOutOfWorkspacePath(token: string): boolean {
  // F12 D5: an unquoted non-harness `$VAR` reference or unquoted brace token could
  // expand to an out-of-workspace path at runtime — the skill matchers reject it.
  // The harness-set variables (`$TMPDIR`, `$AGENT_WORKSPACE`, `$SESSION_ID`, `$HOME`,
  // `$XDG_DATA_HOME`) are recognized as known WITHOUT expansion, preserving the
  // `--content-file $TMPDIR/$SESSION_ID/x.md` skill payload contract.
  if (containsUnquotedShellExpansion(token)) return true;

  // Strip surrounding quotes and common `--flag=` prefixes so a quoted or flag-embedded
  // absolute path (e.g. `"/etc/passwd"`, `--file=/etc/passwd`) is still inspected.
  let t = token;
  const eq = t.indexOf("=");
  if (eq !== -1 && t.startsWith("-")) t = t.substring(eq + 1);
  t = t.replace(/^["']+/, "").replace(/["']+$/, "");

  // Reject FILESYSTEM-reaching URI schemes (e.g. `file://`, and any non-network scheme such
  // as `ftp://`/`gopher://`/`dict://`) as out-of-workspace (F12 D3). `referencesOutOfWorkspacePath`
  // was scheme-blind, so `agent-browser open file:///etc/passwd` slipped past the leading-`/`
  // check. `http(s)://` is intentionally NOT rejected here: a network URL is not a filesystem
  // path, and `agent-browser` legitimately navigates to web URLs — that egress is mediated by
  // F14, not by this filesystem gate.
  const schemeMatch = t.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return true;
  }

  if (t.startsWith("/")) return true; // absolute path
  if (t.startsWith("~")) return true; // home-anchored
  if (t.startsWith("$HOME") || t.startsWith("${HOME}")) return true;
  // Parent traversal anywhere in the token (e.g. `../`, `a/../../b`)
  if (t === ".." || t.includes("../")) return true;
  return false;
}

/**
 * Check if the first token of a command exactly matches an allowed command name,
 * AND that no subsequent argument references a path outside the workspace.
 *
 * First rejects commands with shell injection characters, then verifies the prefix
 * is the exact first whitespace-delimited token. Security (F2): even with a matching
 * prefix, an out-of-workspace path argument causes rejection so a whitelisted command
 * cannot be used to reach sensitive files outside the sandbox.
 */
export function matchesCommandPrefix(cmd: string, prefix: string): boolean {
  if (containsShellOperators(commandWithoutFdRedirects(cmd))) return false;
  const tokens = tokenizeShellCommand(cmd).filter((t) => t.length > 0);
  if (tokens[0] !== prefix) return false;
  // Reject if any argument references a path outside the workspace.
  for (let i = 1; i < tokens.length; i++) {
    if (referencesOutOfWorkspacePath(tokens[i])) return false;
  }
  return true;
}

/**
 * Classify a permission request as a scoped edit/write request.
 *
 * OpenCode v1.17.13+ (PR #34079 "enrich permission prompts") sends `kind: "edit"`
 * with `title` set to the target FILE PATH for its `write`/`edit`/`apply_patch`/
 * `patch` tools (`toToolKind()` maps all of them to `"edit"`). Older OpenCode
 * versions and other ACP agents used the permission name as `title`
 * (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`). The ACP SDK `ToolKind`
 * vocabulary (`read | edit | delete | move | search | execute | think | fetch |
 * switch_mode | other`) contains no `"write"` kind, so `kind === "write"` cannot
 * occur; the legacy `title: "write"` check below covers pre-rename agents.
 */
export function isEditWriteRequest(title: string, kind: string): boolean {
  return kind === "edit" ||
    title === "edit" ||
    title === "edit_file" ||
    title === "write" ||
    title === "write_file";
}

/**
 * Maximum number of permission-rejection records kept for retry-prompt feedback.
 */
export const MAX_PERMISSION_REJECTIONS = 10;

/**
 * Maximum length of a single rejection field (`toolName`, `kind`, `commandOrPath`)
 * INCLUDING any truncation marker. Fields are sanitized at record time so
 * oversized or agent-influenced content cannot inflate the retry prompt.
 */
export const MAX_PERMISSION_REJECTION_FIELD_LENGTH = 200;

/**
 * Strip control characters and bound an agent-derived rejection field so the
 * retry-prompt diagnostic section cannot be re-injected with user-influenced
 * formatting (e.g. newlines or prompt-structure characters) or oversized content.
 * Applies to `toolName`, `kind`, and `commandOrPath` at record time.
 */
const CONTROL_CHARS_PATTERN = new RegExp(
  `[\\u0000-\\u001f\\u007f]`,
  "g",
);

export function sanitizeRejectionField(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const withoutControlChars = value.replace(CONTROL_CHARS_PATTERN, "");
  if (withoutControlChars.length <= MAX_PERMISSION_REJECTION_FIELD_LENGTH) {
    return withoutControlChars;
  }
  return `${withoutControlChars.slice(0, MAX_PERMISSION_REJECTION_FIELD_LENGTH - 1)}…`;
}

/**
 * ChatbotClient implements the ACP Client interface
 * Handles callbacks from the external OpenCode ACP Agent
 */
/**
 * Per-ACP-session gate context (shared-process mode). All fields except `cwd`
 * override the process-frozen client config for THIS session only.
 */
export interface SessionGateContext {
  /** The session's own workspace (ACP `newSession.cwd`). */
  cwd: string;
  /** Owning skill-API session id (for `$SESSION_ID` expansion; per-session). */
  shellSessionId?: string;
  /** This session's resolved YOLO decision (auto-approve). */
  yolo?: boolean;
  /** This session's agent-workspace write authorization. */
  canWriteAgentWorkspace?: boolean;
  /** This session's allowed write extensions (restricted-mode edit/write gate). */
  allowedWriteExtensions?: string[];
  /** Deployment-owned trusted skills provenance */
  trustedSkills?: TrustedSkillsSource;
  /**
   * Context registration generation (assigned by ChatbotClient). The client both
   * increments a per-instance counter and prefixes a per-instance epoch, so a
   * generation never repeats across client instances.
   */
  generation?: string;
}

export class ChatbotClient implements acp.Client {
  private skillRegistry: SkillRegistry;
  private logger: Logger;
  private config: ClientConfig;
  private replyAlreadySent: boolean = false;
  private skillAutoApproveList: SkillAutoApproveList;
  private auditWriter?: SessionAuditWriter;

  /** Timestamp of the last activity received from the Agent */
  private lastActivityTimestamp: number = Date.now();
  private messageBuffer: string[] = [];
  private thoughtBuffer: string[] = [];

  /**
   * Bounded per-session record of permission denials, consumed by the missing-reply
   * retry prompt (Design Decision 2). NOT cleared in `reset()` — `reset()` runs at
   * the start of every prompt including the retry, so clearing there would wipe the
   * data the retry prompt needs. Cleared exactly once per logical session via
   * `clearPermissionRejections()` from `AgentConnector.createSession()`.
   */
  private recentPermissionRejections: PermissionRejection[] = [];

  /**
   * Optional listener invoked when the Agent sends a `config_option_update`
   * notification, so the AgentConnector can refresh its cached config options.
   * The `config_option_update` notification carries the ACP `sessionId`, so the
   * callback receives it and routes the refresh to the correct session-scoped cache
   * (shared-process mode: one connector serves many ACP sessions on one connection).
   */
  private configOptionsListener?: (
    sessionId: string,
    configOptions: acp.SessionConfigOption[],
  ) => void;

  /**
   * Optional listener invoked on every observed Agent activity (F13). Used to
   * keep the Skill API session's idle timer aligned with real agent liveness,
   * so a long, active turn is never evicted for lack of a skill call.
   */
  private activityListener?: () => void;

  /**
   * Per-ACP-session gate contexts (shared-process mode).
   * In shared mode one ChatbotClient serves many ACP sessions on one connection;
   * each session's `newSession.cwd` (the user's workspace), owning skill session
   * id, and per-session permission flags are registered here so the permission
   * gate and the ACP fs handlers confine each session to its own workspace and
   * flags instead of the process-frozen client config.
   */
  private sessionContexts: Map<string, SessionGateContext> = new Map();
  private contextGenerationCounter: number = 0;
  /**
   * Per-client-instance registration epoch. Registration generations are the currency
   * checked for trusted-provenance admission, so they must never repeat. A reconnect
   * constructs a fresh client and replays the cached gate contexts onto it; the new
   * instance carries a new epoch, so a critical reference minted for a previous
   * instance's epoch is never admitted by the new one.
   */
  private readonly contextGenerationEpoch: string = crypto.randomUUID();

  constructor(
    skillRegistry: SkillRegistry,
    logger: Logger,
    config: ClientConfig,
    skillAutoApproveList: SkillAutoApproveList,
  ) {
    this.skillRegistry = skillRegistry;
    this.logger = logger;
    this.config = config;
    // MANDATORY internal input (`unify-skill-root-and-inventory` D2): the
    // connector derives the inventory from the deployment's ONE explicitly
    // resolved trusted root, shared by BOTH agent types. The historical
    // `Deno.cwd()/skills` constructor default is removed — a caller can no
    // longer silently authorize a daemon- or session-relative tree.
    this.skillAutoApproveList = skillAutoApproveList;
  }

  /**
   * Get the timestamp of the last activity from the Agent.
   * Used by AgentConnector for idle timeout detection.
   */
  getLastActivityTimestamp(): number {
    return this.lastActivityTimestamp;
  }

  /**
   * Reset the idle timeout tracker without affecting other client state.
   * Called after a successful liveness check to grant another timeout window.
   */
  touchActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Set the audit writer for permission decision auditing.
   * Called after session creation when audit writer becomes available.
   */
  setAuditWriter(writer: SessionAuditWriter): void {
    this.auditWriter = writer;
  }

  /**
   * Register a session-scoped working directory for the permission gate (shared-process
   * mode). The gate uses this per-session cwd instead of the process-level workingDir,
   * so multi-user channels confine each session to its own workspace.
   */
  setSessionCwd(sessionId: string, cwd: string): void {
    this.setSessionContext(sessionId, { ...this.sessionContexts.get(sessionId), cwd });
  }

  /**
   * Register/merge the full per-session gate context (shared-process mode):
   * cwd + owning skill session id + per-session permission flags. Without this
   * a pooled process would apply the FIRST session's flags (yolo, write gating)
   * to every later session on the same connection.
   */
  setSessionContext(sessionId: string, ctx: SessionGateContext): void {
    const existing = this.sessionContexts.get(sessionId);
    // Announced generation: computed before the counter advances, so the value a supplier
    // mints against `nextRegistrationGeneration()` is exactly the one stored here.
    const generation = this.nextRegistrationGeneration();
    this.contextGenerationCounter += 1;
    this.sessionContexts.set(sessionId, {
      ...existing,
      ...ctx,
      cwd: ctx.cwd ?? existing!.cwd,
      generation,
      allowedWriteExtensions: (ctx.allowedWriteExtensions ?? existing?.allowedWriteExtensions)
        ?.slice(),
      trustedSkills: ctx.trustedSkills
        ? {
          ...ctx.trustedSkills,
          criticalSkills: ctx.trustedSkills.criticalSkills.map((reference) => ({ ...reference })),
        }
        : ctx.trustedSkills,
    });
  }

  /**
   * Registration generation this client assigns on its next `setSessionContext()` call.
   * A deployment-owned trusted-provenance supplier mints each
   * `CriticalSkillReference.sessionGenerationId` from this value for the registration it
   * is about to perform; any other value — a previously assigned generation, or one
   * obtained from another client instance — is never admitted.
   */
  nextRegistrationGeneration(): string {
    return `${this.contextGenerationEpoch}:gen-${this.contextGenerationCounter + 1}`;
  }

  private gateCtx(acpSessionId?: string): SessionGateContext | undefined {
    return acpSessionId ? this.sessionContexts.get(acpSessionId) : undefined;
  }

  /** Validate owned-root provenance separately from the requested root-scoped read. */
  private async observeFilesystemRoots(
    context: SessionContext,
    trustedSkills?: TrustedSkillsSource,
  ): Promise<RootPathResult<CanonicalSessionRoots>> {
    const roots = await canonicalizeSessionRoots(context, trustedSkills);
    if (!roots.ok || !trustedSkills) return roots;
    const trustedRoot = roots.value.roots.find((root) => root.role === "trusted-skills");
    if (
      !trustedRoot || trustedRoot.canonicalPath !== trustedSkills.canonicalOwnedRootPath ||
      // D3 (plan duck B5): a supplied identity must match the CURRENTly
      // canonicalized root; an absent identity proves nothing and is never
      // admitted.
      trustedSkills.rootIdentity === undefined ||
      trustedSkills.rootIdentity.dev !== trustedRoot.identity?.dev ||
      trustedSkills.rootIdentity.ino !== trustedRoot.identity?.ino ||
      // D4: every supplied reference must name a pinned identifier and
      // resolve to the exact current canonical instruction under the owned
      // root. An unresolvable selector denies that reference, never falls
      // back to a workspace or same-name skill.
      trustedSkills.criticalSkills.some((reference) => {
        const expected = PINNED_CRITICAL_SKILLS[reference.skillId];
        // D4 (plan duck B5): an unregistered name-only selector is DENIED —
        // never treated as an owned skill merely because its name matches.
        if (expected === undefined) return true;
        // Only deployment-owned provenance is authority; a workspace- or
        // link-attributed reference never authorizes anything.
        if (reference.source !== "deployment_owned") return true;
        // D3: the reference's recorded session and registration generation
        // must belong to THIS registration context.
        if (
          reference.sessionId !== context.acpSessionId ||
          reference.sessionGenerationId !== context.sessionContextGeneration
        ) return true;
        const path = resolveSessionPath(
          join(trustedRoot.canonicalPath, expected),
          context,
        );
        return !path.ok || path.value.normalizedPath !== reference.canonicalInstructionPath;
      })
    ) {
      return {
        ok: false,
        reason: "trusted_identity_mismatch",
        message: "Invalid trusted provenance",
      };
    }
    return roots;
  }

  private rejectFilesystemRequest(
    toolName: "readTextFile" | "writeTextFile",
    path: string,
    reason: FilesystemDenialReason,
  ): never {
    const kind = toolName === "readTextFile" ? "read" : "write";
    this.recordPermissionRejection(toolName, kind, path, reason);
    void this.writePermissionAudit(
      "permission_denied",
      toolName,
      kind,
      sanitizeRejectionField(path),
      reason,
    );
    throw new acp.RequestError(-32600, `Filesystem request denied: ${reason}`);
  }

  /** Session-scoped working directory (shared mode) or the process-level fallback. */
  private gateWorkingDir(acpSessionId?: string): string {
    return this.gateCtx(acpSessionId)?.cwd ?? this.config.workingDir;
  }

  /** Owning skill session id for `$SESSION_ID` expansion (per-session in shared mode). */
  private gateSessionId(acpSessionId?: string): string {
    return this.gateCtx(acpSessionId)?.shellSessionId ?? this.config.sessionId ?? "";
  }

  private gateYolo(acpSessionId?: string): boolean {
    return this.gateCtx(acpSessionId)?.yolo ?? this.config.yolo ?? false;
  }

  /**
   * Register a listener that receives the complete config options list whenever the
   * Agent emits a `config_option_update` notification. Used by AgentConnector to keep
   * its cached config options fresh (e.g. after a model change alters `thought_level`).
   */
  setConfigOptionsListener(
    listener: (sessionId: string, configOptions: acp.SessionConfigOption[]) => void,
  ): void {
    this.configOptionsListener = listener;
  }

  /**
   * Register a listener invoked on every observed Agent activity (F13).
   */
  setActivityListener(listener: () => void): void {
    this.activityListener = listener;
  }

  private updateActivity(): void {
    this.lastActivityTimestamp = Date.now();
    this.activityListener?.();
  }

  /**
   * Write a permission decision to the audit log.
   * Fire-and-forget: audit failures never affect permission decisions.
   */
  private async writePermissionAudit(
    phase: "permission_approved" | "permission_denied",
    toolName: string,
    permissionKind: string,
    command: string | undefined,
    reason: string,
  ): Promise<void> {
    if (!this.auditWriter) return;
    const hashContent = this.auditWriter.getConfig().hashContent;
    const commandValue = hashContent && command ? `sha256:${await sha256Hash(command)}` : command;
    void this.auditWriter.write(phase, {
      toolName,
      permissionKind,
      command: commandValue,
      decision: phase === "permission_approved" ? "approved" : "denied",
      reason,
    });
    this.auditWriter.incrementPermissionDecisions();
  }

  /**
   * Record a permission denial for retry-prompt feedback (Design Decision 2).
   * Called on EVERY denial path in `requestPermission()` and `writeTextFile()`
   * so the retry prompt's rejection section never misses a real cause.
   *
   * All agent-derived string fields (`toolName`, `kind`, `commandOrPath`) are
   * sanitized at record time: control characters are stripped and each field is
   * bounded to MAX_PERMISSION_REJECTION_FIELD_LENGTH characters, so the retry
   * prompt's diagnostic section cannot be re-injected with agent/user-influenced
   * formatting or oversized content. `reason` is our own constant (never
   * sanitized). Synchronous and side-effect free beyond the buffer — never throws.
   */
  private recordPermissionRejection(
    toolName: string,
    kind: string,
    commandOrPath: string | undefined,
    reason: string,
  ): void {
    // toolName/kind are required fields (never undefined at call sites), so the
    // sanitizer's undefined case only applies to commandOrPath.
    this.recentPermissionRejections.push({
      toolName: sanitizeRejectionField(toolName) ?? "",
      kind: sanitizeRejectionField(kind) ?? "",
      commandOrPath: sanitizeRejectionField(commandOrPath),
      reason,
      ts: new Date().toISOString(),
    });
    if (this.recentPermissionRejections.length > MAX_PERMISSION_REJECTIONS) {
      this.recentPermissionRejections.shift();
    }
  }

  /**
   * Snapshot the session's recent permission rejections (for the retry prompt).
   * Returns a shallow copy so callers cannot mutate the buffer.
   */
  getRecentPermissionRejections(): PermissionRejection[] {
    return [...this.recentPermissionRejections];
  }

  /**
   * Clear the rejection buffer. Called once per logical session when a new ACP
   * session is created (`AgentConnector.createSession()`). MUST NOT be called from
   * `reset()` — `reset()` runs at the start of every prompt, including the retry,
   * and clearing there would wipe the records the retry prompt needs.
   */
  clearPermissionRejections(): void {
    this.recentPermissionRejections = [];
  }

  /**
   * Handle permission requests from the Agent
   * Auto-approves our registered skills and access to skills directory
   * In YOLO mode, auto-approves ALL permission requests
   */
  private async requestDestructivePermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const title = params.toolCall.title ?? "";
    const kind = params.toolCall.kind ?? "unknown";
    const gateCtx = this.gateCtx(params.sessionId);
    const generation = gateCtx?.generation ?? "";
    const built = buildSessionFilesystemContext(params.sessionId, gateCtx, this.config, generation);
    let reason: string | undefined;
    let failingPath: string | undefined;
    // Snapshot only the actual callback input. No request-supplied provenance is trusted.
    // Pinned session-tools.ts sends execution args as rawInput and preserves acpApprovedArgs;
    // this is snapshot consistency, not attestation of native completeness.
    // Configured OMP selects the native single-operation normalizer; every other
    // (or omitted) type keeps the legacy decoder. The selection comes ONLY from the
    // connector-supplied config — request fields cannot choose the decoder.
    let input: DestructiveIntentInput | undefined;
    if (this.config.agentType === "omp") {
      input = normalizeOmpDestructivePermissionInput(params.toolCall);
    } else {
      const rawInput = typeof params.toolCall.rawInput === "string"
        ? params.toolCall.rawInput
        : JSON.stringify(params.toolCall.rawInput);
      input = rawInput === undefined ? undefined : legacyDestructiveIntentInput(rawInput, kind);
    }
    const decoded = input ? decodeDestructiveIntent(input) : undefined;
    if (!decoded?.ok) {
      reason = destructiveDenialReason(
        decoded && !decoded.ok ? decoded.reason : "title_only_intent",
      );
    } else if (!built.ok) {
      reason = built.reason;
    } else {
      const resolvedTargets = decoded.targets.map((target) =>
        resolveSessionPath(target.path, built.context)
      );
      const resolvedLocations = (params.toolCall.locations ?? []).map((location) =>
        resolveSessionPath(location.path, built.context)
      );
      const failure = [...resolvedTargets, ...resolvedLocations].find((resolved) => !resolved.ok);
      if (failure && !failure.ok) {
        reason = mapRootPathFailureToDenial(failure.reason, true);
      } else {
        const normalized = normalizeDestructiveIntent(
          input,
          resolvedTargets.flatMap((resolved) => resolved.ok ? [resolved.value.normalizedPath] : []),
          resolvedLocations.flatMap((resolved) =>
            resolved.ok ? [resolved.value.normalizedPath] : []
          ),
        );
        if (!normalized.ok) {
          reason = destructiveDenialReason(normalized.reason);
        } else {
          const roots = await this.observeFilesystemRoots(built.context, gateCtx?.trustedSkills);
          if (!roots.ok) {
            reason = mapRootPathFailureToDenial(roots.reason, true);
          } else {
            const observations = await Promise.all(
              resolvedTargets.map((resolved, index) =>
                resolved.ok
                  ? resolveFilesystemTarget(
                    resolved.value,
                    roots.value,
                    normalized.targets[index].intent === "delete" ? "existing-any" : "file-or-new",
                  )
                  : Promise.resolve(resolved)
              ),
            );
            const decision = authorizeDestructiveTargets(normalized, observations, {
              roots: roots.value,
              yolo: false,
              canWriteAgentWorkspace: gateCtx?.canWriteAgentWorkspace,
              allowedWriteExtensions: gateCtx?.allowedWriteExtensions,
            });
            if (!decision.ok) {
              const index = decision.firstDeniedIndex!;
              const denial = decision.decisions[index];
              reason = !denial.ok ? denial.reason : "rejected_destructive_target";
              failingPath = `target[${index}]: ${normalized.targets[index].path}`;
            }
          }
        }
      }
    }
    if (!reason && this.gateCtx(params.sessionId)?.generation !== generation) {
      reason = "rejected_filesystem_context";
    }
    if (reason) {
      this.recordPermissionRejection(title, kind, failingPath, reason);
      void this.writePermissionAudit(
        "permission_denied",
        sanitizeRejectionField(title) ?? "",
        sanitizeRejectionField(kind) ?? "",
        sanitizeRejectionField(failingPath),
        reason,
      );
    } else {
      void this.writePermissionAudit(
        "permission_approved",
        title,
        kind,
        undefined,
        "destructive_authorized",
      );
      this.logger.info("Auto-approving destructive operation for {title}", {
        title,
        kind,
      });
    }
    const option = params.options.find((option) =>
      option.kind === (reason ? "reject_once" : "allow_once")
    );
    // Never use an arbitrary first option to answer a destructive request.
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    this.updateActivity();
    this.logger.debug("Permission requested", {
      toolCall: params.toolCall,
      kind: params.toolCall.kind,
      yolo: this.gateYolo(params.sessionId),
    });

    // Extract and log key permission details at INFO level for operational visibility
    const title = params.toolCall.title ?? "";
    const kind = params.toolCall.kind ?? "unknown";
    const rawInput = params.toolCall.rawInput as Record<string, unknown> | undefined;
    const locations = params.toolCall.locations ?? [];

    // Log external directory access requests
    if (title === "external_directory" || (kind === "other" && title.includes("directory"))) {
      const paths = locations.map((l) => l.path).filter(Boolean);
      this.logger.info(
        "Agent requested external directory access: {title}",
        {
          title,
          kind,
          paths: paths.length > 0 ? paths : undefined,
          rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
          toolCallId: params.toolCall.toolCallId,
        },
      );
    }

    // Log bash/shell command execution requests (non-skill commands)
    if (kind === "execute" || title === "bash" || title === "terminal") {
      const commands = (rawInput?.commands as string[]) ??
        (rawInput?.command ? [rawInput.command as string] : []);
      this.logger.info(
        "Agent requested command execution: {title}",
        {
          title,
          kind,
          commands,
          rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
          toolCallId: params.toolCall.toolCallId,
        },
      );
    }

    // YOLO mode: auto-approve everything (per-session decision in shared mode)
    if (this.gateYolo(params.sessionId)) {
      this.logger.info("YOLO mode: auto-approving permission for {title}", {
        kind: params.toolCall.kind,
        title: params.toolCall.title,
        rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
        locations: locations.length > 0 ? locations.map((l) => l.path) : undefined,
      });

      void this.writePermissionAudit("permission_approved", title, kind, undefined, "yolo_mode");

      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Destructive routing precedes skill/title and ordinary location-list approvals.
    if (isDestructiveRequest(title, kind, params.toolCall.rawInput)) {
      return this.requestDestructivePermission(params);
    }

    // Root-scoped read admission requires trusted lifecycle provenance, never HOME discovery.
    if (
      params.toolCall.kind === "read" && params.toolCall.locations &&
      params.toolCall.locations.length > 0
    ) {
      const gateCtx = this.gateCtx(params.sessionId);
      const currentGeneration = gateCtx?.generation ?? "";
      const builtCtxRes = buildSessionFilesystemContext(
        params.sessionId,
        gateCtx,
        this.config,
        currentGeneration,
      );

      if (builtCtxRes.ok && gateCtx?.trustedSkills) {
        const sessionContext = builtCtxRes.context;
        const checkAllLocations = async () => {
          const rootsRes = await this.observeFilesystemRoots(sessionContext, gateCtx.trustedSkills);
          if (!rootsRes.ok) return false;
          const roots = rootsRes.value;

          for (const loc of params.toolCall.locations ?? []) {
            if (!loc.path) return false;
            const resolvedRes = resolveSessionPath(loc.path, sessionContext);
            if (!resolvedRes.ok) return false;
            const targetRes = await resolveFilesystemTarget(
              resolvedRes.value,
              roots,
              "existing-any",
            );
            if (!targetRes.ok) return false;
            const decision = authorizeFilesystemRead({ roots, target: targetRes.value });
            if (
              !decision.ok || decision.role !== "trusted-skills" ||
              targetRes.value.observedSymlinks.length > 0
            ) return false;
          }
          return this.gateCtx(params.sessionId)?.generation === currentGeneration;
        };

        return checkAllLocations().then((isApproved) => {
          if (isApproved) {
            this.logger.info("Auto-approving trusted skills directory read: {path}", {
              path: params.toolCall.locations!.map((l) => l.path).join(", "),
            });

            void this.writePermissionAudit(
              "permission_approved",
              title,
              kind,
              undefined,
              "skills_directory_access",
            );

            const allowOption = params.options.find((o) => o.kind === "allow_once") ??
              params.options[0];

            return {
              outcome: {
                outcome: "selected" as const,
                optionId: allowOption.optionId,
              },
            };
          }

          // Deny when not approved
          void this.writePermissionAudit(
            "permission_denied",
            title,
            kind,
            undefined,
            "rejected_trusted_skills_identity",
          );
          this.recordPermissionRejection(
            title,
            kind,
            params.toolCall.locations!.map((l) => l.path).join(", "),
            "rejected_trusted_skills_identity",
          );
          const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
            params.options[0];
          return {
            outcome: {
              outcome: "selected" as const,
              optionId: rejectOption.optionId,
            },
          };
        });
      }
    }

    // Auto-approve shell execution for our skill commands (whitelist-based)
    if (params.toolCall.kind === "execute") {
      const rawInput = params.toolCall.rawInput as
        | { command?: string; commands?: string[] }
        | undefined;
      const commands = rawInput?.commands ?? (rawInput?.command ? [rawInput.command] : []);

      // Defense-in-depth (D5): reject commands that smuggle free text in a legacy
      // `--message` / `--content` / `--query` / `--caption` flag (either `--flag value`
      // or `--flag=value`). Checked on the FULL original command(s) BEFORE any
      // multi-command splitting so a smuggled flag can never hide inside a chain. The
      // script-side check uses the same token pattern, so both layers agree.
      const hasLegacyFreeTextFlag = commands.some((cmd) =>
        cmd.trim().split(/\s+/).some((token) => LEGACY_FREE_TEXT_FLAG_PATTERN.test(token))
      );

      if (hasLegacyFreeTextFlag) {
        this.logger.warn(
          "Rejecting skill command with legacy free-text flag: {command}",
          { command: commands.join("; ") },
        );

        void this.writePermissionAudit(
          "permission_denied",
          title,
          kind,
          commands.join("; "),
          "rejected_skill_free_text_flag",
        );

        this.recordPermissionRejection(
          title,
          kind,
          commands.join("; "),
          "rejected_skill_free_text_flag",
        );

        const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: rejectOption.optionId,
          },
        });
      }

      // Generic-command workspace confinement (F12 D2) + segment-wise evaluation of
      // multi-command bash invocations (`;`/`&&`/`||` chains, F12 D2 chaining rule).
      // A chain is approved ONLY when EVERY segment independently passes the exact
      // gate it would face as its own tool call: the skill-whitelist matchers
      // (`matchesScriptEntrypoint` / `matchesCommandPrefix`) OR the generic gate
      // (`genericCommandRejectionReason`). This is capability-neutral — each segment
      // could already run as its own gated tool call — it only removes the forced
      // single-command round trips that cause coding models to batch and surrender.
      // Shared-process mode: use the session-scoped working directory registered by
      // `setSessionCwd` (each user's workspace as the ACP `newSession.cwd`). Falls
      // back to the process-level workingDir (per-spawn mode). Note: restricted generic commands
      // require an authoritative registered session context and fail closed if unregistered.
      const sessionCwd = this.gateWorkingDir(params.sessionId);
      const registered = this.gateCtx(params.sessionId);
      const commandContext: CommandGateContext = {
        acpSessionId: params.sessionId,
        skillSessionId: registered?.shellSessionId ?? "",
        sessionCwd,
        explicitStagingPath: resolve(sessionCwd, "tmp", registered?.shellSessionId ?? ""),
        sharedWorkspacePath: this.config.agentWorkspacePath,
        sessionContextGeneration: registered?.generation ?? "",
        processTmpDir: this.config.processTmpDir,
        xdgDataHome: this.config.xdgDataHome,
        home: Deno.env.get("HOME") ?? "/home/deno",
        runtimeEnv: {
          tmpDir: this.config.processTmpDir ?? resolve(sessionCwd, "tmp"),
          agentWorkspace: this.config.agentWorkspacePath,
          sessionId: registered?.shellSessionId,
        },
        logFailure: (reason) =>
          this.logger.warn("Canonical command path denied: {reason}", { reason }),
      };

      // Flatten every command into its segments in order; evaluate each segment.
      const segments: string[] = [];
      for (const cmd of commands) {
        segments.push(...splitCommandSegments(cmd));
      }

      type SegmentDecision =
        | { approved: true; viaSkill: boolean }
        | { approved: false; reason: GenericCommandRejection };
      const decisions: SegmentDecision[] = await Promise.all(
        segments.map(async (segment): Promise<SegmentDecision> => {
          // A segment consisting ONLY of tolerated fd-redirect tokens is an operator
          // artifact, not a command — reject it, never skip it.
          const segmentTokens = segment.trim().split(/\s+/).filter((t) => t.length > 0);
          if (
            segmentTokens.length > 0 &&
            segmentTokens.every((t) => FD_REDIRECT_TOKEN_PATTERN.test(t))
          ) {
            return { approved: false, reason: "shell_operator" };
          }
          // Skill-whitelist matchers (script paths then command prefixes).
          // Physical entrypoint decision (`unify-omp-skill-root-resolution` D3):
          // a relative script spelling anchors ONLY at the requesting REGISTERED
          // session cwd — an unregistered session gets no session-relative
          // script authority (never the daemon cwd or `config.workingDir`).
          const isScript = matchesScriptEntrypoint(segment, this.skillAutoApproveList, {
            sessionCwd: registered ? sessionCwd : undefined,
          });
          if (isScript) return { approved: true, viaSkill: true };
          const isCommand = Array.from(this.skillAutoApproveList.commandPrefixes).some(
            (prefix) => matchesCommandPrefix(segment, prefix),
          );
          if (isCommand) return { approved: true, viaSkill: true };
          // Generic-command gate.
          const reason = await genericCommandRejectionReason(segment, commandContext);
          return reason === null
            ? { approved: true, viaSkill: false }
            : { approved: false, reason };
        }),
      );

      if (
        decisions.some((decision) => decision.approved && !decision.viaSkill) &&
        (!registered || this.gateCtx(params.sessionId)?.generation !== registered.generation)
      ) {
        const genericIndex = decisions.findIndex((decision) =>
          decision.approved && !decision.viaSkill
        );
        decisions[genericIndex] = { approved: false, reason: "path_outside_boundary" };
        this.logger.warn("Canonical command path denied: {reason}", { reason: "invalid_context" });
      }
      const firstRejectedIndex = decisions.findIndex((d) => !d.approved);

      if (segments.length > 0 && firstRejectedIndex === -1) {
        // Every segment of every command passed its gate.
        const allViaSkill = decisions.every((d) => d.approved && d.viaSkill);
        const auditReason = allViaSkill ? "skill_whitelist" : "generic_command_workspace_confined";
        this.logger.info(
          allViaSkill
            ? "Auto-approving skill shell execution: {command}"
            : "Auto-approving workspace-confined generic command: {command}",
          { command: commands.join("; ") },
        );

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          commands.join("; "),
          auditReason,
        );

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }

      // A filesystem-touching command that fails a segment's gate: report the ACTUAL
      // rejection cause of the FIRST failing segment (shell operator / first token not
      // allow-listed / dangerous flag / path outside allowed dirs / operator-artifact
      // redirect-only segment), replacing the previous hard-coded "path argument
      // outside session workspace/TMPDIR" message which misled diagnosis.
      if (segments.length > 0) {
        const failing = decisions[firstRejectedIndex];
        const reason = failing.approved ? "path_outside_boundary" : failing.reason;
        const failingSegment = segments[firstRejectedIndex];

        this.logger.warn(
          "Rejecting generic command: {reason} (command {index} of {total}: {command})",
          {
            reason,
            index: firstRejectedIndex,
            total: segments.length,
            command: failingSegment,
          },
        );

        // Single source of truth for the audit reason. The path case keeps the historical
        // `rejected_generic_command_out_of_workspace` code so existing monitoring queries
        // stay valid; the new causes get distinct codes. A string template like
        // `rejected_generic_command_{reason}` is NOT used because it would rename the
        // preserved path code.
        const auditReason = reason === "path_outside_boundary"
          ? "rejected_generic_command_out_of_workspace"
          : reason === "shell_operator"
          ? "rejected_generic_command_shell_operator"
          : reason === "first_token_not_allowed"
          ? "rejected_generic_command_first_token_not_allowed"
          : "rejected_generic_command_dangerous_flag";

        void this.writePermissionAudit(
          "permission_denied",
          title,
          kind,
          commands.join("; "),
          auditReason,
        );

        this.recordPermissionRejection(title, kind, failingSegment, auditReason);

        // Return reject immediately: falling through to default-deny would write a second,
        // contradictory `rejected_unknown` audit entry that misclassifies the cause.
        const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: rejectOption.optionId,
          },
        });
      }
    }

    // Extract skill name from tool call (only works for ToolCall, not ToolCallUpdate)
    let skillName = "";
    // Check if this is a complete ToolCall (not just an update)
    if ("rawInput" in params.toolCall && params.toolCall.rawInput) {
      skillName = this.extractSkillName(params.toolCall as acp.ToolCall);
    }

    // Check if this is one of our registered skills
    if (skillName && this.skillRegistry.hasSkill(skillName)) {
      this.logger.info("Auto-approving registered skill: {skillName}", { skillName });

      void this.writePermissionAudit(
        "permission_approved",
        skillName,
        kind,
        undefined,
        "registered_skill",
      );

      // Find "allow_once" option, or default to first option
      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Scoped edit/write: allow if ALL paths are within agent workspace or TMPDIR.
    // Classify by the ACP tool `kind` (OpenCode v1.17.13+ sends `kind: "edit"` with
    // `title` = file path for its write/edit/apply_patch/patch tools) with a legacy
    // title fallback for older OpenCode versions and other ACP agents. The ACP SDK
    // ToolKind vocabulary has no `"write"` kind, so `kind === "write"` alone could
    // never match a real request (legacy `title: "write"` is still accepted below).
    if (isEditWriteRequest(title, kind)) {
      let paths = locations.map((l) => l.path).filter(Boolean) as string[];

      // When locations are empty, try extracting paths from rawInput
      if (paths.length === 0 && rawInput) {
        const extracted = this.extractPathsFromRawInput(rawInput);
        if (extracted.length > 0) {
          paths = extracted;
          this.logger.debug(
            "Extracted paths from rawInput for edit/write permission: {paths}",
            { paths },
          );
        }
      }

      const gateCtx = this.gateCtx(params.sessionId);
      const currentGeneration = gateCtx?.generation ?? "";
      const builtCtxRes = buildSessionFilesystemContext(
        params.sessionId,
        gateCtx,
        this.config,
        currentGeneration,
      );

      const evaluateEditPermission = async (): Promise<
        { approved: boolean; reason?: string; failingPath?: string }
      > => {
        if (!builtCtxRes.ok) {
          return { approved: false, reason: builtCtxRes.reason, failingPath: paths.join(", ") };
        }
        if (paths.length === 0) {
          return { approved: false, reason: "rejected_edit_write", failingPath: undefined };
        }

        const sessionContext = builtCtxRes.context;
        const rootsRes = await this.observeFilesystemRoots(sessionContext, gateCtx?.trustedSkills);
        if (!rootsRes.ok) {
          const mapped = mapRootPathFailureToDenial(rootsRes.reason, true);
          return { approved: false, reason: mapped, failingPath: paths.join(", ") };
        }
        const roots = rootsRes.value;

        for (const p of paths) {
          const resolvedRes = resolveSessionPath(p, sessionContext);
          if (!resolvedRes.ok) {
            const mapped = mapRootPathFailureToDenial(resolvedRes.reason, true);
            return { approved: false, reason: mapped, failingPath: p };
          }
          const targetRes = await resolveFilesystemTarget(resolvedRes.value, roots, "file-or-new");
          if (!targetRes.ok) {
            const mapped = mapRootPathFailureToDenial(targetRes.reason, true);
            return { approved: false, reason: mapped, failingPath: p };
          }
          const auth = authorizeFilesystemWrite({
            roots,
            target: targetRes.value,
            yolo: false,
            canWriteAgentWorkspace: gateCtx?.canWriteAgentWorkspace === true,
            allowedWriteExtensions: gateCtx?.allowedWriteExtensions,
          });
          if (!auth.ok) {
            return { approved: false, reason: auth.reason, failingPath: p };
          }
        }
        if (this.gateCtx(params.sessionId)?.generation !== currentGeneration) {
          return { approved: false, reason: "rejected_filesystem_context" };
        }
        return { approved: true };
      };

      return evaluateEditPermission().then((res) => {
        if (res.approved) {
          this.logger.info("Auto-approving edit/write: {title}", { title, kind, paths });
          void this.writePermissionAudit(
            "permission_approved",
            title,
            kind,
            undefined,
            "agent_workspace_write",
          );
          const allowOption = params.options.find((o) => o.kind === "allow_once") ??
            params.options[0];
          return {
            outcome: { outcome: "selected" as const, optionId: allowOption.optionId },
          };
        }

        const denialReason = res.reason ?? "rejected_edit_write";
        this.logger.warn("Rejecting edit/write tool in restricted mode: {title}", {
          title,
          kind,
          paths,
          reason: denialReason,
        });
        void this.writePermissionAudit(
          "permission_denied",
          title,
          kind,
          undefined,
          denialReason,
        );
        this.recordPermissionRejection(
          title,
          kind,
          res.failingPath ?? paths.join(", "),
          denialReason,
        );
        const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
          params.options[0];
        return {
          outcome: { outcome: "selected" as const, optionId: rejectOption.optionId },
        };
      });
    } else {
      // For unknown tool calls, reject
      this.logger.warn("Rejecting unknown tool call", {
        skillName,
        title: params.toolCall.title,
      });

      void this.writePermissionAudit(
        "permission_denied",
        title,
        kind,
        undefined,
        "rejected_unknown",
      );

      this.recordPermissionRejection(title, kind, undefined, "rejected_unknown");
    }

    const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
      params.options[0];

    return Promise.resolve({
      outcome: {
        outcome: "selected",
        optionId: rejectOption.optionId,
      },
    });
  }

  /**
   * Handle session updates from the Agent
   * Logs various agent activities but doesn't send them externally
   */
  sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updateActivity();
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.flushThoughtBuffer();
        // Agent is generating response - log but don't send
        if (update.content.type === "text") {
          if (this.config.logAgentStreamChunks) {
            this.logger.debug("Agent message chunk: {text}", {
              text: update.content.text.substring(0, 100),
            });
          }
          // Accumulate text chunks for complete message logging
          this.messageBuffer.push(update.content.text);
        }
        break;

      case "tool_call":
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        this.logger.info(
          "Tool call started: {title} (id: {id}, kind: {kind})",
          {
            id: update.toolCallId,
            title: update.title,
            kind: update.kind,
            status: update.status,
          },
        );
        break;

      case "tool_call_update": {
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        // Log tool call updates with full context
        const logContext: Record<string, unknown> = {
          id: update.toolCallId,
          status: update.status,
        };

        // Add error information if status is failed
        if (update.status === "failed") {
          // ACP SDK may include error details in various fields
          const updateAny = update as Record<string, unknown>;
          if (updateAny.output) {
            logContext.output = updateAny.output;
          }
          if (updateAny.error) {
            logContext.error = updateAny.error;
          }
          if (updateAny.exitCode !== undefined) {
            logContext.exitCode = updateAny.exitCode;
          }
          // Log full update object for debugging
          logContext.fullUpdate = JSON.stringify(update);
          this.logger.error("Tool call {id} failed", logContext);
        } else {
          this.logger.info("Tool call {id} updated to status {status}", logContext);
        }
        break;
      }

      case "plan":
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        this.logger.debug("Agent plan", {
          entriesCount: update.entries?.length ?? 0,
        });
        break;

      case "agent_thought_chunk":
        this.flushMessageBuffer();
        // Agent's thinking process - only log
        {
          const updateAny = update as Record<string, unknown>;
          const contentText = update.content?.type === "text" &&
              typeof update.content.text === "string"
            ? update.content.text
            : undefined;
          const directText = typeof updateAny.text === "string" ? updateAny.text : "";
          const thoughtText = contentText ?? directText;
          if (this.config.logAgentStreamChunks) {
            this.logger.debug("Agent thought: {text}", {
              text: thoughtText.substring(0, 100),
            });
          }
          if (thoughtText.length > 0) {
            this.thoughtBuffer.push(thoughtText);
          }
        }
        break;

      case "usage_update": {
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        // Token usage information from the agent
        const usageUpdate = update as unknown as {
          sessionUpdate: "usage_update";
          used?: number;
          size?: number;
          cost?: { amount: number; currency: string };
        };
        this.logger.info("Agent usage update: tokens {used}/{size}", {
          used: usageUpdate.used,
          size: usageUpdate.size,
          cost: usageUpdate.cost,
        });
        break;
      }

      case "config_option_update": {
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        // Agent reports the complete updated config option state; propagate to the connector
        // so reasoning-effort discovery uses fresh options (e.g. after a model change).
        const notification = update as unknown as {
          sessionId?: string;
          configOptions?: acp.SessionConfigOption[];
        };
        const configOptions = notification.configOptions;
        if (Array.isArray(configOptions)) {
          this.logger.debug("Config options updated ({count} options)", {
            count: configOptions.length,
          });
          this.configOptionsListener?.(notification.sessionId ?? "", configOptions);
        } else {
          // Defensive: notification shape lacked a parseable configOptions array.
          // Log so silent cache staleness is diagnosable instead of invisible.
          this.logger.warn(
            "config_option_update received without a parseable configOptions array",
          );
        }
        break;
      }

      default:
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        this.logger.debug("Session update", {
          type: (update as { sessionUpdate?: string }).sessionUpdate,
        });
    }

    return Promise.resolve();
  }

  /**
   * Handle file read requests from the Agent
   * Authorizes canonical roots and performs protected content IO only.
   */
  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Read file requested", { path: params.path });

    const gateCtx = this.gateCtx(params.sessionId);
    const currentGeneration = gateCtx?.generation ?? "";
    const builtCtxRes = buildSessionFilesystemContext(
      params.sessionId,
      gateCtx,
      this.config,
      currentGeneration,
    );

    if (!builtCtxRes.ok) {
      this.rejectFilesystemRequest("readTextFile", params.path, builtCtxRes.reason);
    }

    const sessionContext = builtCtxRes.context;
    const resolvedPathRes = resolveSessionPath(params.path, sessionContext);
    if (!resolvedPathRes.ok) {
      const denialReason = mapRootPathFailureToDenial(resolvedPathRes.reason, false);
      this.rejectFilesystemRequest("readTextFile", params.path, denialReason);
    }

    const rootsRes = await this.observeFilesystemRoots(sessionContext, gateCtx?.trustedSkills);
    if (!rootsRes.ok) {
      const denialReason = mapRootPathFailureToDenial(rootsRes.reason, false);
      this.rejectFilesystemRequest(
        "readTextFile",
        resolvedPathRes.value.normalizedPath,
        denialReason,
      );
    }

    const targetRes = await resolveFilesystemTarget(
      resolvedPathRes.value,
      rootsRes.value,
      "existing-file",
    );
    if (!targetRes.ok) {
      const denialReason = mapRootPathFailureToDenial(targetRes.reason, false);
      this.rejectFilesystemRequest(
        "readTextFile",
        resolvedPathRes.value.normalizedPath,
        denialReason,
      );
    }

    const authRes = authorizeFilesystemRead({
      roots: rootsRes.value,
      target: targetRes.value,
      allowedReadExtensions: ALLOWED_READ_EXTENSIONS,
    });
    if (!authRes.ok) {
      this.rejectFilesystemRequest("readTextFile", targetRes.value.canonicalTarget, authRes.reason);
    }

    // Currency check: ensure context generation has not changed
    if (this.gateCtx(params.sessionId)?.generation !== currentGeneration) {
      this.rejectFilesystemRequest(
        "readTextFile",
        targetRes.value.canonicalTarget,
        "rejected_trusted_skills_identity",
      );
    }

    const readRes = readCanonicalTextFile({
      context: sessionContext,
      roots: rootsRes.value,
      target: targetRes.value,
      selectedRole: authRes.role,
      nativeCalls: this.config.nativeCalls,
    });
    if (!readRes.ok) {
      const denialReason = mapAccessFailureToDenial(readRes.reason, false);
      this.rejectFilesystemRequest("readTextFile", targetRes.value.canonicalTarget, denialReason);
    }

    return { content: readRes.value };
  }

  /**
   * Handle file write requests from the Agent
   * Authorizes writes independently of any preceding permission request.
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Write file requested", { path: params.path });

    const gateCtx = this.gateCtx(params.sessionId);
    const currentGeneration = gateCtx?.generation ?? "";
    const builtCtxRes = buildSessionFilesystemContext(
      params.sessionId,
      gateCtx,
      this.config,
      currentGeneration,
    );

    if (!builtCtxRes.ok) {
      this.rejectFilesystemRequest("writeTextFile", params.path, builtCtxRes.reason);
    }

    const sessionContext = builtCtxRes.context;
    const resolvedPathRes = resolveSessionPath(params.path, sessionContext);
    if (!resolvedPathRes.ok) {
      const denialReason = mapRootPathFailureToDenial(resolvedPathRes.reason, true);
      this.rejectFilesystemRequest("writeTextFile", params.path, denialReason);
    }

    const rootsRes = await this.observeFilesystemRoots(sessionContext, gateCtx?.trustedSkills);
    if (!rootsRes.ok) {
      const denialReason = mapRootPathFailureToDenial(rootsRes.reason, true);
      this.rejectFilesystemRequest(
        "writeTextFile",
        resolvedPathRes.value.normalizedPath,
        denialReason,
      );
    }

    const targetRes = await resolveFilesystemTarget(
      resolvedPathRes.value,
      rootsRes.value,
      "file-or-new",
    );
    if (!targetRes.ok) {
      const denialReason = mapRootPathFailureToDenial(targetRes.reason, true);
      this.rejectFilesystemRequest(
        "writeTextFile",
        resolvedPathRes.value.normalizedPath,
        denialReason,
      );
    }

    const authRes = authorizeFilesystemWrite({
      roots: rootsRes.value,
      target: targetRes.value,
      yolo: gateCtx?.yolo ?? false,
      canWriteAgentWorkspace: gateCtx?.canWriteAgentWorkspace === true,
      allowedWriteExtensions: gateCtx?.allowedWriteExtensions,
    });
    if (!authRes.ok) {
      this.rejectFilesystemRequest(
        "writeTextFile",
        targetRes.value.canonicalTarget,
        authRes.reason,
      );
    }

    // Currency check: ensure context generation has not changed
    if (this.gateCtx(params.sessionId)?.generation !== currentGeneration) {
      this.rejectFilesystemRequest(
        "writeTextFile",
        targetRes.value.canonicalTarget,
        "rejected_trusted_skills_identity",
      );
    }

    const writeRes = writeCanonicalTextFile({
      context: sessionContext,
      roots: rootsRes.value,
      target: targetRes.value,
      selectedRole: authRes.role,
      content: params.content,
      nativeCalls: this.config.nativeCalls,
    });
    if (!writeRes.ok) {
      const denialReason = mapAccessFailureToDenial(writeRes.reason, true);
      this.rejectFilesystemRequest("writeTextFile", targetRes.value.canonicalTarget, denialReason);
    }

    return {};
  }

  /**
   * Extract skill name from tool call
   * Tries rawInput.skill field first, then falls back to title
   */
  private extractSkillName(toolCall: acp.ToolCall): string {
    const rawInput = toolCall.rawInput as { skill?: string } | undefined;
    return rawInput?.skill ?? toolCall.title ?? "";
  }

  /**
   * Create skill context for skill execution
   */
  private createSkillContext(): Partial<SkillContext> {
    return {
      channelId: this.config.channelId,
      userId: this.config.userId,
      // Note: workspace and platformAdapter should be added by caller
    };
  }

  /**
   * Try to extract file paths from rawInput when locations are empty.
   * Different ACP agents may include paths in various rawInput fields.
   */
  private extractPathsFromRawInput(rawInput: Record<string, unknown>): string[] {
    const paths: string[] = [];

    // Single path fields (common across agent types)
    for (const field of ["path", "file_path", "filePath", "filepath", "file", "filename"]) {
      const value = rawInput[field];
      if (typeof value === "string" && value.length > 0) {
        paths.push(value);
      }
    }

    // Array path fields
    for (const field of ["paths", "files"]) {
      const value = rawInput[field];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.length > 0) {
            paths.push(item);
          }
        }
      }
    }

    return paths;
  }

  /**
   * Mark that a reply has been sent (for preventing duplicate replies)
   */
  markReplySent(): void {
    this.replyAlreadySent = true;
  }

  private flushAccumulatedBuffer(type: "message" | "thought"): void {
    const buffer = type === "message" ? this.messageBuffer : this.thoughtBuffer;
    if (buffer.length === 0) return;

    if (type === "message") {
      this.messageBuffer = [];
    } else {
      this.thoughtBuffer = [];
    }

    const completeText = buffer.join("");
    const chunkCount = buffer.length;
    const textLen = completeText.length;

    if (type === "message") {
      this.logger.info(
        "Agent complete message ({chunkCount} chunks, {length} chars): {message}",
        {
          message: completeText,
          chunkCount,
          length: textLen,
        },
      );
    } else {
      this.logger.info(
        "Agent complete thought ({chunkCount} chunks, {length} chars): {thought}",
        {
          thought: completeText,
          chunkCount,
          length: textLen,
        },
      );
    }

    if (this.auditWriter) {
      const writer = this.auditWriter;
      const hashContent = writer.getConfig().hashContent;
      const ts = new Date().toISOString();
      const phase = type === "message" ? "agent_complete_message" : "agent_complete_thought";

      if (hashContent) {
        sha256Hash(completeText)
          .then((hash) => {
            void writer.write(
              phase,
              type === "message"
                ? {
                  messageContentHash: `sha256:${hash}`,
                  messageLength: textLen,
                  chunkCount,
                }
                : {
                  thoughtContentHash: `sha256:${hash}`,
                  thoughtLength: textLen,
                  chunkCount,
                },
              ts,
            );
          })
          .catch((error) => {
            this.logger.warn("Failed to hash complete {type} for audit entry", {
              type,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      } else {
        void writer.write(
          phase,
          type === "message"
            ? {
              messageContentHash: completeText,
              messageLength: textLen,
              chunkCount,
            }
            : {
              thoughtContentHash: completeText,
              thoughtLength: textLen,
              chunkCount,
            },
          ts,
        );
      }
    }
  }

  /**
   * Flush the accumulated agent message chunks as a single complete message log entry.
   * Called when a non-chunk session update arrives or when the prompt completes.
   */
  flushMessageBuffer(): void {
    this.flushAccumulatedBuffer("message");
  }

  /**
   * Flush the accumulated agent thought chunks as a single complete thought log entry.
   * Called when a non-thought-chunk session update arrives or when the prompt completes.
   */
  flushThoughtBuffer(): void {
    this.flushAccumulatedBuffer("thought");
  }

  /**
   * Reset client state for new session
   */
  reset(): void {
    this.flushThoughtBuffer();
    this.flushMessageBuffer();
    this.replyAlreadySent = false;
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Get whether reply has been sent
   */
  hasReplySent(): boolean {
    return this.replyAlreadySent;
  }
}
