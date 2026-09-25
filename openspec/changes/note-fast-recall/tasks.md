## 1. Configuration

- [ ] 1.1 Add `fastRecallNoteMaxResults`, `fastRecallNoteMaxTokens`, and provisional `noteMinRecallScore: 3.0` and `secondNoteRecallScore: 3.0` with validation, and document them in `config.example.yaml`. Verify with config-loader tests.

## 2. Fast Recall notes

- [ ] 2.1 Add note Fast selection (thresholds, second-note rule, max results, 256-token budget independent of memories). Verify with tests: notes do not displace memories, low-confidence notes are omitted, and `fastRecallNoteMaxResults: 0` selects none.
- [ ] 2.2 Render the note sub-section in `fast-recall.ts` (three-line entries, excerpt-only heading, a notes-only section when no memory is selected). Verify with rendering tests, including a check that the full file text is absent.
- [ ] 2.3 Pass `agentWorkspacePath` into the Fast Recall request in `assembleContext()`. Verify with a context-assembler test using a temporary workspace with one matching note, and a bound test (500 memories plus 50 notes stay within 512 + 384 + 192 + 256 tokens plus headings).

## 3. Calibration

- [ ] 3.1 Add about 10 notes under `tests/fixtures/memory-recall/notes/` and labeled note queries, including negatives, to `queries.yaml`. Verify with the fixture validation test (every expected note exists).
- [ ] 3.2 Extend the benchmark with the note grid pass and a `notes` block in `metrics.json`, timeboxing tuning to 2 hours. Verify by running it with `--write` and checking that the note false-positive rate is at most 5%.
- [ ] 3.3 Set the calibrated note thresholds in `config-loader.ts` and `config.example.yaml`, and extend the regression test to assert the note metrics. Verify that the test passes.

## 4. Docs and verification

- [ ] 4.1 Document note pointers in Fast Recall in `docs/MEMORY_DESIGN.md`. Run `deno task ci` and verify that it passes.
