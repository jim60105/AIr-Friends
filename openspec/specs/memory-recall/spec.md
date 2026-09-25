# memory-recall Specification

## Purpose
Deterministic, CPU-only lexical retrieval over long-term memories and agent workspace notes. It powers automatic per-turn Fast Recall and the agent-invoked Deep Recall (`memory-search`) without embeddings, vector stores, extra LLM calls or extra services.

## Requirements

### Requirement: Text Normalization and Tokenization

Queries, memory contents and note chunks SHALL be processed by the same tokenization pipeline:

1. Apply Unicode NFKC normalization, then lowercase Latin letters.
2. Extract entity tokens (weight 1.5): maximal alphanumeric runs joined by `-`, `.` or `_` (for example `air-friends`, `v0.31.1`), and CamelCase or PascalCase words (for example `OpenClaw`). The component parts of an entity SHALL also be emitted as word tokens. Two adjacent short alphanumeric tokens where at least one contains a digit SHALL also form one entity (for example `a7c ii`, `air75 v3`).
3. Segment every run of CJK characters into words with a dictionary-based segmenter that supports Traditional Chinese, and emit each word as a word token (weight 1.0).
4. Emit every adjacent character pair of every CJK run as a bigram token (weight 0.25).
5. Drop punctuation, whitespace and a fixed list of single-character CJK stopwords.

The tokenizer SHALL NOT modify its input. It SHALL NOT convert between Simplified and Traditional forms. The same input SHALL always produce the same tokens in the same order.

#### Scenario: Traditional Chinese words are segmented as words
- **WHEN** `使用者喜歡喝無糖綠茶` is tokenized
- **THEN** the word tokens SHALL include `喜歡` and `綠茶`

#### Scenario: Mixed-script entities are preserved
- **WHEN** `我在 AIr-Friends 用 OpenClaw 搭配 Air75 V3` is tokenized
- **THEN** the entity tokens SHALL include `air-friends`, `openclaw` and `air75 v3`
- **AND** the word tokens SHALL include `air` and `friends`

#### Scenario: Bigram fallback recovers partial matches
- **GIVEN** a text whose segmented words include `記憶系統` but not `記憶`
- **WHEN** that text and a query containing `記憶` are tokenized
- **THEN** both SHALL contain the bigram `記憶`

#### Scenario: Stopwords removed
- **WHEN** `我的鍵盤` is tokenized
- **THEN** no token SHALL be `的` or `我`

### Requirement: Segmenter Degradation

If the word segmenter or its dictionary cannot be loaded, the tokenizer SHALL log one error and continue producing entity and bigram tokens only. It SHALL NOT throw to its caller because of the segmenter failure.

#### Scenario: Segmenter unavailable
- **GIVEN** the word segmenter fails to load
- **WHEN** `喜歡 Air75 V3` is tokenized
- **THEN** the result SHALL contain the entity `air75 v3` and the bigram `喜歡`
- **AND** no word tokens from segmentation SHALL be produced
- **AND** the error SHALL be logged once, not on every call
