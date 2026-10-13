// tests/utils/opencode-skill-discovery-declaration.test.ts
//
// Generated OpenCode skill-discovery declaration
// (`generate-opencode-skill-discovery-declaration`).
//
// The suite exercises the PURE document half (inspection, rendering, the two
// source-preserving splices) and the one filesystem step, over the document the
// image actually deploys (`agent-config/opencode.json`) plus fixture documents
// for the postures the deployed one does not carry. Its evidence limit is
// honest: it proves what this repository writes, never that a live OpenCode
// session consumed it — live agent discovery stays user-owned and UNVERIFIED
// (`docs/USER-RUNTIME-VERIFICATION.md`).

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  applyOpencodeSkillDiscoveryDeclaration,
  assertOpencodeSkillRootIsDeclarable,
  ensureOpencodeSkillDiscoveryDeclaration,
  inspectOpencodeSkillDiscoveryDeclaration,
  opencodeDaemonHome,
  opencodeGlobalConfigPath,
  renderOpencodeSkillDiscoveryDeclaration,
} from "@utils/opencode-paths.ts";
import { observeTrustedSkillsRoot, resolveTrustedSkillsRoot } from "@core/skills-root.ts";
import {
  type JsonSourceMember,
  type JsonSourceObject,
  parseJsonSource,
} from "@utils/json-source.ts";

/** The document the image installs as the deployed OpenCode configuration. */
const DEPLOYED_TEMPLATE = Deno.readTextFileSync(
  new URL("../../agent-config/opencode.json", import.meta.url).pathname,
);

/** A resolved root that is NOT the container default. */
const OTHER_ROOT = "/srv/deployment/shared-skills";

/** The container default: the stock image's declared `AGENT_SKILLS_DIR`. */
const CONTAINER_ROOT = "/home/deno/.agents/skills";

/** The daemon home the shipped template's `~` spellings resolve against. */
const CONTAINER_HOME = "/home/deno";

/** Raw source text of every member of `object` except the named keys. */
function rawSpansOfOtherMembers(
  source: string,
  object: JsonSourceObject,
  keys: readonly string[],
): string[] {
  return object.members
    .filter((member) => !keys.includes(member.key))
    .map((member) => source.slice(member.keyStart, member.value.end));
}

/** The members of the document's `agent.build.permission` object. */
function permissionMembers(document: string): readonly JsonSourceMember[] {
  const root = parseJsonSource(document);
  assert(root.kind === "object");
  const agent = root.members.find((member) => member.key === "agent")!.value;
  assert(agent.kind === "object");
  const build = agent.members.find((member) => member.key === "build")!.value;
  assert(build.kind === "object");
  const permission = build.members.find((member) => member.key === "permission")!.value;
  assert(permission.kind === "object");
  return permission.members;
}

/** One deployed configuration document under a private daemon home. */
interface Deployment {
  readonly home: string;
  readonly path: string;
  readonly env: (name: string) => string | undefined;
}

function makeDeployment(): Deployment {
  const home = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-decl-home-" }));
  return {
    home,
    path: `${home}/.config/opencode/opencode.json`,
    env: (name: string) => (name === "HOME" ? home : undefined),
  };
}

