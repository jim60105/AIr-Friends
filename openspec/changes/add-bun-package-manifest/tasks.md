# Tasks

Prerequisite: the Go outcome is recorded. Verify with `grep -q '^Outcome: Go$' migration/bun/poc/GO-NO-GO.md`.

Do not edit `src/`, `tests/`, `scripts/`, `skills/`, `migration/`, `Containerfile`, `deno.json`, `deno.lock` or `.github/`.

## 1. Manifest and lock

- [ ] 1.1 Create `package.json` exactly as design D1, with the scripts table from design D4. Resolve the two placeholders (`yaml`, `@types/bun`) to exact versions. Verify: `bun -e 'const p=await Bun.file("package.json").json(); const v=Object.values({...p.dependencies,...p.devDependencies}); if (v.some(x=>/[\^~*]/.test(x))) process.exit(1)'` exits 0.
- [ ] 1.2 Create `bunfig.toml` exactly as design D2, then run `bun install` to create `bun.lock`. Verify: `bun install --frozen-lockfile` exits 0 and `git status --porcelain bun.lock` prints nothing after it.
- [ ] 1.3 Confirm drift is rejected. Verify: temporarily change `"prom-client": "15.1.3"` to `"15.1.2"` in `package.json`, run `bun install --frozen-lockfile` and observe a non-zero exit, then restore the file with `git checkout package.json` (or the editor undo if it is still uncommitted) and confirm `bun install --frozen-lockfile` exits 0 again.

## 2. Aliases and types

- [ ] 2.1 Create `tsconfig.json` exactly as design D3. Verify: `bun -e 'console.log(typeof (await import("@utils/hash.ts")))'` prints `object`, and `bun -e 'console.log(Object.keys(await import("@types/errors.ts")).length > 0)'` prints `true`.
- [ ] 2.2 Confirm the Bun type package is installed where `typeRoots` finds it. Verify: `test -f node_modules/@types/bun/package.json` succeeds. The type-checker side of the `@types/errors.ts` scenario is verified by `adopt-dprint-oxlint-and-tsc` task 3.2.

## 3. Native dependency evidence (P0-9, x86_64)

- [ ] 3.1 Verify both native packages are locked: `grep -c '@node-rs/jieba-linux-x64-gnu\|@node-rs/jieba-linux-arm64-gnu' bun.lock` prints at least `2`, and each name appears at least once.
- [ ] 3.2 Verify segmentation: `bun -e 'import { Jieba } from "@node-rs/jieba"; import { readFileSync } from "node:fs"; const t = Jieba.withDict(readFileSync("assets/jieba/dict.txt.big")).cut("我們今天去台北車站吃午餐"); console.log(JSON.stringify(t)); if (t.length < 2) process.exit(1)'` exits 0. Paste the printed tokens into the task report.

## 4. Housekeeping

- [ ] 4.1 Confirm scope. Verify: `git status --porcelain` lists only `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json` and this change directory (`.gitignore` needs no edit because `node_modules/` and `coverage` are already ignored; if `git status` shows `node_modules/`, add it to `.gitignore` and list that file too).
