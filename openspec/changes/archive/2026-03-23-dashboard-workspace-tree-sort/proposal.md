## Why

The workspace file tree in the dashboard currently displays files and directories in filesystem enumeration order (`Deno.readDir`), which is non-deterministic and varies across platforms. Users expect an alphabetically sorted tree for easier navigation, especially when the workspace contains many files.

## What Changes

- Sort directory tree entries alphabetically by name within each directory level
- Directories should appear before files at each level (directory-first grouping)
- Sorting should be case-insensitive for natural ordering

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `web-dashboard-agent-workspace-browser`: Add a requirement that the directory tree entries are sorted alphabetically by name, with directories grouped before files

## Impact

- **Server-side**: `buildDirectoryTree()` in `src/dashboard/server.ts` — sort the `children` array after collecting entries
- **No API changes**: The response schema remains identical; only ordering changes
- **No client-side changes**: The `renderTree()` function in `workspace.js` renders children in the order received
