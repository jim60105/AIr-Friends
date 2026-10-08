## Why

Canonical root/target observations do not make a later ordinary path-based read or write safe: an agent can replace a directory or final file between validation and IO. The dependent client cutover needs complete access primitives that bind actual content IO to an identity-checked object opened beneath the selected canonical root, rather than claiming that another realPath check or optional bwrap closes the race.

## What Changes

- Add agent-neutral protected UTF-8 read, existing-file overwrite and exclusive new-file creation primitives consuming `canonicalize-acp-filesystem-roots` observations and an explicitly selected root role. They do not grant permission or choose a broader role on failure.
- Implement a narrow Linux/glibc descriptor backend using Deno FFI to system libc, Linux `openat2` constrained root-relative resolution, descriptor `statx`, and descriptor-only content IO. No new compiled helper, downloaded native package, invented Deno open option or OMP API.
- Fail closed on stale/mismatched session generations, missing/unrepresentable identities, unsupported platform/capability, symlink traversal, root/final replacement, and access errors; do not truncate before an existing opened file's identity and regular-file type are checked.
- **BREAKING on later adoption:** request-time parent/final symlinks, including contained links, are rejected by this first explicitly supported backend. Host-provisioned root aliases remain usable through their canonical identity. Missing parent directories/prospective roots are reported, not recursively created; current `Deno.writeTextFile` also does not create parents.
- Add consumer-visible unit, real temporary-filesystem and deterministic native-boundary mock tests; document descriptor-containment semantics, supported platforms and evidence limits.

## Capabilities

### New Capabilities

None; reuse the existing ACP integration capability.

### Modified Capabilities

- `acp-integration`: Add secure canonical-observation consumption, root-relative/no-follow content access, replacement/error semantics, explicit supported-platform admission and local-only evidence requirements. Existing callback policy requirements are intentionally unchanged until their separate cutover.

## Impact

Planned implementation files: new `src/acp/filesystem-access.ts`, `src/acp/filesystem-access-linux.ts`, `tests/acp/filesystem-access.test.ts` and `tests/acp/filesystem-access-linux.test.ts`; update existing `docs/AGENT_PERMISSIONS.md` and `CHANGELOG.md`. Consume predecessor `src/acp/filesystem-roots.ts` types without changing root definitions. Existing `deno.json` already grants `--allow-ffi` to start/unit tasks, and the Debian runtime already supplies glibc; no config/env field, lockfile dependency, Containerfile build or examples/Helm synchronization is introduced.

Non-goals: `ChatbotClient` callback cutover, restricted/shared/YOLO authorization choices, extensions/command policy, native OMP delegation, mkdir/delete/move/patch operations, root/staging/state redefinition, native security attestation, a portable unsafe fallback or compatibility shim. `enforce-acp-filesystem-authorization` owns sink adoption and bounded rejection recording; earlier compatibility blockers remain downstream application gates, not proposal-generation blockers.

Maximum workday: **8 hours** = 0.50 contract/platform alignment + 3.00 access/backend coding + 2.00 unit/temp/mock tests + 0.50 docs/changelog + 0.50 applicable verification + 1.50 contingency. The 6.5-hour core leaves 1.5 hours reserved rather than expanding scope. No split is needed for this read/write-only, no-recursive-mkdir implementation.

## Batch:

depends-on: establish-omp-compatibility-contracts
depends-on: canonicalize-acp-filesystem-roots

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts | Required source-contract/application gate, including trusted skill provenance | Consume actual verdict and identity contract; do not edit its module/artifacts. Shared additive `acp-integration` spec and `CHANGELOG.md`; apply serially. |
| canonicalize-acp-filesystem-roots | Required session/root/target observation API | Read-only dependency on `filesystem-roots.ts`; preserve prospective observations and root roles. Shared `docs/AGENT_PERMISSIONS.md`, `CHANGELOG.md` and additive `acp-integration` requirements; apply predecessor first. |
| enforce-acp-filesystem-authorization | Direct downstream consumer | Imports these primitives and selects the authorized role, with no fallback to ordinary IO. It owns `src/acp/client.ts` and client tests; shared docs/spec/changelog sections require serial integration. |
| normalize-acp-destructive-targets | Separate common-policy consumer | No delete/move/patch syscall implementation here; root types/docs/spec/changelog may overlap, not these read/write modules. |
| make-skill-staging-agent-portable | Later path/payload consumer | Existing lifecycle provisioning must supply an existing staging directory; this change does not mkdir or relocate payload roots. Shared permissions documentation/changelog only. |

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
