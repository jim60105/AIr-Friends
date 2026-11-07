# Tasks

Prerequisite: `identity-linked-memory-recall` is applied (`MemoryHandler` has the `identityRegistry` field). Verify with `grep -n "identityRegistry" src/skills/memory-handler.ts`.

## 1. Owner resolution

- [ ] 1.1 In `src/core/memory-store.ts` make `findMemoryById` public (design D1); no other edit. Verify: `deno check src/main.ts` passes and `deno test --allow-all tests/core/memory-store.test.ts` still passes.
- [ ] 1.2 In `src/skills/memory-handler.ts` `handleMemoryPatch` user-scope branch, insert the owner resolution from design D2, patch `owner`, and log `owner.key`. Do not touch the channel branch or parameter validation. Verify: `deno check src/main.ts` passes.
- [ ] 1.3 In `tests/skills/memory-handler.test.ts` add tests for every scenario of requirement "Linked Memory Patch Ownership", using a handler built as `new MemoryHandler(store, undefined, new IdentityRegistry([{ id: "alice", accounts: ["discord/123", "misskey/456", "misskey/789"] }], manager))` and memories written with `store.addMemory` on workspaces from `manager.getOrCreateWorkspace(...)`: current owner (linked file sizes unchanged); linked public owner (`enabled: false` appended to A's public file, B's file sizes unchanged, a following `memory-search` for B no longer returns it); linked private owner fails with `Memory not found:` when `isDm: false` and succeeds when `isDm: true`; the same id in two linked files (call `store.addMemory` on the `misskey/456` workspace, then `Deno.copyFile` its `memory.public.jsonl` to the `misskey/789` workspace's `memory.public.jsonl`, with the current `discord/123` workspace not owning it) returns an error containing the id and `ambiguous`, with all file sizes unchanged; an unknown id returns the existing message containing `--scope channel`; a directory at one linked account's `memory.public.jsonl` path (recall design D5) is skipped and the other linked owner is still patched. Verify: `deno test --allow-all tests/skills/memory-handler.test.ts` passes.

## 2. Verification

- [ ] 2.1 Run `deno fmt --check src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts` and `deno task test`; all pass. Run `openspec validate identity-linked-memory-patch --strict`; it passes.