Deno.test("declaration - the deployed document names the resolved root and nothing else changes", () => {
  const updated = applyOpencodeSkillDiscoveryDeclaration(
    DEPLOYED_TEMPLATE,
    OTHER_ROOT,
    CONTAINER_HOME,
  );

  // The discovery path list is exactly the resolved root.
  const root = parseJsonSource(updated);
  assert(root.kind === "object");
  assert(root.members.some((member) => member.key === "skills"));
  const skills = root.members.find((member) => member.key === "skills")!.value;
  assert(skills.kind === "object");
  const paths = skills.members.find((member) => member.key === "paths")!.value;
  assertEquals(paths.kind === "array" && paths.items.length, 1);
  assertEquals(
    updated.slice(paths.start, paths.end),
    `[\n      "${OTHER_ROOT}"\n    ]`,
    "an absolute root is written, never a relative or `~`-relative entry",
  );

  // The allowance names the root and no parent of it.
  const allowances = parseJsonSource(updated);
  assert(allowances.kind === "object");
  const external = permissionMembers(updated).find((member) => member.key === "external_directory")!
    .value;
  assert(external.kind === "object");
  const added = external.members.filter((member) => member.key.startsWith(OTHER_ROOT));
  assertEquals(added.map((member) => member.key), [`${OTHER_ROOT}/**`]);
  assertEquals(added.map((member) => updated.slice(member.value.start, member.value.end)), [
    '"allow"',
  ]);

  // Every OTHER setting keeps its bytes: the script-routing pins, the whole
  // provider/agent configuration and the unrelated allowances.
  for (const span of rawSpansOfOtherMembers(DEPLOYED_TEMPLATE, root, ["skills", "agent"])) {
    assertStringIncludes(updated, span);
  }
  for (const span of rawSpansOfOtherMembers(updated, external, [`${OTHER_ROOT}/**`])) {
    assertStringIncludes(updated, span);
  }
  const routing = updated.slice(
    updated.indexOf('"bash": {'),
    updated.indexOf('"external_directory"'),
  );
  assertStringIncludes(routing, '"deno run *": "ask"');
  assertStringIncludes(routing, '"*.ts*": "ask"');
  assert(!updated.includes('"/app/data/workspaces/*/tmp/**": "deny"'));
});

Deno.test("declaration - the container default root is already allowed, so only the path list is added", () => {
  const updated = applyOpencodeSkillDiscoveryDeclaration(
    DEPLOYED_TEMPLATE,
    CONTAINER_ROOT,
    CONTAINER_HOME,
  );
  // The shipped `~/.agents/skills/**` allowance canonically IS the container
  // root, so the update adds no second allowance entry and touches no byte of
  // the permission block: the whole document is the template plus the appended
  // discovery path list.
  assertEquals(
    updated,
    DEPLOYED_TEMPLATE.replace(
      /\n\}\n$/,
      `,\n  "skills": {\n    "paths": [\n      "${CONTAINER_ROOT}"\n    ]\n  }\n}\n`,
    ),
  );
});

Deno.test("declaration - an already-correct document is left byte-identical", () => {
  const rendered = renderOpencodeSkillDiscoveryDeclaration(CONTAINER_ROOT);
  const verdict = inspectOpencodeSkillDiscoveryDeclaration(
    rendered,
    CONTAINER_ROOT,
    CONTAINER_HOME,
  );
  assertEquals(verdict.declared, true);
  assertEquals(verdict.detail, "");
  assertEquals(
    applyOpencodeSkillDiscoveryDeclaration(rendered, CONTAINER_ROOT, CONTAINER_HOME),
    rendered,
  );

  // The `~/` and `$HOME/` spellings the pinned engine expands are equivalent.
  for (const spelling of ["~/", "$HOME/"]) {
    const homeRelative = rendered
      .replace(`"${CONTAINER_ROOT}"`, `"${spelling}.agents/skills"`)
      .replace(`"${CONTAINER_ROOT}/**"`, `"${spelling}.agents/skills/**"`);
    assertEquals(
      inspectOpencodeSkillDiscoveryDeclaration(homeRelative, CONTAINER_ROOT, CONTAINER_HOME),
      { declared: true, detail: "" },
    );
  }

  // The deployment writes NOTHING for such a document: the reader is asked and
  // the writer would fail the test if it were ever called.
  const deployment = makeDeployment();
  Deno.mkdirSync(`${deployment.home}/.config/opencode`, { recursive: true });
  Deno.writeTextFileSync(deployment.path, rendered);
  const before = Deno.lstatSync(deployment.path).mtime?.getTime();
  const result = ensureOpencodeSkillDiscoveryDeclaration(CONTAINER_ROOT, {
    env: deployment.env,
    writeFile: () => {
      throw new Error("an already-correct document must not be written");
    },
  });
  assertEquals(result.action, "unchanged");
  assertEquals(result.path, deployment.path);
  assertEquals(Deno.readTextFileSync(deployment.path), rendered);
  assertEquals(Deno.lstatSync(deployment.path).mtime?.getTime(), before);
});

