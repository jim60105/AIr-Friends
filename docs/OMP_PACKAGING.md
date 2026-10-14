# OMP Packaging — pinned `omp` install + owned image tree

OpenSpec change: `package-pinned-omp-runtime` (OMP batch row 20 / P8); the
`cutover-omp-native-runtime` core cutover supersedes its bundle-governance and
launch-face wording (§4/§5), and the artifact is now exactly the bundler's own
output.
Packaging of the trusted extension itself (the generated native-loadable
bundle) is `package-bun-compatible-omp-extension` (C3): the mirror-copy +
sidecar-import-map scaffolding is REMOVED — one generated `index.js` is the
installed extension artifact.
This document is the packaging contract for the official Oh-My-Pi (`omp`) CLI
and the deployment-owned artifacts under `/opt/air/omp`. It installs bytes and
records digests; it certifies **nothing** about native enforcement, and no
runtime acceptance is claimed. The live acceptance checklist (§7) is user-owned
and ships explicitly unverified.

Related: [OMP settings](OMP_SETTINGS.md) (the authored native mode settings and
the SYSTEM.md prompt mapping), [OMP discovery](OMP_DISCOVERY.md) (the native
executable-discovery surfaces), [OMP network](OMP_NETWORK.md) (the shared
egress/SSRF posture).

## 1. Pinned version and digest table

