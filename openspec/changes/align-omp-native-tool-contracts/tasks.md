# Tasks

Archived baseline; serialize after C1 (C2). Run build/format/lint/affected tests once after all implementation edits, not between tasks. Automated acceptance is deterministic source/API-shaped smoke only; native runtime, providers, platforms, and containers remain user-owned.

## 1. Native schema and result adaptation

- [x] 1.1 Supply read/search native parameter schemas through the pinned supported builder facade and migrate definition consumers; verify valid input reaches the executor and invalid declared fields fail before transport dispatch without relying on handwritten substitute types.
- [x] 1.2 Replace custom contentBlocks with native content/results, encoding supported images correctly and preserving exact non-image bytes in a native-compatible binary data/metadata representation; retain attribution, failures, and cancellation. Verify a native-compatible consumer can recover fixture bytes and cannot mistake arbitrary binary data for an image.
- [x] 1.3 Preserve same-tool local delegation and migrate broken contract coverage without adding source/schema-copy tests; update network/compatibility docs, changelog, and owned digests. Verify ordinary authorized local read invokes the real fixture delegate once, and absent delegation errors explicitly without a new filesystem fallback.

## 2. Native consumer proof

- [x] 2.1 After all edits, run a throwaway native-compatible definition/result smoke for valid/invalid read/query input, text, image, non-image bytes, transport failure, and local delegation; run affected behavioral suites once. Verify the smoke consumes actual result content/encoding and does not launch OMP or a live provider.

## Workflow follow-up

- Archive and sync after implementation/review gates; leave historical archives unchanged.
- Apply successors in the correction index order; rebuild/recut owned outputs for each affected successor.
