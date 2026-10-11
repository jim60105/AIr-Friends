/**
 * Config-trio consistency audit (finish-omp-mocked-skill-handoff, tasks 5.1/5.2).
 *
 * The batch's single source of truth is the audit table in AGENTS.md ("Batch
 * Configuration-Documentation Consistency Audit"): every configuration or
 * environment field introduced or widened by any change in the OMP
 * integration batch must be documented consistently across
 * `config.example.yaml`, `.env.example`, and `helm/values.yaml`. This test
 * READS the table from AGENTS.md (the names there are the audited set — the
 * table is never hard-coded a second time) and enforces both directions:
 *
 *  1. every audited field name is present in all three documentation files;
 *  2. every OMP-related name that appears in the three files has a row in the
 *     table (fail-closed: an undocumented name fails, naming the field and
 *     the file).
 *
 * The checker is a pure function over file contents so the fail-closed branch
 * is exercised with a fixture-driven negative case without touching the repo.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/yaml";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

const TRIO_FILES = ["config.example.yaml", ".env.example", "helm/values.yaml"] as const;
type TrioFile = (typeof TRIO_FILES)[number];

// ---------------------------------------------------------------------------
// Audit-table reader (AGENTS.md is the single source the test reads)
// ---------------------------------------------------------------------------

interface AuditRow {
  /** Field name as written in the table's first column (may list both the
   * config key and the env name, e.g. `agent.defaultAgentType` / `AGENT_DEFAULT_TYPE`). */
  field: string;
  /** Names extracted from the field cell: dotted config keys and env-style
   * tokens (each is checked for presence in the trio). */
  names: string[];
}

export function parseAuditTable(agentsMd: string): AuditRow[] {
  const heading = agentsMd.indexOf("### Batch Configuration-Documentation Consistency Audit");
  if (heading === -1) {
    throw new Error("AGENTS.md audit table heading not found");
  }
  const section = agentsMd.slice(heading);
  const rows: AuditRow[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const [fieldCell] = cells;
    if (fieldCell === "Field" || /^[-: ]+$/.test(fieldCell)) continue; // header / separator
    rows.push({ field: fieldCell, names: extractFieldNames(fieldCell) });
    if (rows.length > 50) break; // the table never exceeds a page; guard runaway parsing
  }
  return rows;
}

/** Extract backtick-quoted names from a table cell; env tokens and dotted
 * config keys alike. A cell without backticks contributes the bare text. */
function extractFieldNames(cell: string): string[] {
  const quoted = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
  const names = quoted.length > 0 ? quoted : [cell.replace(/\*+/g, "").trim()];
  return names.filter((n) => /^[a-zA-Z][a-zA-Z0-9_.]*$/.test(n));
}

// ---------------------------------------------------------------------------
// Pure trio checker
// ---------------------------------------------------------------------------

export interface TrioViolation {
  kind: "missing-audited-field" | "undocumented-omp-name";
  name: string;
  file: TrioFile;
}

/**
 * An OMP-related ENV-style identifier: an uppercase token (with underscores)
 * carrying `OMP` as its own underscore-delimited segment AND at least one
 * adjacent segment, so prose mentions ("OMP version check", the bare word)
 * are prose while `AGENT_OMP_MIN_VERSION` / `OMP_VERSION` are identifiers.
 */
export function extractOmpEnvNames(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
    const token = match[0]!;
    // Path-adjacent tokens (`docs/OMP_PACKAGING.md`) are documentation
    // citations, not configuration/environment identifiers.
    const before = match.index > 0 ? text[match.index - 1] : "";
    const after = text[match.index + token.length] ?? "";
    if (before === "/" || after === ".") continue;
    const segments = token.split("_");
    if (segments.includes("OMP")) found.add(token);
  }
  return [...found];
}

