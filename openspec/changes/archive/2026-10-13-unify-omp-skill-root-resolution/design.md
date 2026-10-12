# Design

## Context

See proposal.md for motivation. Source inspection confirms four inconsistent inputs. `skills-root.ts` uses `OMP_IMAGE_SKILLS_ROOT = "/opt/air/skills"`, with a validated module-relative repository fallback; OpenCode uses `agent.skillsDir`, resolving relative paths against daemon cwd. `client.ts` scans a HOME-global second tree, stores relative suffixes, and promotes absent configured skills to command prefixes. Connector and client defaults scan `Deno.cwd()/skills`. Readiness stats an independently configured relative string.

The Containerfile copies built-ins to `/home/deno/.agents/skills` (runtime-UID writable) and `/opt/air/skills` (root-owned 0755), then runs from `/app`; `/app/skills` is absent. Helm supplies `AGENT_SKILLS_DIR=/home/deno/.agents/skills`, but the stock image merely sets HOME and copies a development-default config. Bootstrap awaits external installation at lines 183-185 before AgentCore construction at line 226; individual installer failures are logged and swallowed.

Two adjacent constraints matter. Restricted `opencode.json` script globs currently say `allow`, bypassing ACP, and its filesystem-routing spec explicitly permits that exception. OMP owned settings always declare `/opt/air/skills`; factory lines 359-367 deliberately mint no development owned authority. A development prompt's path is an instruction, and does not grant OMP native owned/critical provenance.

## Goals / Non-Goals

**Goals:** Use the selected agent's resolved install path at every script-root consumer, close same-suffix and agent-layer bypasses, and retain Feature 27 OpenCode execution through an explicit installed root. Test filesystem identity and failure behavior without a real agent or network.

**Non-Goals:** Expand OMP owned skill discovery to personal/external trees; change native-YOLO, critical-skill ownership, protected filesystem IO or staging/JWT semantics; add runtime readiness handshakes, compatibility shims, migrations or a new public root setting.

## Decisions

### D1. One selected-agent root, carried explicitly

Keep `resolveTrustedSkillsRoot(agentType, configuredSkillsDir, options)` as the single resolution boundary. Normalize/canonicalize its existing absolute results using the existing metadata seam; absent roots remain explicit ConfigError failures. Image OMP selects `/opt/air/skills`; image OpenCode selects `agent.skillsDir=/home/deno/.agents/skills`. Set `AGENT_SKILLS_DIR` in the Containerfile so the stock image matches Helm and the actual COPY destination. Development runs use the repository root as deployment cwd. OpenCode's relative `skills` and OMP's validated repository source resolve to the same repository tree. Do not substitute an arbitrary session/workspace cwd tree for OMP's validated source.

Carry the resolver result as mandatory internal `skillsDir` in connector/client and sandbox inputs. Resolve by the actual selected agent, including dashboard overrides, before subprocess creation. Update all orchestrator spawn forms, process-pool construction/recovery and dashboard construction together. Preserve C6 prompt/retry inputs; assert they equal the same selected-agent root rather than computing another spelling downstream. Remove ChatbotClient's implicit inventory default; direct callers/tests provide an explicit list/root. A missing root cannot silently produce a working client with an empty fallback list.

The resolved script root is separate from `TrustedSkillsSource`, which carries OMP ownership and resource-generation authority. An observed instruction path never manufactures that authority. OMP development remains fail-closed for native owned reads/critical selection exactly as its existing source plan requires, even when the instruction and ACP script inventory point at the development source. No new root is added to owned overlays, manifests or native skill discovery.

### D2. Feature 27 uses the existing explicit OpenCode install root

Do not trust owned and external roots simultaneously for OMP. OpenCode's built-ins and external scripts already share one install tree in the container; publish external skills into the resolved OpenCode `agent.skillsDir` in every deployment shape. On an OMP-default deployment, resolve that OpenCode install destination only when external skills are configured, since dashboard-selected OpenCode can still use it. Development shares the physical repository root between agent types, so root membership alone cannot distinguish bundled from published external scripts. Limit OMP inventory to the bundled catalog defined below, intersected with any configured approval list; OpenCode can discover external entries. Configuring external skills does not promise restricted OMP execution from a personal tree; document this boundary.

