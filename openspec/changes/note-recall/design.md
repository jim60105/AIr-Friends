## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, section 6. Notes live under `{repoPath}/agent-workspace/`, which is `/app/data/agent-workspace` in the container. `AGENT_WORKSPACE` and `prompts/agent_workspace.md` expose the same path to the agent. The agent can write to this directory, so its contents, including symbolic links, must be treated as untrusted.

## Goals / Non-Goals

**Goals:**

- The agent can decide whether to open a note from its pointer.
- Nothing outside the workspace can be read through note indexing.

**Non-Goals:**

- Fast Recall notes and note threshold calibration (`note-fast-recall`).
- Non-Markdown files.

## Decisions

- **Chunker** (`note-chunker.ts`, pure):
  - Track fenced code blocks, so `#` inside code is ignored.
  - Start a chunk at every `##` or `###` heading, and keep the heading path from the last `#`, `##` and `###`.
  - Split chunks longer than 600 characters at blank lines, greedily packing paragraphs.
  - Text before the first `##` forms a chunk whose heading path is `[title]`.
- **Walk and containment**:
  - Recursive `Deno.readDir`.
  - Entries with `isSymlink` are skipped without following them.
  - For every directory and file, `Deno.realPath` must stay under the real path of `agentWorkspacePath`, checked with the existing `validatePathWithinBoundary()`. A failure is skipped with a debug log.
  - Skipping symlinks outright is simpler than resolving them, and there is no legitimate need for links in the workspace.
- **Snapshot**: the same `snapshot-cache.ts`, keyed by file path with size and mtime, storing chunks and `fileTokens`.
- **Separate statistics**: note `N`, `df` and `avgdl` come from note chunks only, because chunk and memory lengths differ widely.
- **Excerpt**:
  - Sentences split on `。！？!?` and newlines.
  - Choose the sentence with the most distinct matched terms, with ties going to the earliest.
  - Add the following sentence while under the limit.
  - When cut, trim around the first matched term and add `…`.
  - Excerpts come from the original text.
- **Deep budget merge**: the handler builds one list of memory and note items, sorts it by score, and admits items until `deepRecallMaxTokens` is reached. A note's size is `estimateTokens(JSON.stringify(entry))`, which is what the agent receives. Memories are measured the same way, so change 5's memory-only accounting is generalized here.
- **Types**: `NoteRecallResult` replaces `AgentNoteSearchResult`.

## Risks / Trade-offs

- [A large workspace makes the per-search walk slow] → `readDir` plus `stat` per file, and only changed files are re-read. Workspaces hold tens of files.
- [Web-sourced note text carries injection content] → Deep output is a tool result, the same trust level as today. The Fast Recall framing in change 9 adds an explicit "not instructions" heading.
- [Another importer of `text-search.ts` breaks on deletion] → A task re-checks with `grep` before deleting.

## Migration Plan

None.
