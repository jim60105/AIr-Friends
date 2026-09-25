## Why

Memory Recall v2 (see `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`) needs one tokenizer that turns Traditional Chinese, mixed-script text and product names into comparable terms. The obvious segmenter, jieba, ships with a Simplified dictionary and splits Traditional text into single characters (`喜/歡`, `軟/體`, `記/憶`). As a native module, it also needs a Deno permission the application does not grant today. This change delivers the tokenizer and its runtime prerequisites on their own, so later recall changes can build on a verified foundation.

This is change 1 of 9 in the Memory Recall v2 series.

## What Changes

- Add `npm:@node-rs/jieba` and vendor the Traditional-capable dictionary `dict.txt.big` (fxsjy/jieba, MIT, 8.6 MB) under `assets/jieba/`, with its license and source notes.
- Add a shared tokenizer that normalizes text (NFKC, lowercase), extracts entity tokens, segments CJK words and emits CJK bigrams with fixed weights, and drops stopwords.
- The tokenizer degrades to entity and bigram tokens when the segmenter cannot load.
- **BREAKING**: add `--allow-ffi` to the container `CMD` and to every `deno.json` task that runs the application or tests. CI inherits it through the tasks. Copy `assets/` into the image.

## Capabilities

### New Capabilities

- `memory-recall`: Introduced with its tokenization and segmenter-degradation requirements. Later changes in the series add the rest.

### Modified Capabilities

- `configuration-and-deployment`: "Deno Runtime with Explicit Permissions" adds `--allow-ffi` to the required flags.

## Impact

- **New code**: `src/core/memory-recall/tokenizer.ts` and its tests.
- **New assets**: `assets/jieba/dict.txt.big`, `assets/jieba/LICENSE`, `assets/jieba/README.md`.
- **Configuration and build**: `deno.json` (import and task flags), `deno.lock` (linux-x64-gnu binding), `Containerfile` (`CMD` flags, copy `assets/`).
- **Callers**: none yet. Nothing in the running bot calls the tokenizer until `memory-deep-recall`.
