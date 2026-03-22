## Context

The `buildDirectoryTree()` method in `src/dashboard/server.ts` collects directory entries via `Deno.readDir()`, which returns entries in filesystem-dependent order. The rendered tree in the dashboard workspace tab reflects this arbitrary order, making it harder to locate files.

## Goals / Non-Goals

**Goals:**
- Sort tree entries alphabetically by name (case-insensitive) within each directory level
- Group directories before files at each level for conventional tree appearance

**Non-Goals:**
- Client-side sorting or re-ordering controls (sort is server-enforced)
- Custom sort options (date, size) — only alphabetical by name

## Decisions

**Sort location: server-side in `buildDirectoryTree()`**
- Rationale: Single sort point, all clients get consistent ordering. No client JS changes needed.
- Alternative: Client-side sort in `renderTree()` — rejected because it duplicates logic if other clients consume the API.

**Sort strategy: directories first, then files, both alphabetical case-insensitive**
- Rationale: Matches conventions of most file explorers (VS Code, GitHub, OS file managers).
- Alternative: Pure alphabetical without directory grouping — rejected as less intuitive.

## Risks / Trade-offs

- [Minimal performance impact] → Sorting up to 1000 entries (maxEntries limit) is negligible.
- [Ordering is a behavior change] → Existing users may notice reordering, but alphabetical is universally expected. No breakage risk.
