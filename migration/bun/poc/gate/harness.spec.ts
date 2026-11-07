import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectTests, hashPocTree, hashProductSources } from "./evidence.ts";
import { decideRun } from "./run-in-container.ts";
import { PRODUCT_SOURCES } from "./pins.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");
const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bun-poc-"));
  createdRoots.push(root);
  return root;
}

function put(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("collectTests", () => {
  test("records passed, failed and skipped statuses", () => {
    const junit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="suite" tests="3">
    <testcase name="plain" assertions="1" />
    <testcase name="broken" assertions="2"><failure message="boom" /></testcase>
    <testcase name="omitted" assertions="0"><skipped /></testcase>
  </testsuite>
</testsuites>`;
    expect(collectTests(junit)).toEqual([
      { name: "plain", status: "passed", assertions: 1 },
      { name: "broken", status: "failed", assertions: 2 },
      { name: "omitted", status: "skipped", assertions: 0 },
    ]);
  });

  test("records test cases inside nested testsuites", () => {
    const junit = `<testsuites>
  <testsuite name="outer">
    <testcase name="first" assertions="1" />
  </testsuite>
  <testsuite name="middle">
    <testsuite name="inner">
      <testsuite name="innermost">
        <testcase name="second" assertions="1" />
      </testsuite>
    </testsuite>
  </testsuite>
</testsuites>`;
    expect(collectTests(junit).map((testCase) => testCase.name)).toEqual(["first", "second"]);
  });

  test("records a failed hook entry named (unnamed)", () => {
    const junit = `<testsuites>
  <testsuite name="suite">
    <testcase name="(unnamed)" assertions="0"><failure message="hook failed" /></testcase>
  </testsuite>
</testsuites>`;
    expect(collectTests(junit)).toEqual([{ name: "(unnamed)", status: "failed", assertions: 0 }]);
  });

  test("reads a zero or missing assertions attribute as 0", () => {
    const junit = `<testsuites>
  <testsuite name="suite">
    <testcase name="zero" assertions="0" />
    <testcase name="absent" />
  </testsuite>
</testsuites>`;
    expect(collectTests(junit).map((testCase) => testCase.assertions)).toEqual([0, 0]);
  });
});

describe("hashPocTree", () => {
  // Files that the record keeps outside the hash: evidence, dependencies,
  // Markdown and the outcome record.
  const ignoredPaths: Record<string, string> = {
    "node_modules/dependency/index.js": "export default 1;\n",
    "evidence/harness.json": "{}\n",
    ".evidence-wip/harness.json": "{}\n",
    "NOTES.md": "notes\n",
    "GO-NO-GO.json": "{}\n",
    "GO-NO-GO.md": "outcome\n",
  };

  function populatedTree(): string {
    const root = tempRoot();
    put(root, "suites/harness.spec.ts", "// suite\n");
    put(root, "gate/pins.ts", "export const A = 1;\n");
    for (const [relativePath, content] of Object.entries(ignoredPaths)) put(root, relativePath, content);
    return root;
  }

  test("ignores evidence, dependencies, Markdown and outcome records", () => {
    const root = populatedTree();
    const before = hashPocTree(root);
    put(root, "evidence/harness.json", '{"changed":true}\n');
    put(root, ".evidence-wip/other/harness.json", "{}\n");
    put(root, "node_modules/dependency/added.js", "export default 2;\n");
    put(root, "CHANGELOG.md", "changed\n");
    put(root, "GO-NO-GO.json", '{"decision":"go"}\n');
    rmSync(join(root, "NOTES.md"));
    expect(hashPocTree(root)).toBe(before);
  });

  test("changes when a suite file changes", () => {
    const root = populatedTree();
    const before = hashPocTree(root);
    put(root, "suites/harness.spec.ts", "// suite with one more test\n");
    expect(hashPocTree(root)).not.toBe(before);
  });

  test("changes when a file is added", () => {
    const root = populatedTree();
    const before = hashPocTree(root);
    put(root, "gate/evidence.ts", "export const B = 2;\n");
    expect(hashPocTree(root)).not.toBe(before);
  });

  test("is stable for an unchanged tree", () => {
    const root = populatedTree();
    expect(hashPocTree(root)).toBe(hashPocTree(root));
  });
});

describe("hashProductSources", () => {
  function populatedRepo(): string {
    const root = tempRoot();
    for (const relativePath of PRODUCT_SOURCES) put(root, relativePath, `// ${relativePath}\n`);
    return root;
  }

  test("changes when one listed production source changes", () => {
    const root = populatedRepo();
    const before = hashProductSources(root);
    put(root, PRODUCT_SOURCES[2], "// changed byte\n");
    expect(hashProductSources(root)).not.toBe(before);
  });

  test("is stable for unchanged sources", () => {
    const root = populatedRepo();
    expect(hashProductSources(root)).toBe(hashProductSources(root));
  });
});

describe("run-in-container decisions", () => {
  test("writes evidence and exits 0 when the report exists, even for failed tests", () => {
    expect(decideRun(true)).toEqual({ write: true, exitCode: 0 });
  });

  test("writes nothing and exits 2 when no report was produced", () => {
    expect(decideRun(false)).toEqual({ write: false, exitCode: 2 });
  });
});

describe("arm64 evidence workflow", () => {
  const workflowPath = join(REPO_ROOT, ".github/workflows/bun-poc-arm64.yml");
  interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly "continue-on-error"?: boolean;
    readonly with?: Record<string, unknown>;
  }
  interface Workflow {
    readonly on: Record<string, Record<string, unknown>>;
    readonly permissions: Record<string, unknown>;
    readonly jobs: Record<string, { readonly "runs-on": string; readonly steps: WorkflowStep[] }>;
  }
  const workflow = Bun.YAML.parse(readFileSync(workflowPath, "utf8")) as Workflow;
  const triggers = workflow.on;
  const job = workflow.jobs.ffi;
  const steps = job.steps;
  const stepNamed = (name: string): WorkflowStep => {
    const step = steps.find((candidate) => candidate.name === name);
    if (step === undefined) throw new Error(`workflow has no step named "${name}"`);
    return step;
  };

  test("runs on the ffi suites on a native arm64 runner", () => {
    expect(job["runs-on"]).toBe("ubuntu-24.04-arm");
    expect(stepNamed("Run ffi").run).toBe("migration/bun/poc/run-suite.sh ffi --final");
    expect(stepNamed("Run ffi-enosys").run).toBe(
      "migration/bun/poc/run-suite.sh ffi-enosys --final",
    );
    expect(stepNamed("Run ffi")["continue-on-error"]).toBe(true);
    expect(stepNamed("Run ffi-enosys")["continue-on-error"]).toBe(true);
  });

  test("uploads evidence after a failed suite step", () => {
    const upload = stepNamed("Upload evidence");
    expect(upload.if).toBe("always()");
    expect(upload.uses).toBe("actions/upload-artifact@v7");
    expect(upload.with?.name).toBe("bun-poc-aarch64-evidence");
    expect(upload.with?.path).toBe("migration/bun/poc/evidence/aarch64/");
    expect(upload.with?.["if-no-files-found"]).toBe("error");
  });

  test("is triggered only by a pushed bun-poc-final-* tag", () => {
    expect(Object.keys(triggers)).toEqual(["push"]);
    expect(Object.keys(triggers.push)).toEqual(["tags"]);
    expect(triggers.push.tags).toEqual(["bun-poc-final-*"]);
    expect(Object.keys(workflow.permissions)).toEqual(["contents"]);
    expect(workflow.permissions.contents).toBe("read");
    expect(JSON.stringify(workflow).includes("secrets.")).toBe(false);
  });
});
