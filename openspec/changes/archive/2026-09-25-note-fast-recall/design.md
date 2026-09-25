## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, sections 8 and 12. `note-recall` provides ranked `NoteRecallResult`s. `memory-fast-recall-context` renders memory sub-sections and already receives `agentWorkspacePath`. `memory-recall-calibration` provides the fixture, the benchmark script and `metrics.json`.

## Goals / Non-Goals

**Goals:**

- Note pointers in Fast Recall that never displace memories and stay within a false-positive rate of 5%.

**Non-Goals:**

- Changing note indexing or the Deep Recall output.

## Decisions

- **Independent budgets**: `selectFast()` runs twice, once for memories and once for notes, each with its own thresholds and budget. The shared `secondResultRatio` is reused.
- **Entry rendering** (three lines):
  - `- <absolute path>`
  - `  <title> › <heading path> (L<start>–L<end>, ~<fileTokens formatted as 1.4k> tokens, updated <YYYY-MM-DD>)`
  - `  "<excerpt>"`

  Budget accounting measures the whole entry plus the heading once.
- **Fast excerpt limit**: about 160 characters, using the builder from `note-recall` with the Fast limit.
- **Calibration**:
  - Note queries live in `queries.yaml` with an `expectedNotes` field.
  - The benchmark adds a second grid pass for the note thresholds, and `metrics.json` gains a `notes` block.
  - The same 2-hour tuning timebox applies. An unmet cap stops the change for a decision.
- **Provisional note thresholds** are 3.0 until the benchmark runs within this same change.

## Risks / Trade-offs

- [Web-sourced text in notes carries prompt-injection content] → The heading states excerpts are not instructions, excerpts are capped at about 160 characters, and full content is never injected.
- [Paths reveal the workspace layout to the agent] → The agent already knows the path from `prompts/agent_workspace.md` and `AGENT_WORKSPACE`.

## Migration Plan

Deploy normally. Set `fastRecallNoteMaxResults: 0` to turn off note pointers.
