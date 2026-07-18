// src/acp/client.ts

import * as acp from "@agentclientprotocol/sdk";
import { join, resolve, SEPARATOR } from "@std/path";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import type { ClientConfig } from "./types.ts";
import type { SkillContext } from "@skills/types.ts";
import type { SessionAuditWriter } from "@core/audit-logger.ts";
import { sha256Hash } from "@utils/hash.ts";

/**
 * Auto-approved skill lists for restricted (non-YOLO) mode.
 */
export interface SkillAutoApproveList {
  /** Script skill path suffixes: "skills/memory-save/scripts/memory-save.ts" */
  scriptPaths: Set<string>;
  /** Command skill prefixes: "agent-browser" */
  commandPrefixes: Set<string>;
}

/**
 * Build skill auto-approve list.
 * When configuredSkills is provided and non-empty, builds the list from config.
 * Otherwise falls back to scanning the skills directory (backward compatible).
 */
export function buildSkillAutoApproveList(
  skillsDir: string,
  configuredSkills?: string[],
): SkillAutoApproveList {
  if (configuredSkills && configuredSkills.length > 0) {
    return buildFromConfig(skillsDir, configuredSkills);
  }
  return buildFromDirectory(skillsDir);
}

/**
 * Build auto-approve list from configured skill names.
 * Scans both the built-in skills directory and ~/.agents/skills/ for external skills.
 */
function buildFromConfig(
  skillsDir: string,
  configuredSkills: string[],
): SkillAutoApproveList {
  const scriptPaths = new Set<string>();
  const commandPrefixes = new Set<string>();

  const scanDirs = [skillsDir];
  const homeSkillsDir = join(Deno.env.get("HOME") ?? "/home/deno", ".agents", "skills");
  try {
    Deno.statSync(homeSkillsDir);
    scanDirs.push(homeSkillsDir);
  } catch {
    // External skills directory doesn't exist
  }

  for (const skillName of configuredSkills) {
    let found = false;
    for (const dir of scanDirs) {
      const scriptsPath = join(dir, skillName, "scripts");
      try {
        for (const script of Deno.readDirSync(scriptsPath)) {
          if (script.isFile && script.name.endsWith(".ts")) {
            scriptPaths.add(`skills/${skillName}/scripts/${script.name}`);
            found = true;
          }
        }
      } catch {
        // No scripts dir in this scan path
      }
    }
    if (!found) {
      // Command-based skill or not yet installed
      commandPrefixes.add(skillName);
    }
  }

  return { scriptPaths, commandPrefixes };
}

/**
 * Build auto-approve list by scanning the skills directory (fallback).
 */
function buildFromDirectory(skillsDir: string): SkillAutoApproveList {
  const scriptPaths = new Set<string>();
  const commandPrefixes = new Set<string>();

  try {
    for (const entry of Deno.readDirSync(skillsDir)) {
      if (!entry.isDirectory || entry.name === "lib") continue;

      const scriptsPath = join(skillsDir, entry.name, "scripts");
      try {
        for (const script of Deno.readDirSync(scriptsPath)) {
          if (script.isFile && script.name.endsWith(".ts")) {
            scriptPaths.add(`skills/${entry.name}/scripts/${script.name}`);
          }
        }
      } catch {
        // No scripts dir — this is a command-based skill
        commandPrefixes.add(entry.name);
      }
    }
  } catch {
    // Skills directory not found — return empty lists
  }

  return { scriptPaths, commandPrefixes };
}

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
 * Check whether a file path's extension is in the given allowlist (case-insensitive).
 */
function hasAllowedExtension(filePath: string, allowed: string[]): boolean {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filePath.length - 1) return false;
  const ext = filePath.substring(dotIndex).toLowerCase();
  return allowed.some((e) => ext === e.toLowerCase());
}

/**
 * Check if a command string contains shell operators that could enable injection.
 * Rejects commands containing: ; | & ` ( ) > < # and newlines.
 * Note: $ is intentionally allowed for shell variable expansion ($HOME, ${VAR}).
 * Command substitution $() is still caught because ( is rejected.
 */
