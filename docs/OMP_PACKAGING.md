# OMP Packaging — pinned `omp` install + owned image tree

OpenSpec change: `package-pinned-omp-runtime` (OMP batch row 20 / P8).
Packaging of the trusted extension itself (the generated native-loadable
bundle) is `package-bun-compatible-omp-extension` (C3): the mirror-copy +
sidecar-import-map scaffolding is REMOVED — one generated `index.js` is the
installed extension artifact.
This document is the packaging contract for the official Oh-My-Pi (`omp`) CLI
and the deployment-owned artifacts under `/opt/air/omp`. It installs bytes and
records digests; it certifies **nothing** about native enforcement — rows
12/13/14's gates and P0's unresolved verdicts gate security consumption, and
the live acceptance checklist (§7) is user-owned (design §15) and ships
explicitly unverified.

Related: [OMP settings](OMP_SETTINGS.md) (the row-8 overlays + SYSTEM.md
mapping), [OMP discovery](OMP_DISCOVERY.md) (the trusted extension's load-time
guard), [OMP network](OMP_NETWORK.md) (the fetch/search transports inside the
bundled tree).

## 1. Pinned version and digest table

The image installs OMP **v18.6.1** from the exact release tag
`https://github.com/can1357/oh-my-pi/releases/tag/v18.6.1`
(commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, the pinned compatibility
ledger in `docs/OMP_COMPATIBILITY.md`). Digests are transcribed verbatim from
the approved design table (§12); **this change never downloads the assets** —
the first real-asset verification is the user-owned image build (§7), where a
mismatch fails the build closed at the checksum step and never installs.

| Asset (v18.6.1)           | Containerfile ARG    | SHA-256                                                            |
| ------------------------- | -------------------- | ------------------------------------------------------------------ |
| `omp-linux-x64`           | `OMP_SHA256_X64`     | `c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463` |
| `omp-linux-arm64`         | `OMP_SHA256_ARM64`   | `cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a` |
| `LICENSE`                 | `OMP_LICENSE_SHA256` | `16c45f9d667442781f03fa198914cc39abcaa48ec5ed8f644643e554ca2fbf63` |
| `THIRD-PARTY-NOTICES.txt` | `OMP_NOTICES_SHA256` | `d0c2e7c05bb4d755044b13fa560be58d01ab7c980b87892400a979397e569a8b` |

Verify a digest against the real asset with:

```sh
curl -fsSL https://github.com/can1357/oh-my-pi/releases/download/v18.6.1/omp-linux-x64 | sha256sum
```

**Bump deliberately.** The ACP contract shape the adapters and the trusted
extension consume is pinned to v18.6.1; tracking a moving tag would let an
upstream release change it silently. Any bump recomputes ALL four digests
against the real assets before merging, and re-verify the ACP request shape —
the same rule as the OpenCode pin, mirrored in the Containerfile stage comment.

## 2. Executable asset allowlist rule

Within the exact `v18.6.1` release only, the unpacker selects the **unique**
executable asset matching the regex `omp-linux-{arch}[^/]*` where `{arch}` is
`x64` (TARGETARCH `amd64`) or `arm64` (TARGETARCH `arm64`); any other target
arch fails the build naming it. Zero matches or more than one match aborts the
build, naming the count. The base image's floating `debian` tag can move the
libc the binary runs against, so the exact filename is allowlisted (rule
above), not pinned; uniqueness plus the pinned digest keep any asset-name or
content change under the same tag failing closed at the checksum step.

**Observed asset names:** v18.6.1 publishes plain `omp-linux-x64` /
`omp-linux-arm64` names (the unpacker echoes the observed name during the
build). Every download — executable, `LICENSE`, `THIRD-PARTY-NOTICES.txt` —
is verified with `sha256sum -c -` BEFORE any install/COPY consumption.

## 3. Install contract and ownership

