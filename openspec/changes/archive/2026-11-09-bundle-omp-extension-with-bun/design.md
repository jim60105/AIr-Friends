# Design

## Context

See `proposal.md`. Observed facts:

- `scripts/omp/bundle-extension.ts` (95 lines) reads `[src, target, denoLockPath] = Deno.args`, bundles `ENTRY = "src/acp/omp/extension/index.ts"` to `${target}/index.js` with `deno bundle --frozen=true --format esm --keep-names --output`, cwd `src`, then runs `auditEmittedBundle` and `emittedExternals` from `./bundle-audit.ts` and exits 1 on any problem.
- `bundle-audit.ts` has no Deno use. It allows only `node:` and `bun:` externals, and documents the pinned native runtime as Bun-embedded.
- `src/acp/omp/extension/index.ts` imports `./native-registration.ts`, which imports `../tool-inventory.ts`. None of the three uses a `Deno` API at run time (one comment mentions `Deno.env`), so Bun can bundle them before step 4.
- `bundle-omp-extension.sh` checks `command -v deno`, runs `deno run --allow-read --allow-write --allow-run bundle-extension.ts`, then normalizes modes (dirs 0755, files 0644; `chown 0:0` as root).
- `tests/utils/omp-packaging.test.ts` calls the wrapper with three arguments and asserts one generated `index.js`, zero externals, load parity, and a standalone `node` load.

## Goals / Non-Goals

**Goals:** the same single-file, zero-external ESM artifact, built by Bun, with the audit still enforced.

**Non-Goals:**

- No edit to `bundle-audit.ts`, `src/`, `tests/`, `Containerfile` or CI.
- No change to `prepare-native-cache.ts`.
- No minification or new bundler option beyond the table in D1.

## Decisions

### D1. Bundler

`bundle-extension.ts` keeps its structure and comments that are still true. Changes:

| Before | After |
| --- | --- |
| `const [src, target, denoLockPath] = Deno.args` | `const [src, target] = process.argv.slice(2)`; usage error lists `<src-root> <extension-target>` and exits 2 |
| — | Exit 2 with `bundle-extension.ts: <src>/bun.lock missing` or `<src>/node_modules missing` (checked with `existsSync`) before any write |
| `Deno.mkdir(target, { recursive: true })` | `mkdir(target, { recursive: true })` from `node:fs/promises` |
| `new Deno.Command(Deno.execPath(), { args: ["bundle", "--frozen=true", "--format", "esm", "--keep-names", "--output", bundlePath, ENTRY], cwd: src })` | `spawnSync(process.execPath, ["build", "--target=bun", "--format=esm", "--outfile", bundlePath, ENTRY], { cwd: src, encoding: "utf8" })` from `node:child_process`. Add `"--keep-names"` after `--format=esm` only if `bun build --help` lists it. |
| `Deno.readTextFile`, `Deno.exit` | `readFile(path, "utf8")`, `process.exit` |
| Error text `deno bundle failed` | `bun build failed` |

Shebang-free; the wrapper invokes it. `bun build` does not minify by default, so names and provenance stay readable as before. The frozen-lock guarantee moves to the caller: the dependencies in `<src>/node_modules` must come from `bun install --frozen-lockfile`, which the image build does in `package-bun-container-image` and developers do after checkout.

`spawnSync` is acceptable here: this is a build script, not the agent spawn boundary.

### D2. Wrapper

`bundle-omp-extension.sh`: usage becomes `bundle-omp-extension.sh <src-root> <extension-target>`; `command -v bun` replaces `command -v deno` with the message `bundle-omp-extension.sh requires bun`; the run line becomes `bun run --no-env-file "${here}/bundle-extension.ts" "${SRC}" "${TARGET}"`. The mode-normalization block is unchanged. Update the header comment's usage line and `deno task` mention to `bun run bundle:omp-extension`.

### D3. Script

`package.json` script `bundle:omp-extension` = `sh scripts/omp/bundle-omp-extension.sh . build/omp-extension`.

## Risks / Trade-offs

- [`bun build` keeps a dependency external] → The audit fails the build (exit 1), exactly as before; inspect `emittedExternals` output.
- [The bundle behaves differently in the pinned OMP runtime] → `convert-utils-platforms-and-test-support-to-bun` runs the load-parity and standalone-load tests on the new artifact; `package-bun-container-image` loads it with the real `omp`.