Deno.test("declaration - a document that names the root without the allowance is rewritten", () => {
  const named = `{
  "skills": {
    "paths": [
      "~/.agents/skills"
    ]
  }
}
`;
  assertEquals(
    inspectOpencodeSkillDiscoveryDeclaration(named, CONTAINER_ROOT, CONTAINER_HOME).declared,
    false,
  );
  const updated = applyOpencodeSkillDiscoveryDeclaration(named, CONTAINER_ROOT, CONTAINER_HOME);
  assertStringIncludes(updated, `"${CONTAINER_ROOT}/**": "allow"`);
  // The operator's own spelling of the path list keeps its bytes.
  assertStringIncludes(updated, '"~/.agents/skills"');
});

Deno.test("declaration - an absent configuration is created with exactly the declaration entries", () => {
  const deployment = makeDeployment();
  // No configuration directory exists yet either.
  const result = ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env });
  assertEquals(result.action, "created");
  assertEquals(result.path, deployment.path);
  assertEquals(result.root, OTHER_ROOT);
  const created = Deno.readTextFileSync(deployment.path);
  assertEquals(created, renderOpencodeSkillDiscoveryDeclaration(OTHER_ROOT));
  assertEquals(Object.keys(JSON.parse(created) as Record<string, unknown>), ["skills", "agent"]);
  assertEquals(((Deno.lstatSync(deployment.path).mode ?? 0) & 0o777).toString(8), "644");
  // The created document is accepted on the next run, and nothing is written.
  assertEquals(
    ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env }).action,
    "unchanged",
  );
  assertEquals(Deno.readTextFileSync(deployment.path), created);
});

Deno.test("declaration - a document that must change but cannot be written fails explicitly", () => {
  const deployment = makeDeployment();
  Deno.mkdirSync(`${deployment.home}/.config/opencode`, { recursive: true });
  Deno.writeTextFileSync(deployment.path, `{ "skills": { "paths": ["/somewhere-else"] } }`);
  Deno.chmodSync(deployment.path, 0o444);
  // A read-only document (the shape a `:ro` operator mount presents) names both
  // the file and the resolved root, and leaves the document untouched.
  const error = assertThrows(
    () => ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env }),
    Error,
  );
  assertStringIncludes(error.message, deployment.path);
  assertStringIncludes(error.message, OTHER_ROOT);
  assertEquals(
    Deno.readTextFileSync(deployment.path),
    `{ "skills": { "paths": ["/somewhere-else"] } }`,
  );
  Deno.chmodSync(deployment.path, 0o644);

  // The same posture when the directory itself refuses the write (an absent
  // document in an unwritable directory).
  Deno.removeSync(deployment.path);
  Deno.chmodSync(`${deployment.home}/.config/opencode`, 0o555);
  const directoryError = assertThrows(
    () => ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env }),
    Error,
  );
  assertStringIncludes(directoryError.message, deployment.path);
  assertStringIncludes(directoryError.message, OTHER_ROOT);
  Deno.chmodSync(`${deployment.home}/.config/opencode`, 0o755);
  assertThrows(
    () => Deno.lstatSync(deployment.path),
    Deno.errors.NotFound,
    undefined,
    "the unwritable directory left no document behind",
  );
});

Deno.test("declaration - a planted link at the document path refuses instead of being followed", () => {
  const deployment = makeDeployment();
  Deno.mkdirSync(`${deployment.home}/.config/opencode`, { recursive: true });
  const planted = `${deployment.home}/planted.json`;
  Deno.writeTextFileSync(planted, "{}");
  Deno.symlinkSync(planted, deployment.path);
  const error = assertThrows(
    () => ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env }),
    Error,
  );
  assertStringIncludes(error.message, deployment.path);
  assertEquals(Deno.readTextFileSync(planted), "{}", "the link target is never written");
});

