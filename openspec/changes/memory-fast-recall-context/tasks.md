## 1. Configuration

- [ ] 1.1 Add `fastRecallEnabled` (boolean, default `true`) to `MemoryRecallConfig` with validation, and document it in `config.example.yaml`. Verify with config-loader tests for the default and a non-boolean value.

## 2. Renderer

- [ ] 2.1 Implement `src/core/memory-recall/fast-recall.ts` to render the memory and unverified channel sub-sections, omitting empty ones and the whole section when empty. Verify with unit tests for the formats, the absence of ids and scores, and `[from unknown contributor]`.

## 3. Context assembly

- [ ] 3.1 Add the optional retriever argument to `ContextAssembler` (default built from `MemoryStore` and the recall config), and pass the shared instance from `src/core/agent-core.ts`. Verify with `deno task check`. The existing call sites in `tests/core/context-assembler.test.ts` and `tests/core/session-orchestrator*.test.ts` must still compile unchanged.
- [ ] 3.2 Implement the previous-message lookup and the Fast Recall call with `excludeIds = injectedIds`, gated on `fastRecallEnabled`. Verify with tests: an injected memory is not repeated, another user's message is ignored, the `/clear` bound is respected, and the retriever is not called when disabled.
- [ ] 3.3 Render the section in `formatContext()` after the fixed sections and count it as mandatory tokens. Verify with a placement test and a 500-memory bound test (512 + 384 + 192 plus headings).
- [ ] 3.4 Wrap the call in `try/catch` with a warning log. Verify with a test where a stub retriever throws and the context is still returned without the section.
- [ ] 3.5 Add an optional `agentWorkspacePath` parameter to `assembleContext()` and pass it from `session-orchestrator.ts`. It stays unused until `note-fast-recall`. Verify with `deno task check`.
- [ ] 3.6 Verify that `assembleSpontaneousContext()` never calls the retriever, with a spy test.

## 4. Prompt, docs and verification

- [ ] 4.1 Rewrite the memory-search guidance in `prompts/system_reply.md`. Verify with the prompt template rendering test, which must still pass.
- [ ] 4.2 Update `docs/MEMORY_DESIGN.md` (Fast Recall) and the memory section of `AGENTS.md`. Run `deno task ci` and verify that it passes.