| Image path                              | Source                                   | Owner:group | Mode       |
| --------------------------------------- | ---------------------------------------- | ----------- | ---------- |
| `/usr/local/bin/omp`                    | `omp-unpacker` stage (checksum-verified) | `0:0`       | 0755       |
| `/licenses/omp/LICENSE`                 | same stage                               | `0:0`       | 0644       |
| `/licenses/omp/THIRD-PARTY-NOTICES.txt` | same stage                               | `0:0`       | 0644       |
| `/opt/air/omp/config/restricted.yml`    | `agent-config/omp/restricted.yml`        | `0:0`       | 0644       |
| `/opt/air/omp/config/native-yolo.yml`   | `agent-config/omp/native-yolo.yml`       | `0:0`       | 0644       |
| `/opt/air/omp/config/models.yml`        | `agent-config/omp/models.yml`            | `0:0`       | 0644       |
| `/opt/air/omp/prompt/SYSTEM.md`         | `prompts/system_prompt_override.md`      | `0:0`       | 0644       |
| `/opt/air/omp/extension/index.js`       | build-time generated ESM bundle (C3)     | `0:0`       | 0644       |
| `/opt/air/omp/PACKAGE-MANIFEST.sha256`  | regenerated at every image build         | `0:0`       | 0644       |
| `/opt/air/skills/**`                    | `skills/` (row 28 owned skill root)      | `0:0`       | 0755 files |

Ownership rationale (deliberate divergences from the image's `$UID:0` 775
pattern, both documented in Containerfile comments):

- **`omp` binary is root-owned 0755, not `$UID:0` 775.** `$UID` is the agent's
  own user inside this image — a group-writable agent binary would be
  self-modifiable by the very process the restricted boundary governs (row 12's
  owned/non-writable ownership model). The runtime needs only the exec bit.
- **The whole `/opt/air/omp` tree is root-owned and read-only to the runtime
  user**, and it sits outside every agent-writable root: never under
  `/app/data`, `/app/prompts`, or `/home/deno`. The user-home config-dir
  pattern used for `opencode.json` was rejected for exactly this reason.
- **`/opt/air/skills` (row 28) is root-owned `0:0` `0755` for the same
  reason** — it is the skill authority the settings pin declares
  (`skills.customDirectories: [/opt/air/skills]`, docs/OMP_SETTINGS.md §7), so
  the agent must not be able to modify the tree it is trusted to read — and,
  by design, it sits OUTSIDE `/opt/air/omp`: its bytes are deliberately NOT in
  `PACKAGE-MANIFEST.sha256`'s digest set (the manifest covers the owned
  runtime tree only). The agent-writable personal tree at
  `/home/deno/.agents/skills` stays exactly as before and never feeds OMP
  skill authority (the seven foreign-source toggles are pinned false).

**No-new-Bun rule:** the official executable is self-contained; no OMP step
installs a JavaScript/Bun runtime or speculative helper packages. The
pre-existing `denoland/deno:debian` base is the image's only such dependency
and is not modified by these steps.

## 4. Dev→image path mapping (`src/utils/omp-paths.ts`)

The mapping is exported code, not a Dockerfile convention. All resolvers are
**image-first-if-exists** with byte-identical dev fallback: development
checkouts never own `/opt/air`, so existence of the root IS the deployment
signal and dev behavior is unchanged. The launch assembly
(`src/acp/agent-factory.ts`) consumes resolver output verbatim — there is no
second path convention — and row 9's fail-closed presence checks (and their
error messages) stay exactly as shipped.

