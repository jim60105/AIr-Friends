## 1. Configuration

- [x] 1.1 Add `coreMaxTokens`, `workingMaxItems` and `workingMaxTokens` to `MemoryRecallConfig` with defaults and validation, and document them in `config.example.yaml`. Verify with config-loader tests for the defaults and a negative value.

## 2. Selection

- [x] 2.1 Implement `fixed-selection.ts`. Verify with unit tests for every tiered-context-loading scenario, including a high-importance archive memory that is not loaded, a single long core memory that is skipped while later short ones are kept, and a working candidate that is skipped for size without being replaced.

## 3. Assembly

- [x] 3.1 Use `selectFixedMemories()` in `assembleContext()` and `assembleSpontaneousContext()`, fetching `workingMaxItems` working memories per source, and store `injectedIds` on `AssembledContext`. Verify with context-assembler tests: 25 working memories yield 4, a 900-token core set yields at most 512 tokens, and the spontaneous path is bounded.
- [x] 3.2 Update existing context-assembler and memory-v2 integration tests that assumed unbounded core or 20 working memories. Verify with `deno task test`.

## 4. Docs and verification

- [x] 4.1 Document the fixed budgets and the importance-versus-tier rule in `docs/MEMORY_DESIGN.md`. Run `deno task ci` and verify that it passes.
