# Spec Delta

## Purpose

Defines the mechanical Deno-to-Bun rewrite tool that the step 4 conversion changes run, so the same call shape always becomes the same Bun code and every use it cannot translate is reported.

## ADDED Requirements

### Requirement: Test Registration Rewrite

The codemod SHALL rewrite each `Deno.test` registration in string-name, string-name-with-options and object form into a `bun:test` `test` call with the same name and body, skipping it when the options carry `ignore`, and dropping sanitizer options.

#### Scenario: String form
- **GIVEN** `Deno.test("a - b", async () => { x(); });`
- **WHEN** the codemod runs
- **THEN** the file SHALL contain `test("a - b", async () => { x(); });` and import `test` from `bun:test`

#### Scenario: Object form with ignore and sanitizers
- **GIVEN** `Deno.test({ name: "n", ignore: !hasBin, sanitizeOps: false, fn: async () => {} });`
- **WHEN** the codemod runs
- **THEN** the file SHALL contain `test.skipIf(!hasBin)("n", async () => {});` and no sanitizer option

#### Scenario: Steps are reported
- **GIVEN** a `Deno.test` whose function calls `t.step(`
- **WHEN** the codemod runs
- **THEN** that registration SHALL be left unchanged and reported for manual conversion

### Requirement: API Call Rewrite

The codemod SHALL rewrite each call shape in its table to the listed `node:*`, `process` or helper call, add the needed imports once per file, and leave every other `Deno` use unchanged.

#### Scenario: Environment read
- **GIVEN** `const v = Deno.env.get("X");`
- **WHEN** the codemod runs
- **THEN** the file SHALL contain `const v = process.env["X"];`

#### Scenario: Recursive removal
- **GIVEN** `await Deno.remove(dir, { recursive: true });`
- **WHEN** the codemod runs
- **THEN** the file SHALL contain `await fsp.rm(dir, { recursive: true });` and one `import fsp from "node:fs/promises";`

#### Scenario: High-risk symbol untouched
- **GIVEN** `new Deno.Command("git", { args })`
- **WHEN** the codemod runs
- **THEN** the expression SHALL be unchanged and reported

### Requirement: Residual Report

After rewriting a file the codemod SHALL report every remaining `Deno` reference and every flagged pattern with its line number, and SHALL refuse to rewrite a file whose top-level names collide with an identifier it would import.

#### Scenario: Report lists leftovers
- **GIVEN** a file with one convertible call and one `Deno.open` call
- **WHEN** the codemod runs
- **THEN** the report for that file SHALL list the `Deno.open` line and no converted line

#### Scenario: Name collision
- **GIVEN** a file that declares `const fsp = 1;` and calls `Deno.readTextFile`
- **WHEN** the codemod runs
- **THEN** the file SHALL be unchanged and the tool SHALL exit non-zero naming the collision