| Export                             | Image path (when it exists)       | Dev fallback                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OMP_IMAGE_ROOT`                   | `/opt/air/omp`                    | — (constant)                                                                                                                                                                                                             |
| `resolveOmpTrustedExtensionPath()` | `/opt/air/omp/extension/index.js` | `build/omp-extension/index.js` (`OMP_TRUSTED_EXTENSION_BUNDLE_PATH` — the GENERATED development bundle; `deno task bundle:omp-extension` cuts it and the launch preflight fails closed with that remedy until it exists) |
| `resolveOmpConfigPath(devPath)`    | `/opt/air/omp/config/<basename>`  | `devPath` (e.g. `agent-config/omp/restricted.yml`)                                                                                                                                                                       |
| `resolveOmpSystemPromptPath()`     | `/opt/air/omp/prompt/SYSTEM.md`   | `/app/prompts/system_prompt_override.md`                                                                                                                                                                                 |

The launch face is NEVER the raw canonical source: `src/acp/omp/extension/`
(pinned by `OMP_TRUSTED_EXTENSION_PATH`) is the canonical SOURCE origin and
the bundler input, not a launch target — the Deno-only source tree cannot
load under the pinned native host, so presenting it would bake in a dev/image
behavior split.

Prompt precedence: the row-8 operator mount path
`/app/prompts/system_prompt_override.md` wins whenever it exists — mounts are
operator-owned and never relocated (in a stock image it is populated by the
bundled default or an operator mount, exactly as row 8 defined). The owned
`SYSTEM.md` artifact serves installs where the mount path is absent but the
owned tree is present; its digest is covered by the manifest either way.

## 5. Extension artifact: the generated native-loadable bundle

`scripts/omp/bundle-omp-extension.sh` (+ `bundle-extension.ts`, audit in
`bundle-audit.ts`) cuts ONE generated ESM bundle — the single
`index.js` installed at `/opt/air/omp/extension/index.js` (and, in dev,
`build/omp-extension/index.js`, gitignored generated output):

`deno bundle --frozen=true --format esm --keep-names` runs with `cwd` set to
the passed source root (repo root in dev, `/build-src` in the image — where
`deno.json`/`deno.lock` resolve) on
the canonical entry `src/acp/omp/extension/index.ts` against the committed
`deno.lock`. Frozen mode refuses lockfile changes; `--keep-names` preserves
symbol identity; no minification, so the bundle stays auditable and the
locked `@std/*` closure survives INLINED with its `// deno:https://jsr.io/…`
provenance comments (the packaging suite asserts the inlined provenance).
The deterministic header prepended to the artifact records the input digest
inventory — `entry sha256 … src/acp/omp/extension/index.ts` and
`lock sha256 … deno.lock` — so every bundle names the exact source+lock
bytes it was cut from.

**Build-owned deployment declaration (`bind-omp-owned-module-evidence`).** The
bundle also carries the declaration the runtime verifier anchors its physical
evidence to: the canonical source checkout's generated
`build/omp-extension/index.js` artifact. `bundle-extension.ts` substitutes the
**realpath of the source root it was invoked with** into the one placeholder
the source carries (`bundle-declaration.ts`), and the header records both that
declared development artifact and the permitted dependency closure. The
transformation is deterministic and TARGET-INDEPENDENT: the same source root
produces byte-identical bundles into any output target, an output target gains
no runtime module authority, and a moved checkout is REBUILT (never relocated
at runtime). Packaging fails closed if the placeholder is absent or repeated,
if the substituted root is not an absolute canonical path, or if the artifact
carries an emitted edge outside the declared closure. The fixed image face
(`/opt/air/omp/extension/index.js`) is a runtime constant, so the same
generated artifact installs in the image and is recognized there.

**Native-loadable boundary (enforced, never trusted).** After bundling, the
production audit (`bundle-audit.ts`) enumerates the EMITTED external edges
(static import/export-from + literal dynamic-import specifiers) and fails
the build on anything outside: the documented native builtins (`node:`,
`bun:`) and the ONE host facade — the exact BARE `@sinclair/typebox`
schema-builder import (`align-omp-native-tool-contracts` D1). The pinned
legacy loader host-resolves that exact bare value import to the runtime's
own `Type` facade BEFORE any import-map lookup, which is why the bundle
keeps the canonical host-resolved spelling and the build deliberately
installs **no image-side npm: pin** (an npm: pin would bypass the host
facade and add an unowned module to the load-time graph). Subpaths like
`@sinclair/typebox/value` are NOT remapped and fail closed. Every leftover
jsr:/https: download edge, import-map alias (`@std/*` and friends), npm:
package, unapproved bare specifier, or non-inlined path edge aborts
packaging BEFORE installation — the sidecar import map the old packaging
relied on is gone, and native loadability cannot depend on it.

**Runtime-compatible DNS (D4).** The controlled transports' host-resolution
face (`read-replacement.ts runtimeResolveHost`) uses `node:dns/promises`
(native + Deno both provide it) through the shared A/AAAA collection rule
`resolveHostAnswers` in `src/utils/ssrf.ts`: one family with no records
never discards the other's answers, answers are normalized and deduped, and
the fail-closed rule stays in each consumer (empty → the single classifier's
block class, never an unvalidated-DNS fallback; no `Deno.resolveDns`).

The build consumes the cache stage's root-owned source copy (`/build-src`),
never the agent-writable `/app/src` 775 tree.

**External-trust asymmetry (named verification item, C3 shape).** No
runtime-download edge survives the emitted audit — the `@std/*` closure is
inlined, so the jsr-import-map question the mirror packaging carried is
CLOSED at the bundle boundary. What remains asymmetry: the bare
`@sinclair/typebox` edge resolves to whatever facade the real host provides
at trusted-extension load (the fixture in the packaging suite is a
stand-in), and whether OMP's embedded runtime reaches the discovery-gate
import at all stays design §15 user-owned and UNVERIFIED (row 12's
pre-import-exclusion blocker is unchanged: BOTH the dev bundle and the
canonical source still fail closed at load with the same discovery-gate
error — that parity is what the packaging suite proves). When row 12 is
ever resolved, the packaging suite's fail-closed parity test is designed to
fail on purpose in that same change, forcing the rewrite to
successful-load parity.

Scope note (row 27 + `bind-omp-owned-module-evidence`): the fail-closed load
above is what an identified-yet-UNRESOLVED launch sees. Under the row-27
deployment admission (restricted launch identity AND an `absent-clean`
executable-source observation for that exact workspace and generation) the load
SUCCEEDS, and the packaging suite's bundle smoke exercises exactly that path:
it builds the real bundle at its declared development path and drives the
default factory in a child process with the restricted launch env, asserting
that owned replacements reach their separate completion policies on real
module evidence while a foreign same-name registration still denies. That
smoke is harness evidence about the delivered artifact's own wiring — official
host behavior stays user-owned.

## 6. `PACKAGE-MANIFEST.sha256` and the recut invariant

`scripts/omp/generate-omp-manifest.sh` writes the manifest into
`/opt/air/omp` at build time: one `sha256  <relative-path>` line per installed
owned file (paths relative to that root, sorted; the manifest itself is the
only excluded file), root-owned 0644. The covered set is DERIVED from the tree
(`find`), so the install list and the manifest can never drift apart.

Header facts: `OMP_VERSION` (carried from the unpacker stage, so the manifest
records the SAME tag the checksums enforced), the trusted-extension serial
composition **12 → 13 → 14b → 17 → 18**.

Installed inputs covered by the digest (the full list on a fresh C3 build —
the extension tree collapsed to its generated single artifact):

- `config/restricted.yml`, `config/native-yolo.yml`, `config/models.yml`
- `prompt/SYSTEM.md`
- `extension/index.js` (the single generated bundle; the manifest digest is
  cut over its FINAL bytes on every build, and the bundle header records the
  source+lock digests it was generated from)

**Recut invariant (maintenance rule for successors — rows 21/22+ and any
insertion):** digests are cut only over FINAL content. The image build
regenerates the manifest on every build, and ANY change that lands content
touching `/opt/air/omp` inputs must regenerate `PACKAGE-MANIFEST.sha256` in
the same change — **a stale manifest after a content change is a
task-failure condition.** Because the bundled set is derived from the import
walk, a successor change that extends the extension's value-import closure
automatically changes the derived set AND forces the recut.

(C3 note: since the manifest generator derives the covered set from the tree
itself, a change that alters ANY extension source or `deno.lock` changes the
generated `index.js` bytes and therefore the recut — mechanically, the same
invariant, now over one file.)

## 7. User-owned acceptance (design §15) — NOT verified by CI

This change's tests are Containerfile-parse, bundle-replay, manifest-fixture,
and unit/mock assertions only: **no docker builds, no downloads, no
`omp --version` execution ever run in CI.** Every item below is user-owned and
ships explicitly UNVERIFIED:

- [ ] Real image build succeeds on amd64 (digests match the live v18.6.1 assets)
- [ ] Real image build succeeds on arm64 (digests match the live v18.6.1 assets)
- [ ] Observed asset names on both arches match §2 (allowlist selects exactly one)
- [ ] Container starts with the new stages and installs no additional Bun/JS runtime
- [ ] Installed binary reports the pin: `omp --version` → `18.6.1`
- [ ] `/opt/air/omp/PACKAGE-MANIFEST.sha256` verifies in the built image (`sha256sum -c`)
- [ ] OMP's embedded (Bun-embedded) runtime natively loads
      `/opt/air/omp/extension/index.js` with NO import map and NO download:
      the bare `@sinclair/typebox` edge reaches the host's own `Type` facade
      and the `node:*` builtins resolve (the §5 external-trust asymmetry;
      fail-closed at the discovery gate if the load never happens)
- [ ] The controlled transports' `node:dns/promises` resolution face works
      under the real host for a name with records in exactly one family
      (§5 D4; fixture-proven in CI, live-resolver behavior user-owned)

Until those are observed, this is packaging hygiene backed by mock evidence —
not clearance. The pin is prevention; the bootstrap version marker (`OMP
version check: OK|BELOW_MINIMUM|UNKNOWN`, warn-only, never blocks startup) is
observability only.

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section A: installed version, both arches, notices, startup without an added Bun dependency).