export function containsShellOperators(cmd: string): boolean {
  return /[;|&`()><#\n]/.test(cmd);
}

/** Interpreters that may precede a skill script as the launcher (e.g. `deno run <script>`). */
const ALLOWED_SCRIPT_INTERPRETERS = new Set(["deno"]);

/**
 * Determine whether a single token equals the whitelisted script path or ends with
 * `/<allowedPath>` (so an absolute/`$HOME`-anchored path to the same script matches).
 */
function tokenMatchesAllowedScript(token: string, allowedPath: string): boolean {
  return token === allowedPath || token.endsWith(`/${allowedPath}`);
}

/**
 * Resolve the invocation ENTRYPOINT token of a command.
 *
 * Skills are executed either directly via their shebang
 * (`${HOME}/.agents/skills/<name>/scripts/<name>.ts <args>`) — first token is the
 * script — or via an interpreter (`deno run <flags> <script> <args>`) — the script
 * is the first non-flag positional after the `run` subcommand.
 *
 * Returns the entrypoint token, or `undefined` if it cannot be determined.
 */
function resolveEntrypointToken(tokens: string[]): string | undefined {
  if (tokens.length === 0) return undefined;

  const first = tokens[0];
  // Direct shebang execution: the script itself is the entrypoint.
  if (!ALLOWED_SCRIPT_INTERPRETERS.has(first)) {
    return first;
  }

  // Interpreter launch (e.g. `deno run <flags...> <script> <args>`): find the first
  // non-flag positional token AFTER the `run` subcommand. Flags (leading `-`) and the
  // `run` subcommand itself are skipped; the next positional is the entrypoint.
  let sawRun = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!sawRun) {
      if (t === "run") sawRun = true;
      // Skip interpreter-level flags/subcommands until we see `run`.
      continue;
    }
    if (t.startsWith("-")) continue; // skip `deno run` flags (e.g. --allow-net)
    return t; // first positional after `run` is the entrypoint script
  }
  return undefined;
}

/**
 * Check whether a command's INVOCATION ENTRYPOINT is an allowed skill script.
 *
 * Security (F2): the whitelisted script path is only accepted when it is the actual
 * invocation entrypoint — either the first token (direct shebang execution) or the
 * first positional after `deno run`. A whitelisted script path appearing merely as a
 * trailing ARGUMENT to some other command (e.g. `cat <secret> <script>`) is NOT approved,
 * closing the "arbitrary first token launders an allowed path" bypass.
 */
export function matchesScriptPath(cmd: string, allowedPath: string): boolean {
  if (containsShellOperators(cmd)) return false;
  const tokens = cmd.trim().split(/\s+/).filter((t) => t.length > 0);
  const entrypoint = resolveEntrypointToken(tokens);
  if (entrypoint === undefined) return false;
  return tokenMatchesAllowedScript(entrypoint, allowedPath);
}

/**
 * Determine whether an argument token references a path OUTSIDE the workspace.
 * Rejects absolute paths (`/etc/...`), home-anchored paths (`~/...`, `$HOME/...`),
 * and parent-traversal (`../`). Workspace-relative paths and non-path flags/values
 * are allowed. Used to keep a whitelisted command prefix from being used to read
 * sensitive files (e.g. `agent-browser /home/deno/.git-credentials`).
 */
export function referencesOutOfWorkspacePath(token: string): boolean {
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
  if (containsShellOperators(cmd)) return false;
  const tokens = cmd.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens[0] !== prefix) return false;
  // Reject if any argument references a path outside the workspace.
  for (let i = 1; i < tokens.length; i++) {
    if (referencesOutOfWorkspacePath(tokens[i])) return false;
  }
  return true;
}

/**
 * Generic-command allow-list (F12 D2): the search/read and document/media/archive
 * utilities the restricted profile exposes. Because `agent-config/opencode.json` routes
 * these tools to `"ask"` (not `"allow"`), OpenCode forwards their execution to this ACP
 * gate; without an explicit allow-list they would hit default-deny and break every
 * legitimate in-workspace use. `agent-browser` is deliberately NOT here — its `file://`
 * argument is rejected by `referencesOutOfWorkspacePath` (D3) and its network behavior is
 * F14's concern. Interpreters and mutating system tools (`python`, `git`, `rm`, `mv`, `dd`,
 * `chmod`, `mkdir`, ...) are NOT here and remain default-deny.
 */
export const GENERIC_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set([
  // Plain search/read/stat primitives whose ONLY file access is via ordinary path arguments
  // (which the workspace-containment check below can see). Tools with their own file-reading
  // argument DSL, an argument/response indirection file, an embedded protocol/coder, or an
  // -exec/-delete/preprocessor code-exec facility are deliberately EXCLUDED — a lexical
  // path check cannot bound those (e.g. ImageMagick `caption:@/proc/1/environ`, `exiftool -@`
  // argfile, `ffmpeg -f lavfi -i movie=/etc/passwd`, `pandoc --lua-filter`, `7zz -o/etc`,
  // archive path traversal). Those tools are only safe under the F12 D4 bwrap confinement,
  // which contains them regardless of argv; until confinement is enabled+verified they stay
  // default-denied at this gate.
  "rg",
  "cat",
  "head",
  "tail",
  "ls",
  "find",
  "wc",
  "file",
  "tree",
  "jq",
  "pdftotext",
  "pdfinfo",
  "pdfimages",
  "pdftoppm",
]);

/**
 * Argument flags that turn an allow-listed tool into a code-execution or arbitrary-file
 * read/write primitive whose target is NOT an ordinary path token (so the workspace check
 * cannot see it). Presence of any of these rejects the whole command. Examples:
 *   `find . -exec cat {} +` / `find . -delete` / `find . -fprintf /etc/x %p`  (find)
 *   `rg --pre <cmd> pattern .`                                                  (rg preprocessor)
 */
const DANGEROUS_GENERIC_FLAGS: ReadonlySet<string> = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprintf",
  "-fprint",
  "-fprint0",
  "-fls",
  "--pre",
  "-@",
  "--files-from",
  "-T",
  "--lua-filter",
  "--filter",
]);