The image installs OMP **v18.6.1** from the exact release tag
`https://github.com/can1357/oh-my-pi/releases/tag/v18.6.1`
(commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`). Digests are transcribed
verbatim from the approved design table (§12); **this change never downloads the
assets** — the first real-asset verification is the user-owned image build
(§7), where a mismatch fails the build closed at the checksum step and never
installs.

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
| `/home/deno/.omp/agent/models.yml`      | `agent-config/omp/models.yml`            | `0:0`       | 0644       |
| `/opt/air/omp/prompt/SYSTEM.md`         | `prompts/system_prompt_override.md`      | `0:0`       | 0644       |
| `/opt/air/omp/extension/index.js`       | build-time generated ESM bundle (C3)     | `0:0`       | 0644       |
| `/opt/air/omp/PACKAGE-MANIFEST.sha256`  | regenerated at every image build         | `0:0`       | 0644       |
| `/home/deno/.agents/skills/**`          | repository `skills/` tree (`COPY skills/` — the image's ONLY packaged skill tree) | `$UID:0`    | 0775       |

Ownership rationale (the one packaged skill tree first, then the deliberate
divergences from the image's `$UID:0` 775 pattern — both documented in
Containerfile comments):

- **`omp` binary is root-owned 0755, not `$UID:0` 775.** `$UID` is the agent's
  own user inside this image — a group-writable agent binary would be
  self-modifiable by the very process the restricted boundary governs. The
  runtime needs only the exec bit.
- **The whole `/opt/air/omp` tree is root-owned and read-only to the runtime
  user**, and it sits outside every agent-writable root: never under
  `/app/data`, `/app/prompts`, or `/home/deno`. The user-home config-dir
  pattern used for `opencode.json` was rejected for exactly this reason.
- **`/home/deno/.agents/skills` is the image's only packaged skill tree, and it
  is agent-writable by design.** It is not an ownership divergence: it follows
  the deployment's `$UID:0` 775 pattern, the linked `COPY` leaves the
  `/home/deno/.agents` parent entries at 0755 as this Containerfile's mode note
  records, and no second skill root exists under any other path. Both agent
  types resolve it (`agent.skillsDir` / `AGENT_SKILLS_DIR`) — the authored
  native mode settings point native skill discovery at it
  (`skills.customDirectories`, docs/OMP_SETTINGS.md), and native OMP expands the
  entry against the inherited HOME — and external runtime installs publish into
  the SAME tree alongside the authored content. It sits OUTSIDE `/opt/air/omp`,
  so no skill byte was ever in `PACKAGE-MANIFEST.sha256`'s digest set.

**Manifest scope is unchanged and still mandatory:** every installed
`/opt/air/omp` input is digest-covered, so the authored mode settings, the
prompt artifact and the generated extension bundle all require the same-change
recut described in §6. The native model file is NOT an `/opt/air/omp` input
(it installs under the native config HOME, above) and is therefore outside the
manifest's digest set.

**No-new-Bun rule:** the official executable is self-contained; no OMP step
installs a JavaScript/Bun runtime or speculative helper packages. The
pre-existing `denoland/deno:debian` base is the image's only such dependency
and is not modified by these steps.

## 4. Dev→image path mapping (`src/utils/omp-paths.ts`)

The mapping is exported code, not a Dockerfile convention. Every resolver is
**image-first-if-exists** with a byte-identical development fallback:
development checkouts never own `/opt/air`, so existence of the root IS the
deployment signal and dev behavior is unchanged. The launch assembly
(`src/acp/agent-factory.ts`) consumes the resolved paths verbatim — there is no
second path convention — and the restricted launch's fail-closed presence check
(and its error message) stays exactly as shipped.

| Export / selector                 | Image path (when it exists)       | Dev fallback                                                                                                                                                            |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OMP_IMAGE_ROOT`                  | `/opt/air/omp`                    | — (constant)                                                                                                                                                            |
| `resolveOmpExtensionPath()`       | `/opt/air/omp/extension/index.js` (`OMP_IMAGE_EXTENSION_ARTIFACT`, root-owned, outside every agent-writable root) | `build/omp-extension/index.js` (`OMP_TRUSTED_EXTENSION_BUNDLE_PATH` — the GENERATED development entry; `deno task bundle:omp-extension` cuts it and the restricted launch fails closed with that remedy until it exists) |
| `resolveOmpConfigPath(devPath)`   | `/opt/air/omp/config/<basename>`  | `devPath` (e.g. `agent-config/omp/restricted.yml`)                                                                                                                      |
| `resolveOmpSystemPromptPath()`    | `/opt/air/omp/prompt/SYSTEM.md`   | `/app/prompts/system_prompt_override.md`                                                                                                                                |

The launch face is NEVER the raw canonical source: `src/acp/omp/extension/`
(pinned by `OMP_TRUSTED_EXTENSION_PATH`) is the canonical SOURCE origin and
the bundler input, not a launch target — the Deno-only source tree cannot
load under the pinned native host, so presenting it would bake in a dev/image
behavior split.

The native model file is keyed on the launch HOME instead: the authored
`agent-config/omp/models.yml` installs to `/home/deno/.omp/agent/models.yml`
(§3) — the native config path `getAgentDir()/models.yml` — and a development
deployment must author the same file at the operator's own native HOME path
(`$HOME/.omp/agent/models.yml`) before launch. No application code reads,
passes, translates or rewrites it: the pinned executable discovers and consumes
it itself, so the launch only exposes the inherited-HOME path read-only
(`AgentConfig.runtimeMounts`, the OMP launch assembly in
`src/acp/agent-factory.ts`).

Prompt precedence: the operator mount path
`/app/prompts/system_prompt_override.md` wins whenever it exists — mounts are
operator-owned and never relocated (in a stock image it is populated by the
bundled default or an operator mount). The owned
`SYSTEM.md` artifact serves installs where the mount path is absent but the
owned tree is present; its digest is covered by the manifest either way.

## 5. Extension artifact: the generated native-loadable bundle

`scripts/omp/bundle-omp-extension.sh` / `deno task bundle:omp-extension` (+
`bundle-extension.ts`, emitted-edge audit in `bundle-audit.ts`) cuts ONE
self-contained ESM file — the single `index.js` installed at
`/opt/air/omp/extension/index.js` (and, in dev,
`build/omp-extension/index.js`, gitignored generated output):

`deno bundle --frozen=true --format esm --keep-names` runs with `cwd` set to
the passed source root (repo root in dev, `/build-src` in the image — where
`deno.json`/`deno.lock` resolve) on
the canonical entry `src/acp/omp/extension/index.ts` against the committed
`deno.lock`. Frozen mode refuses lockfile changes; `--keep-names` preserves
symbol identity; no minification, so the bundle stays auditable. The artifact
is exactly the bundler's ESM output, with no prepended metadata of any kind,
and the build synthesizes or rewrites no OMP YAML (§1/§3 author every settings
byte by hand).

**Zero external edges (enforced, never trusted).** The bundled module graph is
the small capability-admission module only (`src/acp/omp/extension/index.ts`
registers the `tool_call` callback, `src/acp/omp/tool-inventory.ts` holds the
frozen capability map), so the bundle carries **no external dependency edge at
all**. After bundling, the production audit (`bundle-audit.ts`) enumerates the
EMITTED edges — static import/export-from, bare imports, literal dynamic
imports and literal runtime `require` edges — and fails the build on anything
outside the documented native builtins (`node:`, `bun:`). Every leftover
jsr:/https: download edge, import-map alias (`@std/*` and friends), npm:
package, unapproved bare specifier, non-inlined path edge, or computed
(non-static) dynamic-import specifier aborts packaging BEFORE installation —
the sidecar import map the old packaging relied on is gone, and native
loadability cannot depend on it.

The image's `cache` stage keeps `scripts/omp/` beside `src/`, `deno.json` and
`deno.lock`, and the owned-tree step invokes both the bundler and the manifest
generator from that read-only stage mount (`/build-src/scripts/omp/`). Module
specifiers resolve against the importing file's own URL, so the packaging
scripts must stay a sibling of `src/`; a relocated copy resolves `/opt/src` and
fails the build. The bundler toolchain itself is resolved at build time — `deno
bundle` fetches its own esbuild backend from the registry — which is
independent of the module graph this stage pre-caches.

The build consumes the cache stage's root-owned source copy (`/build-src`),
never the agent-writable `/app/src` 775 tree.

The artifact is pure build output of the committed source and the frozen lock —
it carries no per-target content and no path into the checkout — so a moved
checkout is REBUILT (never relocated at runtime) and the same generated file
serves the development and image faces; the image face
(`/opt/air/omp/extension/index.js`) is a runtime constant.

**Loadability is source-observed, not runtime-verified.** The audit proves the
generated bytes carry no non-native edge; it does NOT prove the pinned
executable's own extension loader accepts the artifact. Whether the restricted
launch's `--trusted-extension <bundle>` actually loads under the real native
host stays user-owned and UNVERIFIED (§7): if the load does not happen the
extension is omitted and the session runs without the restricted capability
callback, and no readiness signal reports it.

**What the delivered callback does (harness evidence only).** The bundle's
default export attaches one SYNCHRONOUS pre-dispatch handler through the pinned
official API (`api.on("tool_call", handler)`, `src/acp/omp/extension/`); a name
in the frozen capability map continues to native dispatch with no repeated
native or ACP authorization, and every other name is blocked before execution
with the bounded `rejected_unknown_tool` reason (own-property membership, so
prototype-shaped names never match). The packaging suite's bundle smoke builds
the real bundle at its development path, loads that module in a child process
without an import map and invokes its default export against a recording
`ExtensionAPI` surface, observing a mapped name continue and unmatched (and
prototype-shaped) names block. That smoke is harness evidence about the
delivered artifact's own wiring on a stand-in host surface; real host behavior
stays user-owned (§7), and the native-YOLO mode loads no extension at all.

## 6. `PACKAGE-MANIFEST.sha256` and the recut invariant

`scripts/omp/generate-omp-manifest.sh` writes the manifest into
`/opt/air/omp` at build time: one `sha256  <relative-path>` line per installed
owned file (paths relative to that root, sorted; the manifest itself is the
only excluded file), root-owned 0644. The covered set is DERIVED from the tree
(`find`), so the install list and the manifest can never drift apart.

Header facts: `OMP_VERSION` (carried from the unpacker stage, so the manifest
records the SAME tag the checksums enforced) plus the trusted-extension serial
composition line the generator still writes.

Installed inputs covered by the digest (the full list on a fresh C3 build —
the extension tree collapsed to its generated single artifact):

- `config/restricted.yml`, `config/native-yolo.yml`
- `prompt/SYSTEM.md`
- `extension/index.js` (the single generated bundle; the manifest digest is
  cut over its FINAL bytes on every build)

`agent-config/omp/models.yml` is NOT an `/opt/air/omp` input any more: it
installs at the native config-HOME path `/home/deno/.omp/agent/models.yml`
(§3), outside the manifest root, so it is not digest-covered.

**Still live until the separately scoped installation change:** this generation
script, the `/opt/air/omp/PACKAGE-MANIFEST.sha256` file and the Containerfile
step invoking both generators all STILL EXIST. They are removed by the later
installation change, not by the native core cutover documented here; until
then the manifest is regenerated on every image build exactly as before.

**Recut invariant (maintenance rule for successors — rows 21/22+ and any
insertion):** digests are cut only over FINAL content. The image build
regenerates the manifest on every build, and ANY change that lands content
touching `/opt/air/omp` inputs must regenerate `PACKAGE-MANIFEST.sha256` in
the same change — **a stale manifest after a content change is a
task-failure condition.** Because the covered set is derived from the tree
itself, a change that alters ANY extension source or `deno.lock` changes the
generated `index.js` bytes and therefore forces the recut — mechanically the
same invariant, now over one extension file.

The authored mode settings and the prompt artifact are hand-written inputs, so
a change to either of those files forces the recut too.

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
- [ ] The installed native model file is discovered by the pinned executable
      at its native config-HOME path (`/home/deno/.omp/agent/models.yml`) and
      its authored provider header and credentials are consumed as authored
- [ ] OMP's embedded (Bun-embedded) runtime natively loads
      `/opt/air/omp/extension/index.js` with NO import map and NO download
      (§5; if the load does not happen the extension is omitted and the
      session runs without the restricted capability callback — no readiness
      signal exists)
- [ ] Under the real host, a restricted launch's `--trusted-extension` bundle
      blocks an unmatched tool name and lets a mapped name reach native
      dispatch (the bundle smoke is API-shaped harness evidence only)
- [ ] The confined mount set exposes exactly the selected mode settings, the
      selected prompt, the restricted bundle and the inherited-HOME native
      model file read-only, plus that mode's `<XDG_DATA_HOME>/omp` read-write

Until those are observed, this is packaging hygiene backed by mock evidence —
not clearance. The pin is prevention; the bootstrap version marker (`OMP
version check: OK|BELOW_MINIMUM|UNKNOWN`, warn-only, never blocks startup) is
observability only.

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section A: installed version, both arches, notices, startup without an added Bun dependency).
