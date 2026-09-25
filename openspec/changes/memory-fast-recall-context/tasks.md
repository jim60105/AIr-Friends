## 1. Configuration

- [x] 1.1 Add `fastRecallEnabled` (boolean, default `true`) to `MemoryRecallConfig` with validation, and document it in `config.example.yaml`. Verify with config-loader tests for the default and a non-boolean value.

## 2. Renderer

- [x] 2.1 Implement `src/core/memory-recall/fast-recall.ts` to render the memory and unverified channel sub-sections, omitting empty ones and the whole section when empty. Verify with unit tests for the formats, the absence of ids and scores, and `[from unknown contributor]`.

## 3. Context assembly

- [x] 3.1 Add the optional retriever argument to `ContextAssembler` (default built from `MemoryStore` and the recall config), and pass the shared instance from `src/core/agent-core.ts`. Verify with `deno task check`. The existing call sites in `tests/core/context-assembler.test.ts` and `tests/core/session-orchestrator*.test.ts` must still compile unchanged. (The shared instance is read through the new `SkillRegistry.getMemoryRetriever()`.)
- [x] 3.2 Implement the previous-message lookup and the Fast Recall call with `excludeIds = injectedIds`, gated on `fastRecallEnabled`. Verify with tests: an injected memory is not repeated, another user's message is ignored, the `/clear` bound is respected, and the retriever is not called when disabled.
- [x] 3.3 Render the section in `formatContext()` after the fixed sections and count it as mandatory tokens. Verify with a placement test and a 500-memory bound test (512 + 384 + 192 plus headings).
- [x] 3.4 Wrap the call in `try/catch` with a warning log. Verify with a test where a stub retriever throws and the context is still returned without the section.
- [x] 3.5 Add an optional `agentWorkspacePath` parameter to `assembleContext()` and pass it from `session-orchestrator.ts`. It stays unused until `note-fast-recall`. Verify with `deno task check`. (Named `_agentWorkspacePath`: an unused trailing parameter fails `deno lint`'s `no-unused-vars`, and the file already uses that convention for `_sessionId`. `note-fast-recall` renames it when it starts reading notes.)
- [x] 3.6 Verify that `assembleSpontaneousContext()` never calls the retriever, with a spy test.

## 4. Prompt, docs and verification

- [x] 4.1 Rewrite the memory-search guidance in `prompts/system_reply.md`. Verify with the prompt template rendering test, which must still pass.
- [x] 4.2 Update `docs/MEMORY_DESIGN.md` (Fast Recall) and the memory section of `AGENTS.md`. Run `deno task ci` and verify that it passes. (Its `deno fmt --check` step fails on 260 files that are already unformatted on `master` — `docs/`, `prompts/`, `openspec/changes/archive/` and others — so it cannot pass for any change; the files this change touches are not among them and `deno fmt --check src/ tests/`, `deno lint`, `deno check src/main.ts` and the full `deno test` all pass.)
