## 1. Delimit RSS content as untrusted (D1)

- [x] 1.1 In `src/core/session-orchestrator.ts` `buildSelfResearchPrompt`, replace the bare numbered `rssBlock` interpolation with each item wrapped in explicit untrusted-content markers (distinctive start/end) plus a do-not-follow-instructions directive
- [x] 1.2 (Optional) reinforce the untrusted framing around `{{ rssItems }}` in `prompts/system_self_research.md`
- [x] 1.3 Test: the assembled self-research prompt wraps each RSS item in the untrusted-content delimiters and includes the do-not-follow instruction; no undelimited feed interpolation remains

## 2. Documentation

- [x] 2.1 Note the untrusted-content delimiting in the self-research prompt/behavior docs
- [x] 2.2 Record the optional provenance/review follow-on (D2) as deferred future work, with its relationship to run-1's F3 and to F15

## 3. Verification

- [x] 3.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/`
- [x] 3.2 Run `deno check src/main.ts`
- [x] 3.3 Run `deno task test` and confirm the self-research prompt test passes and coverage does not regress
- [x] 3.4 Run `openspec validate delimit-self-research-untrusted-content` and confirm it passes
