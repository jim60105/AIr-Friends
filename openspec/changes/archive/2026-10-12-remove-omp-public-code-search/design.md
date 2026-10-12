# Design

## Context

See `proposal.md` for the parity decision. The public-search modules have no production caller. Current main specs nevertheless require their executor, marker, unsupported-credential gap, and reserved packaging slot. The original implementation is archived and remains historical evidence.

## Goals / Non-Goals

**Goals:** Cut over current source and specs without leaving dangling imports, validation prerequisites, or a permanent pending capability.

**Non-Goals:** Add a GitHub/search backend, promote `GITHUB_TOKEN`, change local search, or rewrite archives.

## Decisions

1. Delete `code-search-transport.ts` and `code-search-routes.ts`, their daemon exports, inventory row, route-registry entry, compatibility subcase, validator prerequisite, and named enforcement disposition. An unknown tool remains default-denied. A disabled alias would retain the false capability contract, so no alias remains.
2. Delete the inert `codesearch` allow entry from OpenCode's restricted permission map. Leave all other permissions and both agents' LSP decisions unchanged.
3. Remove the six `Public-Code-Search ...` requirements. Modify retained native-transport, inventory, fetch-route, and network-seam blocks in full to remove only their public-search clauses. C5 owns actual completion consumption later; removal does not authorize network execution.
4. Remove source/marker byte-identity and configuration-copy tests instead of repinning them. Retain meaningful unknown-tool, missing-required-subcase, and network-policy behaviors against capabilities that still exist. Preserve historical source evidence in a brief parity note, not as a runtime requirement.
5. Rebuild and recut the owned manifest after exports change, remove slot comments from build/runtime docs and checklist, and update changelog. Do not hand-edit a generated digest to match stale content.

## Risks / Trade-offs

- [A public-search reference remains in a validator or current manual checklist] → Enumerate consumers by symbol/reference search and distinguish frozen archives from active runtime requirements.
- [Removing a row accidentally admits a native GitHub/tool route] → Exercise default-deny behavior with an absent dedicated tool and keep alternate-execution restrictions.
- [C5 modifies the same main seam requirements] → Apply/archive this change before C5; C5's delta retains the post-removal requirement headers.

## Migration Plan

One clean source/spec cutover with no user config migration. Rollback is a whole-change revert, not a compatibility shim. Budget: implementation 1.75h, focused decision smoke 0.75h, docs/spec sync/digests 1.5h, total 4.0h. Native/provider execution is excluded.
