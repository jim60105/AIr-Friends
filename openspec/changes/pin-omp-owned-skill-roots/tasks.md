## 1. Pinned settings and root contract (0.75h)

- [x] 1.1 Consume archived ownership/settings implementations and rows 25–27; trace extensibility/settings.ts exact skills.enabled/customDirectories and seven source-toggle registrations plus skills.ts remaining-provider/collision/process-global limits.
- [x] 1.2 Resolve existing deployment-owned canonical skills root/path and trusted-read contract, with no arbitrary new configurable root or critical-id expansion.

## 2. Owned overlays/composition (1.25h)

- [x] 2.1 Add skills.enabled true, complete owned absolute customDirectories array and false source toggles for Codex/Claude/Pi/Agents user/project sources in both overlays and typed content as specified by design D1.
- [x] 2.2 Extend registered-key/type/semantic validator and existing source plan with ownedSkillRoots; reject missing/empty/relative/tilde/extra/workspace/writable/linked roots and unknown/default-falling-back keys while retaining YOLO approval/LSP/shared-versus-restricted isolation.

## 3. Canonical selection and lifecycle (1.75h)

- [x] 3.1 Feed exact settings-declared roots to existing critical-skills/discovery adapter and trusted read consumers; exclude every workspace/provider/custom/managed/name-alias candidate before critical collision/precedence decisions.
- [x] 3.2 Require exact canonical instruction/source/read-only-root/current-session/resourceGeneration evidence; deny name-only authority, missing instructions, links/replacement/stale/foreign snapshots without workspace fallback or global skill disablement.
- [x] 3.3 Consume the declaration on new/load/refresh and preserve ordinary owned skills, staging/payload/literal session/retry flow; keep row-27 deployment checks and unchanged native gate data.

## 4. Unit/mock acceptance (2.00h)

- [x] 4.1 Test parsed actual assets/composition, source toggles, complete array replacement, root/type/key failures and preservation of both-mode LSP and native-YOLO approval/non-contamination.
- [x] 4.2 Test owned versus workspace same-name/same-content collisions, custom priority, managed/provider candidates/aliases and denied name-only requests; include missing/writable/replaced root and symlink cases.
- [x] 4.3 Test new/load/refresh current-session/current-generation selection and ordinary owned skill/trusted-read usability, without moving payload staging or rewriting existing delivery tests.

## 5. Package and documentation (1.00h)

- [x] 5.1 Install any shared helper inside existing owned extension closure, retaining no /app/src runtime imports, and recut PACKAGE-MANIFEST.sha256 for both overlay and modified installed closure bytes in the same change.
- [x] 5.2 Update OMP_SETTINGS.md, OMP_DISCOVERY.md, runtime checklist and focused CHANGELOG; remove current no-skills-key assertions, preserve native verdicts/DECIDED disposition and no new config/env/Helm fields.

## 6. Verification and handoff (1.25h)

- [x] 6.1 Run applicable local format/lint/type/focused unit/mock checks and strict validation; never run real native/provider/platform/container/bwrap acceptance.
- [x] 6.2 Record ≤8h implementation/test/docs budget, no archive edits, explicit declaration-to-selection interface, unchanged pinned limitations and native new/load/refresh observations as user-owned/unverified.

## 7. Post-implementation review record

Reviewer provenance: the designated rubber-duck model quota was exhausted, so the post-implementation review over `git diff master..HEAD` at ffe4847 was run by a code-reviewer agent (peer `SkillRootsReview28`). Verdict: correct, ZERO blockers, 4 non-blocking findings; every finding dispositioned below.

- [x] F1 (NON-BLOCKING, disclosure): pinned `*/SKILL.md` critical layout is unpopulated in the shipped `skills/` tree — on-image mint is always zero critical refs (fail-closed). DISPOSITION: disclosure chosen (no invented skill content); OMP_DISCOVERY.md critical-skill section, OMP_SETTINGS.md §7, and USER-RUNTIME-VERIFICATION.md section B now state the layout ships empty and operator mounts populate it.
- [x] F2 (NON-BLOCKING, dead code): `resolveFilesystemTarget` criticalRef ladder unreachable outside tests after the inline client gate landed. DISPOSITION: dead parameter + branches REMOVED (single live implementation — the client admission gate); tests/acp/filesystem-roots.test.ts no longer exercises the dead helper; the live gate path is exercised end-to-end in tests/acp/filesystem-authorization.test.ts (identity/source/session/generation/canonical-path and workspace-spoof negatives).
- [x] F3 (NON-BLOCKING, defense-in-depth): `canonicalizeSessionRoots` trusted-root hardening was conditional on an optional `rootIdentity`. DISPOSITION: absent identity is now an unconditional mismatch (`trusted_identity_mismatch`), matching the client gate's fail-closed discipline; fixtures attest real identities and a new negative asserts unattested roots fail construction.
- [x] F4 (NON-BLOCKING, dead branch): `observeDeclaredSkillRoots` Deno-only `${baseRoot}/owned-config/<mode>.yml` fallback matched no deployment shape and diverged from the Node backend. DISPOSITION: fallback and now-unused `baseRoot` parameter REMOVED; both backends deny identically off-image (frozen []); bootstrap call site updated.
- [x] Manifest recut for the review-fix bytes (installed inputs `filesystem-roots.ts`, `extension/bootstrap.ts`, `extension/critical-skills.ts` changed): 38 digests, PACKAGE-MANIFEST.sha256 sha256 deaa67e7968d7522c0284b156fbe0c72361730a85df7988129846a39534da309 supersedes the 1696808-recorded e35068e1e1a4ebc0a43827e9b051d1502f7701283d2979a7b46e87c90d6e1960; changed digests: filesystem-roots.ts c47c6ffb…, bootstrap.ts d6354819…, critical-skills.ts ec23a931… (config overlays unchanged: f53b1c9f…/6820efa7…). /opt/air/skills remains outside manifest scope.
