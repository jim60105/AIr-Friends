## Context

The full design of the series is `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, sections 2 (D1–D3, D7) and 4. This change covers only the tokenizer and its runtime prerequisites.

Measured during brainstorming on Deno 2.9:

- `@node-rs/jieba` loads through Deno's npm support. Without `--allow-ffi` it cannot find the napi binding, falls back to a missing wasm32 package and throws.
- The package's bundled dictionary is Simplified. With it, `使用者喜歡喝無糖綠茶` segments as `使用者/喜/歡/喝/無/糖/綠/茶`.
- With `dict.txt.big` the same text segments as `使用者/喜歡/喝/無/糖/綠茶`, and 1000 cuts take about 2.2 ms.

## Goals / Non-Goals

**Goals:**

- A pure, synchronous `tokenize(text)` that later changes can call on queries, memories and note chunks.
- Deterministic output for identical input.
- The application, tests and container all run with the permission the native module needs.

**Non-Goals:**

- Indexing, scoring, and any caller integration (later changes).
- Converting between Simplified and Traditional forms.

## Decisions

- **jieba with the vendored `dict.txt.big`.** Alternatives considered:
  - Pure TypeScript bigrams: no native dependency, but weaker precision on Traditional words.
  - Simplified conversion before segmentation: needs a conversion table and still misses Taiwan vocabulary such as `專案` and `軟體`.

  The user chose jieba with the Traditional-capable dictionary.
- **Vendor the dictionary in git** instead of downloading it at build time. Tests and local runs stay offline and deterministic. The cost is 8.6 MB in repository history, which the user accepted.
- **Lazy singleton.** The dictionary is read and `Jieba.withDict()` is called on first use, never at module import. Tests that never tokenize pay nothing, and a load failure is captured once in a module-level state, which also makes the "log once" rule trivial.
- **Precise mode with HMM enabled** (`cut(text, true)`). HMM helps unseen names, and precise mode avoids the overlapping tokens of search mode that would inflate term frequency.
- **Entity extraction runs on the NFKC text before lowercasing** to detect CamelCase boundaries. Emitted terms are lowercased.
- **The stopword list is a small frozen `Set`** of single CJK function characters: `的 了 在 是 我 你 他 她 它 們 也 就 都 和 與 及 或 而 著 嗎 呢 吧 啊 喔 這 那 有 沒 不 很 會 要`. Only exact single-character word tokens are dropped. Bigrams that contain these characters are kept, because the bigram weight is already low.
- **Token shape**: `{ term, kind: "word" | "entity" | "bigram", weight }`. Duplicates are preserved, because term frequency matters downstream.

## Risks / Trade-offs

- [`--allow-ffi` widens the permission surface] → The main process already holds `--allow-run`, which is an equivalent escape hatch. The flag is documented in the permission requirement.
- [The linux-x64-gnu binding is missing from the image because optional npm dependencies were not cached] → The container `deno cache` step resolves platform packages. A task verifies by starting the built image and tokenizing a sample.
- [Repository size grows by 8.6 MB] → Accepted. The file is added once and does not change.
- [`dict.txt.big` still misses some Taiwan-specific terms] → Bigrams remain as the fallback. A custom user dictionary can be layered on later without changing the interface.

## Migration Plan

None. Nothing calls the tokenizer until `memory-recall-scoring` and `memory-recall-retriever` are wired in by `memory-deep-recall`. Rolling back means reverting the change.