/**
 * Determine whether a single command argument stays inside the allowed workspace dirs.
 *
 * The agent's cwd is the session workspace, so relative tokens (search patterns, numbers,
 * flags, relative file names) always resolve inside it and pass harmlessly. Only tokens
 * that can escape — URI schemes, home-anchored paths, absolute paths, and parent traversal
 * — are resolved and containment-checked against the allowed dirs. This is an
 * over-approximation (a non-path relative token is treated as a harmless in-workspace path),
 * which is safe because the decision only ever GRANTS in-workspace access.
 */
function genericArgWithinWorkspace(
  token: string,
  base: string,
  allowedDirs: string[],
): boolean {
  let t = token;
  const eq = t.indexOf("=");
  if (eq !== -1 && t.startsWith("-")) t = t.substring(eq + 1);
  t = t.replace(/^["']+/, "").replace(/["']+$/, "");
  if (t.length === 0) return true;

  // URI schemes and home-anchored paths cannot be safely resolved into the workspace.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return false;
  if (t.startsWith("~") || t.startsWith("$HOME") || t.startsWith("${HOME}")) return false;
  // Attached-value flag carrying an out-of-workspace path (e.g. a hypothetical `-o/etc/cron.d`):
  // a `-`-prefixed token whose glued value is an absolute path or contains parent traversal.
  // (The `--flag=value` form is already normalized above.)
  if (t.startsWith("-") && (/^-{1,2}[a-zA-Z][a-zA-Z0-9-]*\//.test(t) || t.includes("/../"))) {
    return false;
  }

  // Absolute or relative (incl. `../`): resolve and require containment. `resolve()`
  // normalizes traversal, so `a/../../etc` escaping the workspace is rejected here.
  const resolved = t.startsWith("/") ? resolve(t) : resolve(base, t);
  return allowedDirs.some((d) => isWithinDir(resolved, d));
}

/**
 * Approve a generic bash command only when its first token is on {@link GENERIC_COMMAND_ALLOWLIST}
 * AND every path-like argument — read input OR write/output target — resolves inside the
 * session workspace/TMPDIR (F12 D2). `base` is the agent cwd used to resolve relative tokens;
 * `allowedDirs` are the containment boundaries (session workspace, agent workspace).
 */
export function isApprovedGenericCommand(
  cmd: string,
  base: string,
  allowedDirs: string[],
): boolean {
  if (containsShellOperators(cmd)) return false;
  const tokens = cmd.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  if (!GENERIC_COMMAND_ALLOWLIST.has(tokens[0])) return false;
  for (let i = 1; i < tokens.length; i++) {
    // A code-exec / arbitrary-target flag rejects the whole command (e.g. `find -exec`,
    // `find -delete`, `rg --pre`), independent of whether its path arguments are in-workspace.
    if (DANGEROUS_GENERIC_FLAGS.has(tokens[i])) return false;
    if (!genericArgWithinWorkspace(tokens[i], base, allowedDirs)) return false;
  }
  return true;
}

/**
 * ChatbotClient implements the ACP Client interface
 * Handles callbacks from the external OpenCode ACP Agent
 */
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
   * Optional listener invoked when the Agent sends a `config_option_update`
   * notification, so the AgentConnector can refresh its cached config options.
   */
  private configOptionsListener?: (configOptions: acp.SessionConfigOption[]) => void;

  /**
   * Optional listener invoked on every observed Agent activity (F13). Used to
   * keep the Skill API session's idle timer aligned with real agent liveness,
   * so a long, active turn is never evicted for lack of a skill call.
   */
  private activityListener?: () => void;

  constructor(
    skillRegistry: SkillRegistry,
    logger: Logger,
    config: ClientConfig,
    skillAutoApproveList?: SkillAutoApproveList,
  ) {
    this.skillRegistry = skillRegistry;
    this.logger = logger;
    this.config = config;
    this.skillAutoApproveList = skillAutoApproveList ??
      buildSkillAutoApproveList(join(Deno.cwd(), "skills"));
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
   * Register a listener that receives the complete config options list whenever the
   * Agent emits a `config_option_update` notification. Used by AgentConnector to keep
   * its cached config options fresh (e.g. after a model change alters `thought_level`).
   */
  setConfigOptionsListener(
    listener: (configOptions: acp.SessionConfigOption[]) => void,
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
   * Handle permission requests from the Agent
   * Auto-approves our registered skills and access to skills directory
   * In YOLO mode, auto-approves ALL permission requests
   */
  requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    this.updateActivity();
    this.logger.debug("Permission requested", {
      toolCall: params.toolCall,
      kind: params.toolCall.kind,
      yolo: this.config.yolo,
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

    // YOLO mode: auto-approve everything
    if (this.config.yolo) {
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

    // Auto-approve read access to skills directories.
    // External agents need to read SKILL.md files to understand available skills.
    // OpenCode discovers skills from `~/.agents/skills` (external/installed skills) and the
    // repo-local `skills/` directory. We approve reads anchored to any of these roots using
    // boundary-safe matching so a sibling-prefix path cannot slip through.
    if (params.toolCall.kind === "read" && params.toolCall.locations) {
      const home = Deno.env.get("HOME") ?? "/home/deno";
      const skillsRoots = [
        join(home, ".agents", "skills"),
        join(Deno.cwd(), "skills"),
      ];
      const isReadingSkills = params.toolCall.locations.some((loc) =>
        loc.path !== undefined &&
        skillsRoots.some((root) => isWithinDir(loc.path!, root))
      );

      if (isReadingSkills) {
        this.logger.info("Auto-approving skills directory read: {path}", {
          path: params.toolCall.locations.map((l) => l.path).join(", "),
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

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }
    }

    // Auto-approve shell execution for our skill commands (whitelist-based)
    if (params.toolCall.kind === "execute") {
      const rawInput = params.toolCall.rawInput as
        | { command?: string; commands?: string[] }
        | undefined;
      const commands = rawInput?.commands ?? (rawInput?.command ? [rawInput.command] : []);

      // Check if all commands match our skill allow list
      const isSkillCommand = commands.length > 0 &&
        commands.every((cmd) => {
          // Check script-based skills (safe token match against allowed paths)
          const isScript = Array.from(this.skillAutoApproveList.scriptPaths).some(
            (allowedPath) => matchesScriptPath(cmd, allowedPath),
          );
          if (isScript) return true;

          // Check command-based skills (safe first-token match against allowed prefixes)
          const isCommand = Array.from(this.skillAutoApproveList.commandPrefixes).some(
            (prefix) => matchesCommandPrefix(cmd, prefix),
          );
          return isCommand;
        });

      if (isSkillCommand) {
        this.logger.info("Auto-approving skill shell execution: {command}", {
          command: commands.join("; "),
        });

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          commands.join("; "),
          "skill_whitelist",
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

      // Generic-command workspace confinement (F12 D2). Filesystem-touching bash tools
      // are routed here (configured "ask", not "allow"), so this gate is the authoritative
      // decision point for them. Approve only when every command's first token is on the
      // allow-list AND all path arguments (inputs and outputs) resolve inside the session
      // workspace/TMPDIR; otherwise fall through to default-deny.
      const allowedDirs = [this.config.workingDir];
      if (this.config.agentWorkspacePath) {
        allowedDirs.push(this.config.agentWorkspacePath);
      }
      const isConfinedGenericCommand = commands.length > 0 &&
        commands.every((cmd) => isApprovedGenericCommand(cmd, this.config.workingDir, allowedDirs));

      if (isConfinedGenericCommand) {
        this.logger.info("Auto-approving workspace-confined generic command: {command}", {
          command: commands.join("; "),
        });

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          commands.join("; "),
          "generic_command_workspace_confined",
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

      // A filesystem-touching command that escapes the workspace: log the rejection
      // reason before falling through to default-deny for operational visibility.
      if (commands.length > 0) {
        this.logger.warn(
          "Rejecting generic command: path argument outside session workspace/TMPDIR",
          { commands },
        );
        void this.writePermissionAudit(
          "permission_denied",
          title,
          kind,
          commands.join("; "),
          "rejected_generic_command_out_of_workspace",
        );
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

    // Scoped edit/write: allow if ALL paths are within agent workspace or TMPDIR
    if (title === "edit" || title === "edit_file" || kind === "write" as string) {
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

      const isAgentWorkspaceWrite = paths.length > 0 &&
        paths.every((p) => this.isAgentWorkspacePath(p!));

      if (isAgentWorkspaceWrite) {
        // Identify non-TMPDIR agent-workspace paths (i.e. shared workspace writes).
        const sharedWorkspacePaths = paths.filter((p) => !this.isWithinTmpDir(p!));

        // Write-gating (F3): shared agent-workspace writes require canWriteAgentWorkspace.
        // Only self-research sessions are authorized to author shared notes. TMPDIR writes
        // (per-session scratch) are exempt.
        if (sharedWorkspacePaths.length > 0 && this.config.canWriteAgentWorkspace !== true) {
          this.logger.warn(
            "Rejecting edit/write to shared agent workspace: session not authorized to write (canWriteAgentWorkspace not set)",
            { title, kind, paths: sharedWorkspacePaths },
          );

          void this.writePermissionAudit(
            "permission_denied",
            title,
            kind,
            undefined,
            "rejected_agent_workspace_write_unauthorized",
          );

          const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
            params.options[0];
          return Promise.resolve({
            outcome: { outcome: "selected", optionId: rejectOption.optionId },
          });
        }

        // Check extension restrictions for non-TMPDIR agent workspace paths
        const disallowedPaths = paths.filter((p) => {
          return !this.isWithinTmpDir(p!) && !this.hasAllowedWriteExtension(p!);
        });

        if (disallowedPaths.length > 0) {
          this.logger.warn(
            "Rejecting edit/write due to disallowed file extension: {title}",
            {
              title,
              kind,
              paths: disallowedPaths,
              allowedExtensions: this.config.allowedWriteExtensions,
            },
          );

          void this.writePermissionAudit(
            "permission_denied",
            title,
            kind,
            undefined,
            "rejected_write_extension",
          );
        } else {
          this.logger.info(
            "Auto-approving edit/write to agent workspace: {title}",
            { title, kind, paths },
          );

          void this.writePermissionAudit(
            "permission_approved",
            title,
            kind,
            undefined,
            "agent_workspace_write",
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
      }

      this.logger.warn("Rejecting edit/write tool in restricted mode: {title}", {
        title,
        kind,
        paths,
      });

      void this.writePermissionAudit(
        "permission_denied",
        title,
        kind,
        undefined,
        "rejected_edit_write",
      );
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
          this.logger.debug("Agent message chunk: {text}", {
            text: update.content.text.substring(0, 100),
          });
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
          this.logger.debug("Agent thought: {text}", {
            text: thoughtText.substring(0, 100),
          });
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
        const configOptions = (update as unknown as {
          configOptions?: acp.SessionConfigOption[];
        }).configOptions;
        if (Array.isArray(configOptions)) {
          this.logger.debug("Config options updated ({count} options)", {
            count: configOptions.length,
          });
          this.configOptionsListener?.(configOptions);
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
   * Only allows reading files within the working directory
   */
  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Read file requested", { path: params.path });

    // Validate path is within working directory (boundary-safe)
    if (!this.isPathAllowed(params.path)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    // Read-extension allowlist (F4): only workspace memory (`.jsonl`), markdown (`.md`),
    // and plain text (`.txt`) may be read. This blocks reads of arbitrary sensitive text
    // files (e.g. `.json` token/cache files) that could live inside an allowed directory.
    if (!hasAllowedExtension(params.path, ALLOWED_READ_EXTENSIONS)) {
      this.logger.warn("Rejecting read due to disallowed file extension: {path}", {
        path: params.path,
        allowedExtensions: ALLOWED_READ_EXTENSIONS,
      });
      throw new acp.RequestError(
        -32600,
        `Access denied: file extension not allowed for reads (permitted: ${
          ALLOWED_READ_EXTENSIONS.join(", ")
        })`,
      );
    }

    try {
      const content = await Deno.readTextFile(params.path);
      return { content };
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle file write requests from the Agent
   * Only allows writing files within the working directory
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Write file requested", { path: params.path });

    // Validate path is within working directory
    if (!this.isPathAllowed(params.path)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    // Defense-in-depth: gate agent-workspace writes in restricted mode.
    // This is a SEPARATE sink from requestPermission() (an agent may call writeTextFile
    // directly), so the same F3 write-gating and F4 extension checks are enforced here too.
    if (!this.config.yolo) {
      const isSharedWorkspaceWrite = this.config.agentWorkspacePath
        ? isWithinDir(params.path, this.config.agentWorkspacePath) &&
          !this.isWithinTmpDir(params.path)
        : false;

      if (isSharedWorkspaceWrite) {
        // Write-gating (F3): shared agent-workspace writes require canWriteAgentWorkspace.
        if (this.config.canWriteAgentWorkspace !== true) {
          this.logger.warn(
            "Rejecting writeTextFile to shared agent workspace: session not authorized (canWriteAgentWorkspace not set)",
            { path: params.path },
          );
          throw new acp.RequestError(
            -32600,
            "Access denied: session not authorized to write to the shared agent workspace",
          );
        }

        if (!this.hasAllowedWriteExtension(params.path)) {
          throw new acp.RequestError(
            -32600,
            `Access denied: file extension not allowed for agent workspace writes (permitted: ${
              this.config.allowedWriteExtensions?.join(", ")
            })`,
          );
        }
      }
    }

    try {
      await Deno.writeTextFile(params.path, params.content);
      return {};
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
   * Validate that a path is within the allowed directories
   * Allows: user workspace OR agent global workspace
   */
  private isPathAllowed(path: string): boolean {
    try {
      if (isWithinDir(path, this.config.workingDir)) return true;

      if (this.config.agentWorkspacePath && isWithinDir(path, this.config.agentWorkspacePath)) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is within the agent workspace or workspace TMPDIR.
   * Used to scope edit/write permissions for self-research.
   * Equivalent to agent-config/opencode.json: "edit": { "data/agent-workspace/**": "allow", "$TMPDIR/**": "allow" }
   */
  private isAgentWorkspacePath(path: string): boolean {
    try {
      // Check agent workspace path (boundary-safe)
      if (this.config.agentWorkspacePath && isWithinDir(path, this.config.agentWorkspacePath)) {
        return true;
      }

      // Check workspace TMPDIR
      if (this.isWithinTmpDir(path)) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is within the workspace TMPDIR (boundary-safe).
   */
  private isWithinTmpDir(path: string): boolean {
    return isWithinDir(path, resolve(this.config.workingDir, "tmp"));
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
   * Check if a file path has an allowed write extension for agent workspace writes.
   * Returns true if no restrictions are configured or if the extension is in the allowed list.
   */
  private hasAllowedWriteExtension(filePath: string): boolean {
    const extensions = this.config.allowedWriteExtensions;
    if (!extensions || extensions.length === 0) return true;
    const dotIndex = filePath.lastIndexOf(".");
    if (dotIndex === -1 || dotIndex === filePath.length - 1) return false;
    const ext = filePath.substring(dotIndex).toLowerCase();
    return extensions.some((e) => ext === e.toLowerCase());
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