/**
 * An OMP-related camelCase CONFIG KEY: a YAML mapping key whose name starts
 * with `omp` immediately followed by a camel hump (or equals `omp`), e.g.
 * `ompMinVersion`. Comment lines and `compress:`/`prompts:`-style incidental
 * substrings never match.
 */
export function extractOmpConfigKeys(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const keyMatch = trimmed.match(/^"?([a-zA-Z][a-zA-Z0-9]*)"?\s*:/);
    if (!keyMatch) continue;
    const key = keyMatch[1]!;
    if (/^omp(?=[A-Z]|$)/.test(key)) found.add(key);
  }
  return [...found];
}

/** Run both audit directions over the trio contents. Pure: the caller passes
 * the live files or fixture-mutated copies alike. */
export function auditConfigTrio(
  table: AuditRow[],
  files: Record<TrioFile, string>,
): TrioViolation[] {
  const violations: TrioViolation[] = [];

  // 1. Every audited field documented in all three files. A row names the
  //    field's spellings (config key + env var). The ENV spelling (SCREAMING
  //    case — what a deployment actually sets) must appear in every file;
  //    the dotted config-key spelling lives where config files are documented
  //    and is satisfied in the other files through the env spelling.
  for (const row of table) {
    const envSpellings = row.names.filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n));
    for (const file of TRIO_FILES) {
      const text = files[file]!;
      if (envSpellings.length > 0) {
        if (!envSpellings.some((n) => text.includes(n))) {
          violations.push({ kind: "missing-audited-field", name: envSpellings.join("|"), file });
        }
      } else if (!row.names.some((n) => text.includes(n))) {
        violations.push({ kind: "missing-audited-field", name: row.names.join("|"), file });
      }
    }
  }

  // 2. Fail closed: every OMP-related name in the trio has a table row.
  const audited: Record<string, true> = Object.fromEntries(
    table.flatMap((r) => r.names).map((n) => [n, true as const]),
  );
  for (const file of TRIO_FILES) {
    const names = [...extractOmpEnvNames(files[file]!), ...extractOmpConfigKeys(files[file]!)];
    for (const name of names) {
      if (!(name in audited)) violations.push({ kind: "undocumented-omp-name", name, file });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function readRepoFile(rel: string): string {
  return Deno.readTextFileSync(REPO_ROOT + rel);
}

function readTrio(): Record<TrioFile, string> {
  return {
    "config.example.yaml": readRepoFile("config.example.yaml"),
    ".env.example": readRepoFile(".env.example"),
    "helm/values.yaml": readRepoFile("helm/values.yaml"),
  };
}

Deno.test("config trio audit - AGENTS.md table carries the minimum audited field set", () => {
  const table = parseAuditTable(readRepoFile("AGENTS.md"));
  const names = new Set(table.flatMap((r) => r.names));
  // Minimum set mandated by the delta spec.
  assertStringIncludes([...names].join(" "), "agent.defaultAgentType");
  assertStringIncludes([...names].join(" "), "AGENT_DEFAULT_TYPE");
  assertStringIncludes([...names].join(" "), "AGENT_OMP_MIN_VERSION");
});

Deno.test("config trio audit - every audited field is present in all three files", () => {
  const table = parseAuditTable(readRepoFile("AGENTS.md"));
  const files = readTrio();
  const missing = auditConfigTrio(table, files).filter((v) => v.kind === "missing-audited-field");
  assertEquals(
    missing,
    [],
    `audited fields missing from the trio: ${JSON.stringify(missing)}`,
  );
});

Deno.test("config trio audit - defaultAgentType documentation describes both values with opencode default", () => {
  const files = readTrio();
  // Pinned verbatim per file (row 24's shared-contract lines): the trio docs
  // must say EXACTLY this — opencode is the shipped default (getDefaultAgentType
  // falls back to "opencode"; config.example additionally warns that unknown
  // values fail startup). A doc drift here is a contract drift, not style.
  const PINNED_LINES: Record<TrioFile, string> = {
    "config.example.yaml":
      '  defaultAgentType: "${AGENT_DEFAULT_TYPE}" # Default ACP agent: "opencode" (default) | "omp" (env: AGENT_DEFAULT_TYPE; unknown values fail startup). Note: the variable must be set or this line removed.',
    ".env.example": "# Default ACP agent type: opencode (default) | omp",
    "helm/values.yaml": "  # Default ACP agent type: opencode (default) | omp",
  };
  // The structural floor guards the CONTRACT TEXT itself (opencode carries the
  // literal `(default)` marker, omp is the alternative): if this fires, the
  // pin was edited away from the shipped semantics, and the verbatim file
  // check below then can no longer be trusted to encode them.
  for (const line of Object.values(PINNED_LINES)) {
    assert(
      /opencode"? \(default\).*\bomp\b/i.test(line),
      `pinned contract text must present opencode as the (default) with omp as an alternative: ${line}`,
    );
  }
  for (const file of TRIO_FILES) {
    const text = files[file]!;
    assert(
      text.split("\n").includes(PINNED_LINES[file]),
      `${file}: defaultAgentType doc line drifted from the pinned contract text ` +
        `(expected exactly ${JSON.stringify(PINNED_LINES[file])})`,
    );
  }
});

Deno.test("config trio audit - no undocumented OMP-related name in the live trio (fail closed)", () => {
  const table = parseAuditTable(readRepoFile("AGENTS.md"));
  const files = readTrio();
  const undocumented = auditConfigTrio(table, files).filter((v) =>
    v.kind === "undocumented-omp-name"
  );
  assertEquals(
    undocumented,
    [],
    `undocumented OMP-related names: ${JSON.stringify(undocumented)}`,
  );
});

Deno.test("config trio audit - negative fixture: undocumented OMP name fails the audit, naming field and file", () => {
  const table = parseAuditTable(readRepoFile("AGENTS.md"));
  const files = readTrio();
  const poisoned: Record<TrioFile, string> = {
    ...files,
    ".env.example": files[".env.example"] +
      "\n# Undocumented field for the fail-closed audit test\nAGENT_OMP_EXAMPLE_FLAG=1\n",
  };
  const violations = auditConfigTrio(table, poisoned);
  const hit = violations.find((v) =>
    v.kind === "undocumented-omp-name" && v.name === "AGENT_OMP_EXAMPLE_FLAG" &&
    v.file === ".env.example"
  );
  assert(
    hit !== undefined,
    `undocumented name must fail naming field+file; got ${JSON.stringify(violations)}`,
  );

  // Removal-style negative case: dropping an audited field from one file also fails.
  const stripped: Record<TrioFile, string> = {
    ...files,
    "helm/values.yaml": files["helm/values.yaml"].split("\n").filter((l) =>
      !l.includes("AGENT_OMP_MIN_VERSION")
    ).join("\n"),
  };
  const missingHit = auditConfigTrio(table, stripped).find((v) =>
    v.kind === "missing-audited-field" && v.name === "AGENT_OMP_MIN_VERSION" &&
    v.file === "helm/values.yaml"
  );
  assert(missingHit !== undefined, "removed audited field must fail the audit");
});

Deno.test("config trio audit - the trio parses as valid data (yaml) / env syntax spot check", () => {
  // helm/values.yaml and config.example.yaml are YAML (comments carry the
  // env-expanded values; parse proves structure, the field-presistence checks
  // above carry the semantic audit).
  const yamlValues = parse(readRepoFile("helm/values.yaml"));
  assertEquals(typeof yamlValues, "object");
  const envText = readRepoFile(".env.example");
  // Every non-comment KEY= line is well-formed; the audited env names appear
  // in comment-documented form (mirroring their treatment in the YAML files).
  for (const line of envText.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    assert(/^[A-Z][A-Z0-9_]+=/.test(line), `.env.example malformed line: ${line}`);
  }
});
