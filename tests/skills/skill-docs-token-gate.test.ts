// tests/skills/skill-docs-token-gate.test.ts
//
// Pinned instruction-surface gate (make-skill-staging-agent-portable, tasks
// 3.1/3.2, skills-and-reply scenario "Skill instruction files direct to the
// same literal paths"): no bundled SKILL.md may instruct the agent to build
// staging paths or session ids from the `$TMPDIR`/`$SESSION_ID` shell tokens.
// The prompts side of the same invariant is pinned by
// tests/core/prompt-staging-literals.test.ts; this closes the docs gate so a
// future SKILL.md edit resurrecting a token recipe fails CI instead of
// quietly regressing the literal-first contract.

import { assert, assertEquals } from "@std/assert";
import { globSync } from "node:fs";

const TOKENS = ["$TMPDIR", "$SESSION_ID", "${TMPDIR}", "${SESSION_ID}"] as const;

Deno.test("skill docs gate - every SKILL.md is free of $TMPDIR/$SESSION_ID token instructions", () => {
  const docs = globSync("skills/*/SKILL.md").sort();
  // Guard the sweep's enumeration: the change swept every published skill.
  assert(docs.length >= 14, `expected all bundled skills documented, found ${docs.length}`);
  const offenders: string[] = [];
  for (const doc of docs) {
    const text = Deno.readTextFileSync(doc);
    for (const token of TOKENS) {
      if (text.includes(token)) offenders.push(`${doc}: ${token}`);
    }
  }
  assertEquals(offenders, [], `SKILL.md token instructions: ${offenders.join(", ")}`);
});

Deno.test("skill docs gate - script examples carry no token-form staging strings", () => {
  const scripts = globSync("skills/*/scripts/*.ts").sort();
  assert(scripts.length >= 7, `expected swept skill scripts, found ${scripts.length}`);
  const offenders: string[] = [];
  for (const script of scripts) {
    const text = Deno.readTextFileSync(script);
    for (const token of ["$TMPDIR/$SESSION_ID", '--session-id "$SESSION_ID"']) {
      if (text.includes(token)) offenders.push(`${script}: ${token}`);
    }
  }
  assertEquals(offenders, [], `script token-form examples: ${offenders.join(", ")}`);
});
