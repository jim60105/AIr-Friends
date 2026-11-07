#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml
/**
 * Fixture skill script for the injection suites (design D1).
 *
 * Its hardened shebang is the decided invocation form; the suites compare what
 * this script does from an attacker-controlled directory, home directory and
 * environment with what it does from an empty one. One line of JSON is printed
 * so a hijacked import, a loaded environment file or a preloaded attacker
 * module is visible as a difference in `stdout`.
 */
import { parseArgs } from "node:util";
import { helperValue } from "./helper.ts";

// A bare specifier the working directory could hijack: a `tsconfig.json` path
// override, a `node_modules` package or an npm-style script of the same name.
// Dynamic on purpose: no such module may exist, so a static import could not
// resolve, and the probe must fail into `"absent"` rather than crash the skill.
const bare = await import("poc-bare-probe").then(() => "found", () => "absent");

console.log(JSON.stringify({
  marker: "SKILL-RAN",
  args: parseArgs({ args: process.argv.slice(2), options: { flag: { type: "string" } } }).values,
  helper: helperValue,
  bare,
  attackerEnv: Object.keys(process.env).filter((key) => key.startsWith("AIR_POC_ATTACKER")),
}));
