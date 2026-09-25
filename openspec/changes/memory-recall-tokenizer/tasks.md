## 1. Dependency and assets

- [x] 1.1 Download `dict.txt.big` from fxsjy/jieba at a pinned commit into `assets/jieba/`, add `LICENSE` (MIT, copied from upstream) and `README.md` (source URL, commit, sha256). Verify with `sha256sum` against the README.
- [x] 1.2 Add `"@node-rs/jieba": "npm:@node-rs/jieba@^2"` to the `deno.json` imports, then run `deno cache src/main.ts`. Verify that `deno.lock` now lists `@node-rs/jieba` and `@node-rs/jieba-linux-x64-gnu`.
- [x] 1.3 Add `--allow-ffi` to the `dev`, `start`, `start:config`, `test`, `test:watch`, `test:coverage`, `test:coverage:lcov`, `test:unit`, `test:integration` and `ci` tasks in `deno.json`. Verify with `grep -c allow-ffi deno.json`.
- [ ] 1.4 In `Containerfile`, add `--allow-ffi` to `CMD`, and copy `assets/` into both the cache stage and the final stage (`/app/assets/`). Confirm `.containerignore` does not exclude `assets/`. Verify with `podman build` and a `deno eval` inside the image that segments `喜歡` as one word.

## 2. Tokenizer

- [x] 2.1 Create `src/core/memory-recall/types.ts` with `SearchToken` and `TokenKind`, and `src/core/memory-recall/tokenizer.ts` with a lazy jieba singleton loading `assets/jieba/dict.txt.big`, resolved relative to the module URL. Verify with `deno check src/core/memory-recall/tokenizer.ts`.
- [x] 2.2 Implement normalization, entity extraction (hyphen, dot and underscore runs, CamelCase split, adjacent short alphanumeric pair with a digit), CJK word segmentation, CJK bigrams and stopword removal with the fixed weights. Verify with unit tests covering every scenario of the `memory-recall` tokenization requirement.
- [x] 2.3 Implement segmenter degradation: capture the load failure once, log a single error, and fall back to entities plus bigrams. Verify with a unit test that injects a failing loader, asserts that two calls log exactly one error, and checks the fallback tokens.
- [x] 2.4 Add a determinism test (same input tokenized twice returns deep-equal arrays) and a test that the input string is unchanged.

## 3. Verification and docs

- [x] 3.1 Run `deno task ci`. Verify that fmt, lint, check and all tests pass with the new flags.
- [x] 3.2 Add a short "Recall tokenizer" note to `docs/MEMORY_DESIGN.md` and the `--allow-ffi` requirement wherever `--allow-run` appears in `AGENTS.md`, `README.md` and `docs/`. Verify that `grep -rn -- '--allow-run' AGENTS.md README.md docs/` shows `--allow-ffi` on every matching command line.