Adapt the existing installer to receive the absolute destination explicitly. The upstream universal global installer has no arbitrary destination parameter. [Its destination code](https://github.com/vercel-labs/skills/blob/main/src/installer.ts) joins `homedir()` with `.agents/skills`, while [its add parser](https://github.com/vercel-labs/skills/blob/main/src/add.ts) supports `--copy`. Run the existing `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy` in a private temporary installer HOME, then publish the requested materialized skill directory into the supplied destination. That temporary package layout is an adapter detail, never a scanned trust root, and must be removed in `finally`. Keep installation sequential; retain per-entry logging/failure isolation. Do not pass the temporary HOME into any agent process.

Publish only the requested validated single-component skill name, reject linked/escaping source or destination entries, and refuse collisions with bundled skill names and `lib`; never overwrite a bundled handler/script with an external same-name directory. Refreshes of existing external entries are allowed within the explicit destination. A failed/absent installation contributes no script grant and no inferred command-prefix grant. Do not create a missing built-in root to make resolver validation pass. Missing root configuration fails explicitly before installation; an individual missing external subtree remains a nonfatal installer failure.

This approach avoids a second public `externalSkillsDir` and removes the daemon-HOME dependency from installation publication as well as scanning. Pointing HOME directly at a configured path works only for directories ending in `.agents/skills` and would fail development/custom paths; silently retaining the old global tree would fail install/gate parity.

Use one authored deployment-controlled bundled-skill catalog in `src/core/bundled-skills.ts`, loaded from daemon application source rather than discovered from an agent-writable installed root. The current authored names are `agent-browser`, `cancel-reminder`, `chinese-content-writing-guideline`, `edit-reply`, `fetch-context`, `get-message`, `list-reminders`, `memory-export`, `memory-patch`, `memory-save`, `memory-search`, `memory-stats`, `react-message`, `self-research`, `send-file`, `send-reply` and `set-reminder`; `lib` is reserved shared content. Reuse this catalog for OMP inventory selection and installer collision rejection. A source parity fixture verifies the catalog against authored bundled directories; runtime-added names never amend it.

Owned image packaging must also consume this catalog. Replace the broad OMP `COPY skills/ /opt/air/skills/` with bundled-only staging through a small Deno packaging filter using the same catalog, then install cataloged directories and `lib` content-faithfully with the existing root-owned modes. Leave the OpenCode personal-tree install contract intact. Reject linked/escaping staging entries. An external directory added during development must be excluded from the owned staging output and therefore from native OMP owned discovery, regardless of whether ACP would deny it. This is a narrow packaging correction, with no changes to the extension/settings manifest scope.

### D3. Canonical exact script membership, preserving shell policy

Build the inventory from the explicit selected-agent root after bootstrap installation. Keep empty `autoApproveSkills` meaning scan the resolved directory for OpenCode and inspect the bundled catalog within that directory for OMP. A nonempty list filters observed skill names within that root and can never expand OMP beyond the catalog. Record canonical absolute regular-file script paths with the root observation needed for decision-time containment, using the existing metadata/canonical-path helpers. Reject escaping symlinks and unreadable observations. A known observed command-based skill with SKILL.md and no scripts directory may supply its existing exact command prefix; a missing/inaccessible skill or scripts directory does not become a command skill. Invalid path-component skill names cannot escape the root.

At each permission decision, locate the actual entrypoint through the existing shell parser, then canonicalize it relative to the requesting registered session cwd if it is relative. Absolute prompt recipes remain preferred. A relative path is eligible only if it resolves to the same enumerated script under the resolved root. Compare exact canonical absolute path membership and recheck root/target observation and physical containment. Reject a same-suffix planted copy, a sibling-prefix root, a traversal escape, a linked script escaping the root, missing targets and replaced root identity. No suffix, HOME expansion, or daemon-cwd retry is permitted. Reuse the parser's ordinary quote handling and preserve interpreter anchoring, fd redirects, per-segment chain checks, legacy free-text rejection and payload variables. This is a decision-time trust check; it does not claim race-free command execution or protect writable OpenCode scripts against later byte mutation.

Change both broad restricted OpenCode script patterns to `ask`; cover script entrypoints under custom roots too, so permitted configured directories need not have a final component named `skills`. Prefer a general `deno run *` ask route and a direct TypeScript-script ask route; ACP supplies the actual grant, and unrelated execution still defaults to deny. Retain YOLO entries unchanged. Amend the spec's old skill-pattern allow exception. Static native read permission entries and general OpenCode discovery are outside this command-approval change; they do not contribute script inventory authority.

### D4. Read-only mounts and readiness use the same input

Pass `skillsDir` through the existing factory/SandboxManager/bwrap seam and add its canonical path to read-only runtime mounts. Preserve the legitimate `/home/deno/.agents` read-only mount for OpenCode containers, deriving its relationship from the selected installed root rather than treating the hardcoded parent as skill authority; for custom/development roots mount the exact selected tree. OMP confinement exposes its owned root, never adds the personal tree as a trusted script root. Do not widen writable mounts.

Before spawn, compare the canonical skill tree with mandatory writable workspace/TMPDIR/shared-workspace/runtime mounts. Reject equality or a mandatory writable descendant of the skill tree, since those configurations cannot preserve both contracts. When the skill tree is a child of a writable parent, emit its read-only bind after that parent bind. Test all three overlap shapes without running bwrap; do not reinterpret overlap as an owned-provenance question.

Readiness obtains the default selected agent's resolver output and checks registered script paths there. A resolver ConfigError becomes an explicit failed skill-root readiness check and `/ready[z]` remains 503, rather than an unhandled server error or a stat of another root. Preserve the existing 30-second readiness cache, other dependency checks and liveness endpoints. A missing individual registered script still produces the existing per-script failure. Optional external skill installation failure does not turn readiness red when registered built-ins remain present.

### D5. Acceptance and implementation size

Extend `tests/core/skills-root.test.ts`, installer/bootstrap tests, `tests/acp/client.test.ts`, factory/connector/pool/dashboard fixtures, confinement tests and `tests/healthcheck.test.ts`. Use real temporary directory fixtures for canonical paths and links. Add a wiring identity regression that captures prompt/retry `skillsDir`, connector inventory root, confinement mount and readiness root for OMP image, OpenCode image and repository development, including dashboard override and pooled reconnect. Publish an external script into the shared development fixture and assert OpenCode approval with OMP denial, under both empty and explicitly configured approval lists. Add a bundled-packaging fixture with an extra external directory and assert its exclusion. OMP native provenance-denial fixtures remain labeled and unchanged in meaning. Use injectable installer execution, fake time for readiness caching and mock ACP fixtures; no live npx download, official agent, container or bwrap run is required.

Budget allocation is 1h for resolver/caller plumbing, 1.5h for exact matching and OpenCode routing, 1.5h for install publication, 1h for mounts/readiness, 0.5h for the shared catalog/packaging filter, 2h for regressions, and 0.5h for documentation and final focused checks, totaling 8h. Reuse existing metadata and mock wiring fixtures; the packaging filter is a directory-selection seam with no manifest redesign. One clean cutover is required. Rollback is a whole-change revert; no migration or legacy fallback is introduced.

## Risks / Trade-offs

- OpenCode's install tree is agent-writable on the host. Exact root matching rejects foreign copies; it does not elevate that tree to root-owned OMP authority or certify script content immutability.
- Changing restricted script patterns to `ask` exposes the real ACP policy. Tests must prove planted copies reach denial and legitimate custom-root scripts reach approval, with native-YOLO unmodified.
- Individual external failures can leave missing skills. Observation-based categorization must never approve a bare executable solely because its configured script was not installed.
- OMP development prompt instructions and native owned source declarations intentionally have different authority status. Identity tests must distinguish instruction/script-root equality from native owned authority; this change does not claim to make an unowned development tree a critical-skill source.
- Upstream installer behavior is mutable because Feature 27 already invokes an unpinned package. The executor fixture must assert the explicit staging HOME and publication contract; failure to produce the requested directory remains a logged failure with no new grant. Package pinning is outside this correction.

## Dependencies and Conflicts

| Change | Relationship | Code/spec overlap | Scheduling |
| --- | --- | --- | --- |
| `repair-omp-owned-skill-handoff` | Archived prerequisite, already satisfied | Resolver, prompt callers, `skills-and-reply`, `acp-integration` | Implement on archived baseline; no active depends-on edge |
| Active changes | None returned by `openspec list --json` before this proposal | None | No active serialization constraint |

Future work on ACP matching, installer/bootstrap, bundled packaging, sandbox mount inputs, healthcheck or the five modified capability specs conflicts with this atomic cutover and must be serialized or coordinated.

## Final Critique Disposition

The single whole-set rubber-duck review identified blocking B1, shared development publication could enter OMP inventory. The explicit catalog limit and shared-root approval/denial regression resolve that contradiction without adding another root. Nonblocking N1, development additions could enter the owned image COPY, is adopted through catalog-filtered packaging and an extra-directory fixture. Nonblocking N2, equal/ancestor skill and writable mounts cannot preserve both grants by ordering alone, is adopted through fail-closed overlap rejection and child-root bind ordering. No finding is deferred. These corrections are artifact decisions, not exercised implementation evidence.