Deno.test("declaration - an over-broad root is refused", () => {
  for (
    const root of [
      CONTAINER_HOME,
      "/",
      "/home",
      "/home/deno/.agents/skills/..",
      "/srv/skills*",
      "relative/skills",
      "",
    ]
  ) {
    assertThrows(
      () => assertOpencodeSkillRootIsDeclarable(root, CONTAINER_HOME),
      Error,
      undefined,
      `root ${JSON.stringify(root)} must be refused`,
    );
  }
  // A root BELOW a home is legitimate: that is the stock deployment.
  assertOpencodeSkillRootIsDeclarable(CONTAINER_ROOT, CONTAINER_HOME);

  // A home that is itself a link does not make the bounded check miss the real
  // home boundary: the resolved root is already physical.
  const realHome = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-real-home-" }));
  const linkedHome = `${realHome}-alias`;
  Deno.symlinkSync(realHome, linkedHome);
  assertThrows(
    () => assertOpencodeSkillRootIsDeclarable(realHome, linkedHome),
    Error,
    "ancestor",
  );

  // The refusal gates the whole step, before anything is written.
  const deployment = makeDeployment();
  assertThrows(
    () => ensureOpencodeSkillDiscoveryDeclaration(deployment.home, { env: deployment.env }),
    Error,
    "ancestor",
  );
  assertThrows(
    () => Deno.lstatSync(deployment.path),
    Deno.errors.NotFound,
    undefined,
    "no document is written for a refused root",
  );
});

Deno.test("declaration - the generated content is no execution authority and out-ranks no authored pin", () => {
  // A tampered, agent-writable document: another discovery root, a script grant
  // widened to allow, and a global allow. The step's own content must add no
  // grant, must never adopt the file's root, and must leave every authored byte
  // — tampered or not — exactly as it found it.
  const tampered = `{
  "skills": { "paths": ["/evil/skills"] },
  "agent": {
    "build": {
      "permission": {
        "*": "allow",
        "bash": {
          "*": "allow",
          "deno run *": "allow",
          "*.ts*": "allow"
        },
        "external_directory": {
          "*": "deny",
          "/evil/skills/**": "allow"
        }
      }
    }
  }
}
`;
  const updated = applyOpencodeSkillDiscoveryDeclaration(tampered, OTHER_ROOT, CONTAINER_HOME);
  // The declared root is the RESOLVED one, never the root the file names.
  assertEquals(updated.includes('/evil/skills"'), false);
  assertStringIncludes(updated, `"${OTHER_ROOT}"`);
  // No execution grant is added, and no global wildcard is introduced.
  assertEquals(permissionMembers(updated).filter((member) => member.key === "*").length, 1);
  const bashBefore = tampered.slice(
    tampered.indexOf('"bash": {'),
    tampered.indexOf('"external_directory"'),
  );
  const bashAfter = updated.slice(
    updated.indexOf('"bash": {'),
    updated.indexOf('"external_directory"'),
  );
  assertEquals(bashAfter, bashBefore, "the script-routing pins keep their exact bytes");
  // The only additions are the two declaration entries: one discovery path
  // list and ONE allowance for the resolved root.
  const externalDirectory =
    permissionMembers(updated).find((member) => member.key === "external_directory")!.value;
  assert(externalDirectory.kind === "object");
  const added = externalDirectory.members.filter((member) => member.key.includes(OTHER_ROOT));
  assertEquals(added.map((member) => member.key), [`${OTHER_ROOT}/**`]);
  assertEquals(added.map((member) => updated.slice(member.value.start, member.value.end)), [
    '"allow"',
  ]);
  assertEquals(
    permissionMembers(updated).map((member) => member.key),
    permissionMembers(tampered).map((member) => member.key),
    "the declaration adds no permission key of its own",
  );
  assertEquals(
    inspectOpencodeSkillDiscoveryDeclaration(updated, OTHER_ROOT, CONTAINER_HOME),
    { declared: true, detail: "" },
  );

  // No higher-precedence carrier is created: the only document written is the
  // deployed one (the load order is config.json → opencode.json →
  // opencode.jsonc, so a generated sibling would out-rank the operator's pins).
  const deployment = makeDeployment();
  Deno.mkdirSync(`${deployment.home}/.config/opencode`, { recursive: true });
  Deno.writeTextFileSync(deployment.path, tampered);
  assertEquals(
    ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env }).action,
    "updated",
  );
  const siblings = Array.from(Deno.readDirSync(`${deployment.home}/.config/opencode`))
    .map((entry) => entry.name)
    .sort();
  assertEquals(siblings.join(","), "opencode.json");
});

