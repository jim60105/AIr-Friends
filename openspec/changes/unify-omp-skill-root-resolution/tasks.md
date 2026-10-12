# Tasks

## 1. Explicit selected-agent root plumbing

- [ ] 1.1 Keep `src/core/skills-root.ts` as the single root resolver; add canonical root observation using existing metadata helpers without changing image-first OMP/validated-repository or daemon-relative OpenCode selection. Extend resolver tests for OMP image, OpenCode image, repository development, HOME independence and explicit misses.
- [ ] 1.2 Thread mandatory resolved `skillsDir` through ACP connector/client and factory/sandbox inputs. Update all orchestrator construction forms, pooled construction/recovery, dashboard selected-agent overrides and direct client test fixtures; remove both `Deno.cwd()/skills` scan defaults. Resolve before subprocess creation and preserve C6 prompt/retry root identity.
- [ ] 1.3 Set the stock image's existing `AGENT_SKILLS_DIR` configuration to `/home/deno/.agents/skills`; keep Helm/container examples aligned and development default `skills` unchanged. Cover the declared COPY/config/working-directory relationship without building a container.

## 2. Root-exact permission decisions

- [ ] 2.1 Replace suffix entries/matching in `src/acp/client.ts` with canonical absolute script inventory and decision-time root/target observation. Resolve relative entrypoints only against the requesting registered session cwd; reject missing context, root replacement, foreign copies, sibling-prefix paths, traversal escapes and escaping symlinks using existing canonical-path helpers.
- [ ] 2.2 Scan only the explicit root and filter configured skill names there. Preserve observed SKILL.md command skills; remove absent/inaccessible-script-to-command-prefix promotion and HOME-global scanning. Add missing external-tree, unreadable-directory and invalid skill-name regressions.
- [ ] 2.3 Route restricted OpenCode direct and interpreter script invocations, including custom non-`skills` roots, to ACP `ask` in `agent-config/opencode.json`. Remove the broad skill `allow` bypass and retain other profile decisions, including native-YOLO, unchanged. Add permission-map/routing regressions.
- [ ] 2.4 Extend `tests/acp/client.test.ts` with real temporary-file planted-copy rejection (absolute and session-relative), exact trusted approval, alternate HOME/other-agent root rejection, linked-target escape, root replacement, quoted invocation and relative legitimate entrypoint cases. Retain fd redirects, chain, entrypoint laundering, legacy free-text and payload-variable verdicts.

## 3. Explicit external skill publication

- [ ] 3.1 Pass the resolver's explicit OpenCode install destination from `src/bootstrap.ts` into `src/core/skill-installer.ts` before AgentCore construction. Keep OMP inventory restricted to its selected root, even when external installation targets the OpenCode tree.
- [ ] 3.2 Adapt the existing install command/executor to use private temporary installer HOME and `--copy`, then publish only the validated requested materialized directory to the supplied destination. Reject traversal, linked/escaping publication and bundled-name/`lib` collisions; allow refresh of existing external entries. Remove private staging in `finally`, retaining sequential installs and per-entry failure isolation.
- [ ] 3.3 Extend installer/bootstrap tests with injected executor and real temporary directories to prove container/development/custom destination parity, HOME independence, awaited publication before inventory construction, failure/absent-tree behavior, collision preservation, link denial, refresh and staging cleanup on success/failure. Do not invoke live npx or network.

## 4. Read-only runtime visibility and readiness

- [ ] 4.1 Pass the resolved root through `src/acp/sandbox-manager.ts` and `src/acp/filesystem-confinement.ts`; mount it read-only at its literal path. Preserve legitimate OpenCode `/home/deno/.agents` read-only visibility and prevent writable mount ordering from overriding skill-tree read-only visibility. Cover image, development and custom mount arguments in existing confinement tests.
- [ ] 4.2 Make `src/healthcheck.ts` use the default selected agent's root resolver for registered script checks; turn root ConfigError into an explicit failed readiness entry and HTTP 503 without a fallback tree. Extend `tests/healthcheck.test.ts` for image/dev parity, owned-script missing despite a personal copy, resolver error, optional external failure and unchanged 30-second cache/other dependency behavior.

## 5. Wiring regressions and handoff

- [ ] 5.1 Add a mock wiring identity regression capturing `resolver root == prompt/retry skillsDir == connector inventory root == skill mount == readiness root` for OMP image, OpenCode image and repository development; separately cover dashboard agent override and pooled reconnect (readiness remains deployment-default scoped). Retain OMP missing/unowned native provenance denials and label synthetic positives honestly.
- [ ] 5.2 Update `docs/AGENT_PERMISSIONS.md`, `docs/SKILLS_IMPLEMENTATION.md`, `docs/DEVELOPMENT.md`, `docs/DESIGN.md`, configuration examples and CHANGELOG with the root matrix, external OpenCode-only authority, failure behavior and removal of suffix/HOME/default-cwd trust. Remove obsolete claims and document decision-time matching limits; no shim or migration.
- [ ] 5.3 Run affected resolver/installer/client/connector/factory/pool/dashboard/confinement/healthcheck unit suites and the existing mock handoff suite once after the whole cutover, plus repository-required type/style checks and strict OpenSpec validation. Report only exercised results; real-agent/container/bwrap acceptance remains user-owned and unverified.
