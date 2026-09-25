## Context

The recall engine (BM25 lexical score + entity/phrase/metadata bonuses, tier budgets for fixed loading) is implemented, archived, and specified in `openspec/specs/memory-recall/spec.md`; `docs/MEMORY_DESIGN.md` and `prompts/system_reply.md` were updated during the series. What remains are three reference documents whose memory sections still describe the v1 engine. `AGENTS.md` was already partially updated mid-series — the canonical tier-vs-importance paragraph is at ~lines 279-281 — so only its container-binary line is stale.

## Goals / Non-Goals

**Goals:**
- Every statement about memory retrieval, context loading, and `importance` in `docs/DESIGN.md`, `docs/SKILLS_IMPLEMENTATION.md`, and `AGENTS.md` matches the shipped recall engine and `openspec/specs/memory-recall/spec.md`.
- `rg`'s presence in the container is described by its actual current role (agent-side file reading under the ACP permission gate), not as the memory-search mechanism.

**Non-Goals:**
- No changes to `docs/MEMORY_DESIGN.md`, `openspec/specs/`, prompts, skills, or code.
- No removal or rewording of `memory.searchLimit` / `memory.maxChars` example lines in these documents (including the `docs/DESIGN.md` config block at ~566-568) — that is `remove-dead-memory-config`'s scope.
- No formatting pass: touched files are not in the `fmt` scope (`src/ tests/`), and edits preserve surrounding formatting.

## Decisions

- **Reuse the canonical wording, don't restate the spec.** The tier-vs-importance sentences already in `AGENTS.md` (~279-281) and `docs/MEMORY_DESIGN.md` are the source text; stale passages are replaced with condensed versions of it rather than new prose, so the three documents cannot drift apart again at the next spec edit. Alternative considered: link to `docs/MEMORY_DESIGN.md` everywhere instead of restating — rejected because `DESIGN.md` and `SKILLS_IMPLEMENTATION.md` are standalone overviews whose readers expect inline behavior text.
- **Keep `rg` in the container docs.** The binary is still installed (Containerfile) and used by the agent's file-reading allow-list (`agent-sandbox-hardening` spec); only the stated purpose changes from "memory search" to in-workspace file reading. Removing the line would misstate the image contents.
- **`memory-search` doc wording tracks the skill contract** in `skills/memory-search/SKILL.md` (natural-language query, `memories`/`agentNotes`, `score`, `matchedTerms`), which is already updated — documentation quotes the skill contract, not the retriever internals.

## Risks / Trade-offs

- Line numbers cited above shift as the series-era edits landed; implementers locate passages by content (`always loaded`, `ripgrep`, `search keywords`), not line number.
- Overlap with `remove-dead-memory-config` in the same three files is confined to distinct lines (config examples vs. retrieval prose); queueing the config change after this one avoids textual conflicts.