Deno.test("declaration - the allowance is judged by the engine's ordered rules", () => {
  const allowanceFor = (external: string) =>
    `{
  "skills": { "paths": ["${OTHER_ROOT}"] },
  "agent": { "build": { "permission": { "external_directory": { ${external} } } } }
}
`;
  // Last-match-wins: a global `*` rule placed AFTER an allow denies the root,
  // so the document is not declared and the operator's rule cannot be rewritten
  // into a second, contradictory declaration.
  const defeated = allowanceFor(`"${OTHER_ROOT}/**": "allow", "*": "deny"`);
  assertEquals(
    inspectOpencodeSkillDiscoveryDeclaration(defeated, OTHER_ROOT, CONTAINER_HOME).declared,
    false,
  );
  const refusal = assertThrows(
    () => applyOpencodeSkillDiscoveryDeclaration(defeated, OTHER_ROOT, CONTAINER_HOME),
    Error,
  );
  assertStringIncludes(refusal.message, '"*"');
  assertStringIncludes(refusal.message, OTHER_ROOT);

  // An earlier global deny is the shipped shape: the declaration is inserted as
  // the LAST rule, so it governs the root subtree and nothing authored changes.
  const insertable = allowanceFor(`"*": "deny"`);
  const repaired = applyOpencodeSkillDiscoveryDeclaration(insertable, OTHER_ROOT, CONTAINER_HOME);
  assertStringIncludes(repaired, `"${OTHER_ROOT}/**": "allow" } } } }`);
  assertEquals(
    inspectOpencodeSkillDiscoveryDeclaration(repaired, OTHER_ROOT, CONTAINER_HOME).declared,
    true,
  );

  // The root's own entry is set to `allow` in place when its value contradicts
  // the declaration, and only that value changes.
  const contradicting = allowanceFor(`"*": "deny", "${OTHER_ROOT}/**": "ask"`);
  const fixed = applyOpencodeSkillDiscoveryDeclaration(contradicting, OTHER_ROOT, CONTAINER_HOME);
  assertEquals(fixed, contradicting.replace('"ask"', '"allow"'));

  // The `/*` suffix is the same pattern form to the pinned engine, and an
  // already-canonical `~/`-spelled entry is equivalent.
  assertEquals(
    inspectOpencodeSkillDiscoveryDeclaration(
      allowanceFor(`"${OTHER_ROOT}/*": "allow"`),
      OTHER_ROOT,
      CONTAINER_HOME,
    ).declared,
    true,
  );
  assertEquals(
    inspectOpencodeSkillDiscoveryDeclaration(
      `{
  "skills": { "paths": ["/x"] },
  "agent": { "build": { "permission": { "external_directory": { "~/.agents/skills/**": "allow" } } } }
}
`,
      CONTAINER_ROOT,
      CONTAINER_HOME,
    ).declared,
    false,
    "the path list is still the operator's own, so the document is incomplete",
  );
});

Deno.test("declaration - the deployed document is the agent's own, whatever the daemon selectors say", () => {
  const selectors = (name: string) =>
    name === "HOME"
      ? "/home/deno"
      : name === "XDG_CONFIG_HOME"
      ? "/srv/config"
      : name === "OPENCODE_CONFIG_DIR"
      ? "/srv/opencode"
      : undefined;
  // The agent subprocess receives HOME and no config-directory selector
  // (`clearEnv` plus the factory allow-list), so a daemon selector cannot
  // relocate the document the AGENT reads.
  assertEquals(
    opencodeGlobalConfigPath({ env: selectors }),
    `${CONTAINER_HOME}/.config/opencode/opencode.json`,
  );
  assertEquals(opencodeDaemonHome({ env: selectors }), CONTAINER_HOME);
  assertEquals(
    opencodeDaemonHome({ env: (name) => name === "HOME" ? "/home/deno/" : undefined }),
    CONTAINER_HOME,
    "the observed home is canonicalized",
  );
  assertEquals(opencodeDaemonHome({ env: () => undefined }), undefined);
  assertEquals(
    opencodeDaemonHome({ env: (name) => name === "HOME" ? "relative/home" : undefined }),
    undefined,
  );
  const noHome = assertThrows(() => opencodeGlobalConfigPath({ env: () => undefined }), Error);
  assertStringIncludes(noHome.message, "HOME");
});

