## Why

The generic-command gate (F12 D2) decides every path argument of an allow-listed read/media command with lexical `resolve()`/`isWithinDir` containment, while rows 2–4 established that lexical containment is insufficient: a file inside the session workspace that is a symlink to `/etc/passwd` or to a sibling workspace passes today's check and is approved, and the command's own IO then follows it. Design §6's Bash row mandates the existing command policy with the native ACP gate active and §8 requires physical containment, so this is a representation change, not a policy change: the same allow-list, flags and decisions, decided canonically.

## What Changes

- Decide every path argument (input AND output) of an allow-listed generic command through the row-2 canonical root/target observation instead of lexical `resolve()` containment, closing symlink-escape (parent-directory and final-link) and sibling-workspace bypasses that pass the lexical check today; a canonical observation failure — escape, loop, dangling link, unresolvable identity, missing/unresolvable root — denies with the existing `path_outside_boundary` reason and logs the predecessor failure name.
- Define the command gate's OWN root-role enumeration, because row 2 deliberately excluded these roots from the structured sinks: the session workspace (canonical), the shared Agent workspace, the shared-process-mode process TMPDIR, the session's OpenCode tool-output dir (session-local under the workspace data home, or the pool-key data root in shared-process mode), and the OpenCode data root as an isolation boundary only. A path physically inside the data root but outside THIS session's own data home stays denied; the shared home-rooted `~/.local/share/opencode/tool-output` never receives a role and fails closed; a contained tool-output dir gains no authority beyond its own directory.
- Re-express EVERY existing allow/deny case canonically with identical verdicts: home-anchored token expansion (`~`, `~/...`, `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}` expanded then canonically contained; attached values like `-o$HOME/...` and `--file=$HOME/...`), rejected unexpandable forms (`~otheruser/...`, `~notexpanded`, known-variable-without-runtime-value), attached short-option traversal rejections (`-f../sibling/file`, `-o../x`, attached absolutes), URI schemes, dangerous flags, shell-operator and fd-redirect tolerance, per-segment chain evaluation, and cross-session data-area isolation. No command gains or loses approval status incidentally.
- Fail closed on unresolvable canonical identity: the decision requires an authoritative per-session context and canonical roots; when observation cannot produce a complete decision the command is denied — never downgraded to the removed lexical fallback.
- Keep the gate exactly where it applies today: restricted mode only, the same generic-command allow-list; OpenCode restricted sessions keep the same decisions canonically re-expressed; native YOLO receives no new clamps (D6).
- Explicit non-goals (owned elsewhere): the restricted tool inventory/provenance/MCP decisions (14a `define-omp-restricted-tool-decisions`, landed) and trusted-extension handler wiring (14b `wire-omp-restricted-tool-enforcement`); anything OMP-specific in launch/process state (row 9); destructive-target normalization (row 5); the filesystem sink cutover (row 4, consumed); structured-path sinks and skills-root rules (untouched). Row 2's exclusion of process TMPDIR/tool-output/data-root roles for structured sinks stands unchanged.
- No new `config.yaml`, `.env`, or Helm field: the inputs are existing client config values plus predecessor observations. `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain intentionally unchanged; if implementation surfaces any new field, this change synchronizes all three itself.

## Capabilities

### New Capabilities

None. Reuse the existing ACP integration capability; the canonical command-path decision extends it rather than forking a parallel security specification.

### Modified Capabilities

- `acp-integration`: Amend the restricted-mode permission-handling requirement's generic-command wording and scenario so path-argument approval requires canonical physical membership in an enumerated command-gate root role rather than lexical containment, with symlink/sibling-escape and cross-session data-area denial scenarios, and ADD a canonical generic-command path decision requirement covering the root-role enumeration, fail-closed identity, expansion-then-canonical-decision order, restricted-only posture, and OpenCode allow-list parity. Predecessor canonical-root, secure-access and sink requirements are preserved, not redefined.

## Impact

Eventual implementation owns: a focused decision module `src/acp/command-path-policy.ts` (canonical path-argument decision plus command-gate root-role construction), the amended `src/acp/client.ts` generic-command gate call site (canonical root-role inputs assembled from the existing session gate context/client config; the obsolete lexical `isWithinDir`-based path-argument containment and the lexical tool-output/`dataRoot` branches removed), consumer-visible tests (`tests/acp/permission-gate-generic.test.ts` re-expressed on real temp-filesystem fixtures, plus a new `tests/acp/command-path-canonical.test.ts` for symlink/sibling escape and root-role cases), an amended `docs/AGENT_PERMISSIONS.md` generic-command gate section, and one `CHANGELOG.md` entry. The module imports — never edits — `src/acp/filesystem-roots.ts` (row 2) and consumes rows 3/4 contracts read-only; `src/utils/opencode-paths.ts` is consumed unchanged.

Evidence limits, stated honestly: the command executes natively in the agent subprocess, so the canonical observation is a decision-time containment proof, not race-proof protection against a path replaced between gate observation and the command's own IO — preservation through actual IO is the row-3 sink guarantee for delegated operations, and containment of command execution against racing remains the F12 D4 bwrap concern. Unit/mock tests prove gate decisions only; they prove nothing about native execution beyond the ACP callback.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Consume row-2/3/4 exports; define command-gate root-role construction incl. tool-output/data-root/process-TMPDIR roles | 0.75 |
| Implement canonical path-argument decision + client.ts call-site cutover with lexical-containment removal | 1.75 |
| Re-express every inherited allow/deny case + escape/role/unexpandable unit tests on real temp filesystems | 1.75 |
| `docs/AGENT_PERMISSIONS.md` section amendment + CHANGELOG | 0.50 |
| Applicable focused type/unit checks and OpenSpec verification, no live agents | 0.25 |
| Contingency for parity/review fixes | 0.50 |
| **Total hard ceiling** | **5.50** |

Core is 5.00 hours plus 0.50 contingency. 14a/14b tool-policy and wiring, row 9 launch, rows 17–19 transport and row 20 packaging are owned elsewhere and would exceed this change if attempted.

## Batch:

depends-on: canonicalize-acp-filesystem-roots
depends-on: secure-acp-filesystem-access
depends-on: enforce-acp-filesystem-authorization

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| canonicalize-acp-filesystem-roots (row 2) | Required observation API; read-only consumer | Uses row 2's root-identity/target-observation contract for canonical identity and escape decisions; adds command-gate root-role inputs WITHOUT editing or reinterpreting row 2's structured-sink role set (process TMPDIR/tool-output/data-root remain excluded there). `src/acp/filesystem-roots.ts` never edited. |
| secure-acp-filesystem-access (row 3) | Contract consumer, never bypass | Imports its error/evidence semantics so the gate cannot substitute a claim of operation-preserving containment; the gate performs no content IO. Never edits `filesystem-access*.ts`. |
| enforce-acp-filesystem-authorization (row 4) | Landed cutover; same call-site region and same spec requirement | Row 4 cut the sinks over and explicitly LEFT the generic-command gate lexical ("its own lexical policy here unchanged") — this change removes exactly that leftover and nothing else. Row 4's `SessionGateContext`/`filesystem-policy.ts` are extended (per-session command-gate inputs), not forked; both edits inside `src/acp/client.ts` must serialize (conflict note below). |
| normalize-acp-destructive-targets (row 5) | Same-requirement sibling | Shares the restricted-mode requirement and the `requestPermission` branching; destructive normalization untouched; shared surface is the serialized `client.ts` region and shared docs only. |
| define-omp-restricted-tool-decisions (14a) | Independent sibling; its `bash` allow row delegates HERE | 14a gates `bash` to the EXISTING common command policy; this change hardens that policy internally. Neither edits the other; the decision boundaries stay separable for 14b. |
| wire-omp-restricted-tool-enforcement (14b) | Independent sibling | Trusted-extension handler wiring untouched; 14b consumes whatever the common command policy returns; no shared edited file. |
| gate-omp-policy-readiness (row 13) | Same-file consumer | Reuses per-session context registration in `src/acp/client.ts`/`src/acp/types.ts`; readiness state and prompt gate untouched; serialize client edits. |
| make-skill-staging-agent-portable (row 16) | Later prompt consumer | Prompt recipes carry literal paths; the canonical decision is spelling-independent, so re-expressed cases must not depend on prompt-token changes here. |
| cover-omp-mocked-acp-lifecycle / finish-omp-mocked-skill-handoff (21/22) | Final regression/docs | Row 21 may exercise the hardened gate through mocked handler flows; must not duplicate this change's per-case unit assertions. Row 22 extends (never rewrites) the permissions docs. Zero config sync owed here. |

- Shared-file conflict: `src/acp/client.ts` generic-command gate call site is shared with rows 4/5/13/14a/14b/16 — this change confines its edits to the path-argument decision and root-role construction in that call site plus removal of the lexical helpers it replaces; apply serially after rows 4/5/13 and coordinate with 14b/16 before touching that region. `docs/AGENT_PERMISSIONS.md` and `CHANGELOG.md` are serial across rows 4/5/13/14a/14b/14c — this change only amends its own generic-command gate section, never predecessor sections. `src/acp/filesystem-roots.ts`/`filesystem-access.ts` are read-only.
- Spec-conflict: the delta MODIFIES `Permission Handling — Restricted Mode` (layering on row 4's amended text) and ADDS uniquely-named canonical command-path requirements within `acp-integration`; 14b/15 must not rewrite the command-gate requirements into tool-inventory or LSP claims, and no successor may restore a lexical fallback or widen the allow-list under the banner of this hardening.

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
