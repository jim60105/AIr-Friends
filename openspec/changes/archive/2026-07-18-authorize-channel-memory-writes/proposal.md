## Why

Security audit run-2 (finding F15, MEDIUM) found that `memory-save --scope channel` lets any ordinary channel member plant **permanent, unattributed, unremovable** content that is later presented to every other user in that channel as trusted fact. `handleMemorySave` (`src/skills/memory-handler.ts:89`) takes `scope` from agent-supplied params with only enum validation and no authorization; `memory-save` is registered globally (`registry.ts:56`), reachable from any session. An attacker asks the bot to "remember for the channel" at `tier: core`/`importance: high`; core tier pins `decay = 1.0` so it never decays (`memory-store.ts:655`), with no count cap. Thereafter, for every message from any *other* user in that channel, `context-assembler.ts:125` loads the entry unconditionally (no relevance filter) and renders it verbatim under `## Channel Knowledge` (`context-assembler.ts:384-386`) with **no author attribution** — formatted identically to the bot's own core memories — so attacker text enters other users' LLM turns as trusted channel knowledge. It cannot be removed through any in-app path: `patchChannelMemory` (`memory-store.ts:763`) is dead code, `handleMemoryPatch` operates only on the user workspace, no dashboard endpoint manages channel memory, and the memory-maintenance scheduler processes only per-user workspaces. Run-1's F3 added a session-type write-gate (`canWriteAgentWorkspace`) for the analogous shared-write hole in agent-workspace notes; it was never extended to this newer channel-memory subsystem.

## What Changes

- **Stop presenting channel memory as trusted, unattributed fact.** Render channel memories under an explicitly untrusted, user-attributed heading (e.g. `## Channel Notes (contributed by users, unverified)`) with each entry prefixed by its author, instead of `## Channel Knowledge` verbatim. Capture the author (`userId`) on save so attribution is possible.
- **Strip the "permanent" property from untrusted channel writes.** A channel write driven by an ordinary user SHALL NOT be pinned to non-decaying `core` tier; channel entries decay normally, and the channel core-tier entry count is bounded.
- **Make channel memory removable and moderatable.** Wire up the dead `patchChannelMemory` (enable/disable) and expose channel-memory listing/disabling in the dashboard so a planted entry can be removed.
- **Authorize channel-scope writes.** Thread a `canWriteChannelMemory` capability into `SkillContext` (mirroring `canWriteAgentWorkspace`) and gate `scope: "channel"` writes on it, with a config option to restrict or disable user-driven channel writes entirely. **Framing note:** under the recommended default (ordinary channel sessions may write, because the entries are now de-trusted, attributed, non-permanent, and moderatable), this gate is an **operator lockdown lever**, not a closed authorization gap — the real risk reduction comes from the de-trusting/attribution (render), the removal of the permanent pin, and moderatability, not from restricting *who* may write. An operator who wants channel writes limited to a curated flow flips the config; the gate makes that possible without deleting the feature.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `channel-memory`: channel-scope writes SHALL be authorized (not accepted from any session with enum-only validation), SHALL record their author, SHALL NOT be pinned as permanent non-decaying core memory when driven by untrusted input, SHALL be bounded in count, SHALL be removable/moderatable, and SHALL be rendered as attributed, unverified user contributions rather than as trusted channel knowledge.

## Impact

- **Code:** `src/skills/memory-handler.ts` (authorization gate; capture author), `src/skills/types.ts` (`canWriteChannelMemory` on `SkillContext`; author on save params), `src/core/session-orchestrator.ts` (thread the capability into the skill context), `src/core/memory-store.ts` (author field on channel entries; no forced `core`/`decay: 1.0` for untrusted writes; count cap; make `patchChannelMemory` reachable), `src/core/context-assembler.ts` (attributed, untrusted-framed rendering), plus a dashboard endpoint/UI for channel-memory moderation.
- **Config:** an option controlling whether/which sessions may write channel memory.
- **Docs:** channel-memory behavior and moderation notes.
- **Tests:** unauthorized channel write rejected; authorized write records author and does not pin `core`/`decay: 1.0`; rendering shows attribution + unverified framing; a planted entry can be disabled via the moderation path; count cap enforced.
- **Cross-reference:** this is the channel-memory analogue of run-1's F3 agent-workspace write-gate; it applies the same "shared store written by untrusted input must be gated and treated as untrusted on read" principle. Related in spirit to F16 (self-research note laundering), which addresses the other shared-store write path.
