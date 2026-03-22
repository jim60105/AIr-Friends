## 1. Core Implementation

- [x] 1.1 Add sorting logic to `buildDirectoryTree()` in `src/dashboard/server.ts`: after collecting all children from `Deno.readDir`, sort the `children` array with directories first, then alphabetically by name (case-insensitive)

## 2. Testing

- [x] 2.1 Add unit tests for tree sorting: verify alphabetical order, directories-before-files grouping, case-insensitive comparison, and recursive sorting of nested directories
