# OMP Packaging — pinned `omp` install + owned image tree

OpenSpec change: `package-pinned-omp-runtime` (OMP batch row 20 / P8).
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

| Image path                              | Source                                       | Owner:group | Mode                   |
| --------------------------------------- | -------------------------------------------- | ----------- | ---------------------- |
| `/usr/local/bin/omp`                    | `omp-unpacker` stage (checksum-verified)     | `0:0`       | 0755                   |
| `/licenses/omp/LICENSE`                 | same stage                                   | `0:0`       | 0644                   |
| `/licenses/omp/THIRD-PARTY-NOTICES.txt` | same stage                                   | `0:0`       | 0644                   |
| `/opt/air/omp/config/restricted.yml`    | `agent-config/omp/restricted.yml`            | `0:0`       | 0644                   |
| `/opt/air/omp/config/native-yolo.yml`   | `agent-config/omp/native-yolo.yml`           | `0:0`       | 0644                   |
| `/opt/air/omp/config/models.yml`        | `agent-config/omp/models.yml`                | `0:0`       | 0644                   |
| `/opt/air/omp/prompt/SYSTEM.md`         | `prompts/system_prompt_override.md`          | `0:0`       | 0644                   |
| `/opt/air/omp/extension/**`             | build-time mirror bundle of committed `src/` | `0:0`       | 0755 dirs / 0644 files |
| `/opt/air/omp/PACKAGE-MANIFEST.sha256`  | regenerated at every image build             | `0:0`       | 0644                   |

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

| Export                             | Image path (when it exists)       | Dev fallback                                       |
| ---------------------------------- | --------------------------------- | -------------------------------------------------- |
| `OMP_IMAGE_ROOT`                   | `/opt/air/omp`                    | — (constant)                                       |
| `resolveOmpTrustedExtensionPath()` | `/opt/air/omp/extension/index.ts` | `src/acp/omp/extension/index.ts`                   |
| `resolveOmpConfigPath(devPath)`    | `/opt/air/omp/config/<basename>`  | `devPath` (e.g. `agent-config/omp/restricted.yml`) |
| `resolveOmpSystemPromptPath()`     | `/opt/air/omp/prompt/SYSTEM.md`   | `/app/prompts/system_prompt_override.md`           |

Prompt precedence: the row-8 operator mount path
`/app/prompts/system_prompt_override.md` wins whenever it exists — mounts are
operator-owned and never relocated (in a stock image it is populated by the
bundled default or an operator mount, exactly as row 8 defined). The owned
`SYSTEM.md` artifact serves installs where the mount path is absent but the
owned tree is present; its digest is covered by the manifest either way.

## 5. Extension tree: mirror bundle

`scripts/omp/bundle-omp-extension.sh` (+ `bundle-extension.ts`) assembles
`/opt/air/omp/extension` from the committed sources at build time — a
repo-relative **mirror copy of the value-import closure**, not a fork:

- 29 modules are copied VERBATIM under `extension/mirror/<repo-relative-path>`
  (content-faithful: no rewriting, templating, or augmentation; dev and image
  load byte-identical sources — the packaging suite proves load parity).
- The ONLY generated modules are the entry adapter `extension/index.ts` (a
  pure re-export forwarding the contracted image path to the mirror entry) and
  `extension/deno.json` (an import map pinning the one external specifier
  family the closure needs — `@std/path` + its locked `@std/internal` — to the
  exact versions in the committed `deno.lock`).
- Type-only daemon modules (e.g. `code-search-transport.ts`) are NOT installed;
  the loader erases type-only imports and the suite proves the erasure by
  loading the bundle. Any external bare VALUE specifier outside `@std/*` fails
  the build — the boundary is enforced, never trusted.
- The build consumes the cache stage's root-owned source copy (`/build-src`),
  never the agent-writable `/app/src` 775 tree.

The bundled set is DERIVED from the import walk, never a hand-maintained list.

## 6. `PACKAGE-MANIFEST.sha256` and the recut invariant

`scripts/omp/generate-omp-manifest.sh` writes the manifest into
`/opt/air/omp` at build time: one `sha256  <relative-path>` line per installed
owned file (paths relative to that root, sorted; the manifest itself is the
only excluded file), root-owned 0644. The covered set is DERIVED from the tree
(`find`), so the install list and the manifest can never drift apart.

Header facts: `OMP_VERSION` (carried from the unpacker stage, so the manifest
records the SAME tag the checksums enforced), the trusted-extension serial
composition **12 → 13 → 14b → 17 → 18**, and the row-19 fact that the 6th
serial slot is **reserved-but-unconsumed** (the public-code-search row lands no
extension sibling).

Installed inputs covered by the digest (the full list on a fresh build):

- `config/restricted.yml`, `config/native-yolo.yml`, `config/models.yml`
- `prompt/SYSTEM.md`
- `extension/index.ts`, `extension/deno.json` (the two generated modules)
- `extension/mirror/src/acp/`: `destructive-policy.ts`, `filesystem-policy.ts`,
  `filesystem-roots.ts`, `omp-settings.ts`
- `extension/mirror/src/acp/omp/`: `approval-records.ts`,
  `code-search-routes.ts`, `compatibility-contracts.ts`,
  `destructive-decision.ts`, `destructive-validator.ts`, `discovery-guard.ts`,
  `fetch-routes.ts`, `fetch-transport.ts`, `inventory-validator.ts`,
  `lsp-validator.ts`, `record-evaluator.ts`, `search-routes.ts`,
  `search-transport.ts`, `tool-inventory.ts`, `tool-provenance.ts`,
  `transport-validator.ts`
- `extension/mirror/src/acp/omp/extension/`: `_daemon/mod.ts`, `bootstrap.ts`,
  `enforcement-error.ts`, `enforcement.ts`, `index.ts`, `read-replacement.ts`,
  `search-replacement.ts`
- `extension/mirror/src/utils/`: `omp-paths.ts`, `ssrf.ts`

**Recut invariant (maintenance rule for successors — rows 21/22+ and any
insertion):** digests are cut only over FINAL content. The image build
regenerates the manifest on every build, and ANY change that lands content
touching `/opt/air/omp` inputs must regenerate `PACKAGE-MANIFEST.sha256` in
the same change — **a stale manifest after a content change is a
task-failure condition.** Because the bundled set is derived from the import
walk, a successor change that extends the extension's value-import closure
automatically changes the derived set AND forces the recut.

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

Until those are observed, this is packaging hygiene backed by mock evidence —
not clearance. The pin is prevention; the bootstrap version marker (`OMP
version check: OK|BELOW_MINIMUM|UNKNOWN`, warn-only, never blocks startup) is
observability only.
