# Tasks

## 1. Native provenance and lifecycle registration (2 hours)

- [x] 1.1 Add the bounded persisted-journal resolver described in design D1, using factory XDG data, returned ACP UUID and registered cwd; cover title-slot metadata, unique candidate selection, bounds, mismatches and lazy artifact directories with temporary fixtures.
- [ ] 1.2 Add connector-owned optional artifact provenance to session gate registration after OMP new-session and successful load; invalidate on disconnect/removal/replacement and bind to fresh client generations without changing OpenCode or session-creation availability.

## 2. Root-scoped protected authorization (2 hours)

- [x] 2.1 Extend root/context observations and protected read dispatch for the optional `omp-session-artifacts` role, including connector-internal `readOmpSessionHeaderPrefix()` using the existing low-level secure backend without callback role admission, parent/journal anchoring and first-use artifact-directory identity binding. Retain descriptor cleanup and bounded denial mappings.
- [x] 2.2 Admit only direct regular numeric `.bash.log` files through that role. Add the reserved OMP-state precedence rule so overlapping workspace/staging/shared roles cannot authorize current or sibling state writes/reads; apply it to callback and edit/destructive authorization without changing native shell or generic-command policy.

## 3. Consumer regression coverage (2 hours)

- [x] 3.1 Extend filesystem root/policy/access and `tests/acp/filesystem-authorization.test.ts` with a parameterized pool/nonpool crossed with restricted/native-YOLO matrix, distinct Skill API/native IDs, canonicalized host-provisioned cwd aliases, actual spill text and line/limit semantics, ordinary `.log` rejection and denied writes.
- [x] 3.2 Exercise sibling sessions, same-prefix siblings, sibling modes, journals/auth/database files, `.md`/`.jsonl` state, malformed/duplicate/over-limit discovery, absent optional roots, symlink escape and deterministic root/ancestor/final replacement. Assert no denied content IO and unchanged sentinels.
- [x] 3.3 Extend connector/mock lifecycle coverage for context merges, fresh load registration, stale in-flight generations, sibling context isolation and failed optional discovery without a new session/recovery failure. Preserve existing OpenCode command-path and literal staging assertions.

## 4. Documentation and final verification (1.5 hours)

- [x] 4.1 Update ACP engine documentation and the release-note entry with the exact current-session read exception, OMP-context reserved-state precedence, discovery bounds and native-versus-callback evidence limits, explicitly retaining non-callback restricted generic-command reach. Update the affected broad-YOLO spec assertions for the explicit exception without changing OpenCode. Do not edit archived proposals.
- [x] 4.2 Run focused filesystem/connector regressions once after edits, then project type/lint/format checks and strict OpenSpec validation. Record actual results separately from any unexercised pinned-native acceptance; use the existing native harness only when its prerequisites are available. Results: `deno fmt --check src/ tests/` clean, `deno lint src/ tests/` clean, `deno check src/main.ts` clean, full `deno task test` 2753 passed / 0 failed / 7 ignored, `deno coverage` 88.7% lines / 92.1% branches / 83.1% functions, `openspec validate admit-current-omp-bash-artifacts --strict` valid. The pinned-native harness was NOT run (no native prerequisites exercised); that acceptance leg stays unexercised.
