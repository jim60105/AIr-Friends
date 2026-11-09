# Tasks

Prerequisite: `add-bun-package-manifest` is applied and dependencies are installed. Verify with `bun install --frozen-lockfile && test -d node_modules`.

Do not edit `scripts/omp/bundle-audit.ts`, `scripts/omp/prepare-native-cache.ts`, `src/`, `tests/`, `Containerfile` or `.github/`.

## 1. Bundler

- [x] 1.1 Convert `scripts/omp/bundle-extension.ts` per design D1. Verify: `grep -n 'Deno\.' scripts/omp/bundle-extension.ts` prints no code line (comments may remain only if still true), and `bun run --no-env-file scripts/omp/bundle-extension.ts` with no arguments exits 2.
- [x] 1.2 Update `scripts/omp/bundle-omp-extension.sh` per design D2 and add the script from design D3. Verify: `rm -rf build/omp-extension && bun run bundle:omp-extension` exits 0, `ls build/omp-extension` prints only `index.js`, and the bundler's last line reports `0 external edge(s)`.
- [x] 1.3 Check the missing-dependency path. Verify: `d=$(mktemp -d) && mkdir -p $d/src && cp -r src/acp $d/src/ && cp package.json bun.lock $d/ && sh scripts/omp/bundle-omp-extension.sh $d $d/out; echo $?` prints `2` and `test ! -e $d/out/index.js` succeeds (the copy has `bun.lock` but no `node_modules`).
- [x] 1.4 Check the audit path. Verify: `bun -e 'import { auditEmittedBundle } from "./scripts/omp/bundle-audit.ts"; const p = auditEmittedBundle("import x from \"zod\";\n"); console.log(p.length > 0)'` prints `true`.
- [x] 1.5 Load the artifact. Verify: `node --input-type=module -e 'const m = await import(process.argv[1]); console.log(typeof m.default)' "$PWD/build/omp-extension/index.js"` prints `function`.

## 2. Housekeeping

- [x] 2.1 Verify scope: `git status --porcelain` lists only `scripts/omp/bundle-extension.ts`, `scripts/omp/bundle-omp-extension.sh`, `package.json` and this change directory (`build/` is ignored), and `openspec validate bundle-omp-extension-with-bun --strict` exits 0.