Deno.test("declaration - a document the declaration cannot be stated in fails explicitly", () => {
  const uninterpretable: Array<[string, string]> = [
    [`{ "skills": { "paths": ["/x"] }`, "offset"],
    [`["/srv/skills"]`, "not a JSON object"],
    [`{ "skills": ["/srv/skills"] }`, '"skills" is not a JSON object'],
    [`{ "skills": { "paths": "/srv/skills" } }`, '"skills.paths" is not an array'],
    [`{ "skills": { "paths": [1] } }`, '"skills.paths" contains a non-string entry'],
    [`{ "skills": { "paths": ["/a"], "paths": ["/b"] } }`, "declared 2 times"],
    [
      `{ "skills": { "paths": ["/a"] }, "agent": { "build": { "permission": "deny" } } }`,
      '"permission" is not a JSON object',
    ],
  ];
  for (const [document, fragment] of uninterpretable) {
    const error = assertThrows(
      () => applyOpencodeSkillDiscoveryDeclaration(document, OTHER_ROOT, CONTAINER_HOME),
      Error,
      undefined,
      document,
    );
    assertStringIncludes(error.message, fragment);
  }

  // Through the filesystem step the failure names the document AND the
  // resolved root, so a broken operator configuration is actionable.
  const deployment = makeDeployment();
  Deno.mkdirSync(`${deployment.home}/.config/opencode`, { recursive: true });
  Deno.writeTextFileSync(deployment.path, `{ "skills": ["/srv/skills"] }`);
  const wrapped = assertThrows(
    () => ensureOpencodeSkillDiscoveryDeclaration(OTHER_ROOT, { env: deployment.env }),
    Error,
  );
  assertStringIncludes(wrapped.message, deployment.path);
  assertStringIncludes(wrapped.message, OTHER_ROOT);
  assertEquals(Deno.readTextFileSync(deployment.path), `{ "skills": ["/srv/skills"] }`);
});

Deno.test("declaration - a JSONC document keeps its comments and trailing comma", () => {
  const jsonc = `{
  // the deployed provider block
  "autoupdate": false/* kept */,
  "skills": {
    "paths": ["/elsewhere"], // the operator's own list
  },
}
`;
  const updated = applyOpencodeSkillDiscoveryDeclaration(jsonc, OTHER_ROOT, CONTAINER_HOME);
  for (
    const comment of [
      "// the deployed provider block",
      "/* kept */",
      "// the operator's own list",
    ]
  ) {
    assertStringIncludes(updated, comment);
  }
  assertStringIncludes(updated, `"${OTHER_ROOT}"`);
  assertStringIncludes(updated, `"${OTHER_ROOT}/**": "allow"`);
});

Deno.test("declaration - the declared value is the root the inventory and prompts resolve", () => {
  const root = Deno.realPathSync(Deno.makeTempDirSync({ prefix: "air-decl-root-" }));
  const deployment = makeDeployment();
  try {
    const declared = ensureOpencodeSkillDiscoveryDeclaration(root, { env: deployment.env });
    // The SAME resolver, for both agent types, produces the declared value.
    assertEquals(declared.root, resolveTrustedSkillsRoot("opencode", root));
    assertEquals(declared.root, resolveTrustedSkillsRoot("omp", root));
    assertEquals(declared.root, observeTrustedSkillsRoot("opencode", root).root);
    assertEquals(
      Deno.readTextFileSync(declared.path),
      renderOpencodeSkillDiscoveryDeclaration(resolveTrustedSkillsRoot("omp", root)),
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("declaration - bootstrap declares the resolved root before agent construction", () => {
  // A static ordering assertion over the entry point: the awaited external-skill
  // publication precedes the declaration, which precedes `new AgentCore(...)`,
  // and every consumer takes the ONE resolved value observed above them.
  const source = Deno.readTextFileSync(
    new URL("../../src/bootstrap.ts", import.meta.url).pathname,
  );
  const resolved = source.indexOf("const deploymentSkillsRoot = resolveTrustedSkillsRoot(");
  const installed = source.indexOf("await installExternalSkills(deploymentSkillsRoot");
  const declared = source.indexOf("ensureOpencodeSkillDiscoveryDeclaration(deploymentSkillsRoot)");
  const constructed = source.indexOf("new AgentCore(");
  assertEquals(resolved > 0 && installed > resolved, true, "the root is resolved once, first");
  assertEquals(declared > installed, true, "the declaration follows the publication");
  assertEquals(constructed > declared, true, "the declaration precedes agent construction");
});
