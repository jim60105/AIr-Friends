import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  buildCommandGateRoots,
  DANGEROUS_GENERIC_FLAGS,
  GENERIC_COMMAND_ALLOWLIST,
  genericCommandRejectionReason,
  multiCommandRejectionReason,
} from "@acp/command-path-policy.ts";
import { defaultMetadataReader, type MetadataReader } from "@acp/filesystem-roots.ts";
import { createCommandFixture } from "./command-test-fixture.ts";

Deno.test("command parity manifest fixes the complete allowlist and dangerous flags", () => {
  assertEquals([...GENERIC_COMMAND_ALLOWLIST], [
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
  assertEquals([...DANGEROUS_GENERIC_FLAGS], [
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
});

Deno.test("canonical command parent/final escapes deny; contained links and prospective outputs approve", async () => {
  const f = createCommandFixture();
  const causes: string[] = [];
  const context = { ...f.context, logFailure: (reason: string) => causes.push(reason) };
  try {
    for (
      const [name, target] of [
        ["external-file", join(f.root, "external.txt")],
        ["foreign-file", join(f.sibling, "secret.md")],
        ["external-parent", f.root],
        ["foreign-parent", f.sibling],
      ]
    ) Deno.symlinkSync(target, join(f.workspace, name));
    for (
      const path of [
        "external-file",
        "foreign-file",
        "external-parent/external.txt",
        "foreign-parent/secret.md",
      ]
    ) {
      causes.length = 0;
      assertEquals(
        await genericCommandRejectionReason(`cat ${path}`, context),
        "path_outside_boundary",
      );
      assertEquals(causes, ["symlink_escape"]);
    }
    Deno.symlinkSync(join(f.workspace, "notes.md"), join(f.workspace, "contained-file"));
    Deno.symlinkSync(join(f.workspace, "subdir"), join(f.workspace, "contained-parent"));
    assertEquals(await genericCommandRejectionReason("cat contained-file", context), null);
    assertEquals(
      await genericCommandRejectionReason("cat contained-parent/file.txt", context),
      null,
    );
    assertEquals(
      await genericCommandRejectionReason(
        "pdftotext notes.md contained-parent/new/output.txt",
        context,
      ),
      null,
    );
    assertEquals(
      await genericCommandRejectionReason("pdftotext notes.md foreign-parent/new.txt", context),
      "path_outside_boundary",
    );
  } finally {
    f.cleanup();
  }
});

Deno.test("canonical command dangling and loop links fail closed with predecessor causes", async () => {
  const f = createCommandFixture();
  const causes: string[] = [];
  const context = { ...f.context, logFailure: (reason: string) => causes.push(reason) };
  try {
    Deno.symlinkSync(join(f.workspace, "missing"), join(f.workspace, "dangling"));
    Deno.symlinkSync(join(f.workspace, "loop"), join(f.workspace, "loop"));
    for (const [path, reason] of [["dangling", "dangling_symlink"], ["loop", "symlink_loop"]]) {
      causes.length = 0;
      assertEquals(
        await genericCommandRejectionReason(`cat ${path}`, context),
        "path_outside_boundary",
      );
      assertEquals(causes, [reason]);
    }
  } finally {
    f.cleanup();
  }
});

Deno.test("canonical command root/identity/metadata/context unavailability never falls back lexically", async () => {
  const f = createCommandFixture();
  const causes: string[] = [];
  try {
    for (
      const [reader, expected] of [
        [{
          ...defaultMetadataReader,
          realPath: (_path: string) => Promise.reject(new Deno.errors.PermissionDenied()),
        }, "root_unavailable"],
        [{
          ...defaultMetadataReader,
          lstat: async (path: string) => ({ ...await Deno.lstat(path), dev: null, ino: null }),
        }, "root_unavailable"],
        [{
          ...defaultMetadataReader,
          lstat: (path: string) =>
            path.endsWith("notes.md")
              ? Promise.reject(new Deno.errors.PermissionDenied())
              : Deno.lstat(path),
        }, "canonicalization_failed"],
      ] as [MetadataReader, string][]
    ) {
      causes.length = 0;
      assertEquals(
        await genericCommandRejectionReason("cat notes.md", {
          ...f.context,
          reader,
          logFailure: (reason) => causes.push(reason),
        }),
        "path_outside_boundary",
      );
      assertEquals(causes, [expected]);
    }
    assertEquals(
      await genericCommandRejectionReason("cat notes.md", {
        ...f.context,
        sessionContextGeneration: "",
      }),
      "path_outside_boundary",
    );
    Deno.removeSync(f.workspace, { recursive: true });
    assertEquals(
      await genericCommandRejectionReason("cat notes.md", f.context),
      "path_outside_boundary",
    );
  } finally {
    f.cleanup();
  }
});

Deno.test("canonical command detects changed target and root identities during observation", async () => {
  const f = createCommandFixture();
  const causes: string[] = [];
  try {
    const target = join(f.workspace, "notes.md");
    const reader: MetadataReader = {
      ...defaultMetadataReader,
      realPath: (path) =>
        path === target ? Promise.resolve(join(f.workspace, "data.json")) : Deno.realPath(path),
    };
    assertEquals(
      await genericCommandRejectionReason("cat notes.md", {
        ...f.context,
        reader,
        logFailure: (reason) => causes.push(reason),
      }),
      "path_outside_boundary",
    );
    assertEquals(causes, ["path_changed"]);
    let workspaceStats = 0;
    causes.length = 0;
    const changedRoot: MetadataReader = {
      ...defaultMetadataReader,
      lstat: async (path) => {
        const info = await Deno.lstat(path);
        if (path === f.workspace && ++workspaceStats > 2) {
          return { ...info, ino: (info.ino ?? 0) + 1 };
        }
        return info;
      },
    };
    assertEquals(
      await genericCommandRejectionReason("cat notes.md", {
        ...f.context,
        reader: changedRoot,
        logFailure: (reason) => causes.push(reason),
      }),
      "path_outside_boundary",
    );
    assertEquals(causes, ["path_changed"]);
  } finally {
    f.cleanup();
  }
});

Deno.test("canonical data isolation overrides workspace including alias and root enumeration", async () => {
  const f = createCommandFixture();
  try {
    const foreign = join(f.dataRoot, "sess_other", "opencode", "tool-output");
    Deno.symlinkSync(foreign, join(f.workspace, "foreign-data"));
    Deno.symlinkSync(f.dataRoot, join(f.workspace, "data-listing"));
    for (
      const command of [
        `ls ${f.dataRoot}`,
        "ls data-listing",
        "cat foreign-data/tool_x",
        `cat ${foreign}/tool_x`,
      ]
    ) {
      assertEquals(
        await genericCommandRejectionReason(command, f.context),
        "path_outside_boundary",
      );
    }
    assertEquals(await genericCommandRejectionReason(`ls ${f.dataHome}`, f.context), null);
    assertEquals(
      await genericCommandRejectionReason(`cat ${f.toolOutput}/tool_x`, f.context),
      null,
    );
  } finally {
    f.cleanup();
  }
});

Deno.test("command root role sets grant per-spawn/shared tmp and pool tool-output only", async () => {
  const f = createCommandFixture();
  try {
    const perSpawn = await buildCommandGateRoots({ ...f.context, sharedWorkspacePath: f.shared });
    assert(perSpawn.ok);
    assertEquals(perSpawn.value.grants.map((grant) => grant.role), [
      "workspace",
      "shared",
      "tool-output",
    ]);
    const sharedContext = {
      ...f.context,
      xdgDataHome: f.poolHome,
      processTmpDir: f.processTmp,
      sharedWorkspacePath: f.shared,
      runtimeEnv: { tmpDir: f.processTmp, agentWorkspace: f.shared, sessionId: "sess_own" },
    };
    const shared = await buildCommandGateRoots(sharedContext);
    assert(shared.ok);
    assertEquals(shared.value.grants.map((grant) => grant.role), [
      "workspace",
      "shared",
      "process-tmp",
      "tool-output",
    ]);
    for (
      const command of [
        "cat $TMPDIR/new.txt",
        "cat $AGENT_WORKSPACE/new.txt",
        "cat $XDG_DATA_HOME/opencode/tool-output/tool_x",
      ]
    ) {
      assertEquals(await genericCommandRejectionReason(command, sharedContext), null);
    }
    for (
      const path of [
        join(f.root, "opencode-data"),
        join(f.root, "opencode-data", "pool-other", "opencode", "tool-output", "tool_x"),
        join(f.poolHome, "other-directory", "x"),
      ]
    ) {
      assertEquals(
        await genericCommandRejectionReason(`cat ${path}`, sharedContext),
        "path_outside_boundary",
      );
    }
    const unavailableTmp = { ...sharedContext, processTmpDir: join(f.root, "missing-tmp") };
    assertEquals(
      await genericCommandRejectionReason("cat notes.md", unavailableTmp),
      "path_outside_boundary",
    );
  } finally {
    f.cleanup();
  }
});

Deno.test("tool-output foreign/home resolutions grant nothing and missing output does not poison workspace", async () => {
  const f = createCommandFixture();
  try {
    Deno.removeSync(f.toolOutput, { recursive: true });
    assertEquals(await genericCommandRejectionReason("cat notes.md", f.context), null);
    assertEquals(
      await genericCommandRejectionReason(`pdftotext notes.md ${f.toolOutput}/new.txt`, f.context),
      null,
    );
    Deno.symlinkSync(f.sibling, f.toolOutput);
    const foreign = await buildCommandGateRoots(f.context);
    assert(foreign.ok);
    assertEquals(foreign.value.grants.map((grant) => grant.role), ["workspace"]);
    assertEquals(
      await genericCommandRejectionReason(`cat ${f.toolOutput}/secret.md`, f.context),
      "path_outside_boundary",
    );
    const homeContext = { ...f.context, xdgDataHome: join(f.home, ".local", "share") };
    const home = await buildCommandGateRoots(homeContext);
    assert(home.ok);
    assertEquals(home.value.grants.map((grant) => grant.role), ["workspace"]);
    assertEquals(
      await genericCommandRejectionReason(
        "cat $XDG_DATA_HOME/opencode/tool-output/tool_x",
        homeContext,
      ),
      "path_outside_boundary",
    );
  } finally {
    f.cleanup();
  }
});

Deno.test("syntax rejects unavailable expansions before metadata IO and chains preserve first failure", async () => {
  const f = createCommandFixture();
  let observations = 0;
  try {
    const reader: MetadataReader = {
      lstat: (path) => {
        observations++;
        return Deno.lstat(path);
      },
      realPath: (path) => {
        observations++;
        return Deno.realPath(path);
      },
    };
    const context = { ...f.context, reader };
    for (
      const command of [
        "cat ~otheruser/x",
        "cat $TMPDIR/x",
        "cat $OTHER/x",
        "cat -f../sibling/file",
        "cat file:///etc/passwd",
      ]
    ) {
      assertEquals(await genericCommandRejectionReason(command, context), "path_outside_boundary");
      assertEquals(observations, 0);
    }
    assertEquals(await genericCommandRejectionReason("find -delete", context), "dangerous_flag");
    assertEquals(observations, 0);
    for (
      const command of [
        "cat notes.md",
        "cat /etc/passwd",
        "find . -delete",
        "rm notes.md",
        "cat notes.md | wc",
      ]
    ) {
      assertEquals(
        await multiCommandRejectionReason(command, context),
        await genericCommandRejectionReason(command, context),
      );
    }
    assertEquals(
      await multiCommandRejectionReason("cat notes.md; ls . && head notes.md", context),
      null,
    );
    assertEquals(
      await multiCommandRejectionReason("cat notes.md; cat /etc/passwd; rm x", context),
      "path_outside_boundary",
    );
  } finally {
    f.cleanup();
  }
});

Deno.test("expanded home/data spellings preserve contained inputs and attached-option denial", async () => {
  const f = createCommandFixture();
  try {
    const context = { ...f.context, home: f.workspace };
    for (
      const command of [
        "cat ~/notes.md",
        "cat $HOME/notes.md",
        "cat ${HOME}/notes.md",
        "cat --file=$HOME/notes.md",
        "cat $XDG_DATA_HOME/opencode/tool-output/tool_x",
      ]
    ) {
      assertEquals(await genericCommandRejectionReason(command, context), null);
    }
    assertEquals(
      await genericCommandRejectionReason("cat -o$HOME/notes.md", context),
      "path_outside_boundary",
    );
    Deno.removeSync(f.toolOutput, { recursive: true });
    Deno.symlinkSync(join(f.dataRoot, "sess_other", "opencode", "tool-output"), f.toolOutput);
    const roots = await buildCommandGateRoots(f.context);
    assert(roots.ok);
    assertEquals(roots.value.grants.map((grant) => grant.role), ["workspace"]);
    assertEquals(
      await genericCommandRejectionReason(`cat ${f.toolOutput}/tool_x`, f.context),
      "path_outside_boundary",
    );
  } finally {
    f.cleanup();
  }
});
