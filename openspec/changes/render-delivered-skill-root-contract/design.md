# Design

## Context

`resolveTrustedSkillsRoot` in `src/core/skills-root.ts` already selects and physically observes the trusted absolute root, image-first or validated development source for OMP and daemon-side configured installed root for OpenCode. Context assembler and orchestrator already pass `skillsDir`. Only `system_summary.md` interpolates it, and its executable path is unquoted. The correction recipe in `agent-factory.ts:608-609` also leaves its executable path unquoted.

`template-renderer.ts` catches engine errors but missing interpolation variables do not necessarily throw. `tests/core/prompt-staging-literals.test.ts` renders the bundled files but omits skillsDir; its current no-values test permits blank rendering. Template-source text assertions would miss the delivered defect.

## Goals / Non-Goals

Enforce the existing delivered root contract, with one selected root and shell-safe recipes in every skill-instructing prompt. Preserve session id, exact absolute staging, pointer-only free-text payloads and both agents' spawn shapes.

Do not derive a second root, alter skills installation, relocate JWT/pointers, introduce config/env fields, relax payload containment or instruct dashboard web-chat to use skills. Prompt correctness is independent of the accepted native local-IO posture.

## Decisions

### Explicit delivery-boundary requirement

Every path that renders a skill-instructing session passes through an explicit required-root validation before template rendering or sending. Validate a nonempty absolute trusted `skillsDir`, with an existing ConfigError render/session failure; do not rely on Vento interpolation to report missing fields. Use the selected-agent resolver's value without HOME expansion or retry rereading a different root.

Make the session boundary explicit rather than searching prose for the word skill. Normal context assembly and the named orchestrator session paths classify these renders as skill-instructing, including configured operator-mounted alternatives for those paths. Generic Markdown rendering and dashboard chat remain unclassified and unchanged. Retry validates its existing mandatory context separately with the same validation helper. Mounted templates must receive the root too; detect missing literal root in a classified final result before sending rather than declaring a silent mounted-template exception. This validates the existing contract, not arbitrary prompt content quality.

### Bundled delivered matrix

Add one shared skills-root instruction fragment using the existing include convention, and include it in each skill-instructing bundled system template. It states the literal absolute root, instructs using that root rather than child HOME, and gives a quoted recipe appropriate to the session's allowed skills. Do not add a reply command to non-reply research/maintenance sessions. Reuse existing session information and skill permissions fragments, avoiding duplicate id/staging explanations.

| Delivery path | Bundled template / builder | Required recipe or root instruction |
| --- | --- | --- |
| Normal reply, including lurk-originated reply | system_reply.md | literal root, allowed reply/reaction/file recipe |
| Spontaneous post | system_spontaneous.md | literal root and allowed post recipe |
| Self research | system_self_research.md | literal root and quoted paths for existing allowed skill instructions; no new memory or reply capability |
| Summary | system_summary.md | quoted existing memory-save executable/content-file recipe |
| User memory maintenance | system_memory_maintenance.md | literal root and maintenance recipe |
| Channel memory maintenance | system_memory_maintenance.md via the inline channel render at session-orchestrator.ts:2995-3022 | literal root and scope-correct recipe |
| Scheduled reminder | system_reminder.md | literal root and reminder delivery recipe |
| Missing-response/correction retry, including research's existing correction path when it contains skill guidance | agent-factory and the existing research retry builder | same selected root and quote full executable |
| Dashboard web-chat | system_web_chat.md | unchanged skill prohibition; no skill invocation recipe |

Lurk is a normal reply delivery route, not a new template or new feature. Spontaneous, research and user-maintenance builders select the listed files at session-orchestrator.ts:4734-4735,4793-4794,4834-4835; acceptance uses captured final delivered content. The research correction builder at :349-375 includes agent-browser skill guidance but no standalone skill-script recipe: add the literal root to its skill guidance without adding a new command or changing the existing fallback.

### Quote actual shell arguments

Add one small pure recipe-argument formatter alongside the existing trusted root helper, reused by renderer-injected trusted template helpers and retry construction. POSIX single-quote each complete executable/path argument and escape embedded apostrophes as quote-close/escaped-quote/reopen. Quote the complete root-plus-script path, not just the root prefix. The renderer supplies the trusted helper to its existing variable context; no operator configuration or subprocess field is added.

Apply it to executable paths, literal session-id arguments and payload-file flags in bundled/retry recipes. Paths containing spaces, apostrophes, dollar signs or backticks must preserve their exact literal argument spelling. No shell process is required to test this property; use the existing command tokenizer or a focused parser fixture. Preserve free-text content in payload files only.

## Risks / Trade-offs

A root validation added only to a template would miss alternate delivery paths. Put validation at classified rendering and final delivery, and exercise the callers with captured connector prompt output. A mounted template lacking the required root now fails explicitly; this is the pre-release contract, not a compatibility layer. Literal-presence validation does not establish executable authorization or native read parity.

## Migration Plan

Cleanly update all bundled classified templates, render/delivery callsites and retry construction together. Update old missing-variable tests so unrelated generic rendering remains supported, while missing skills root on classified prompts is an error. Use existing docs for prompt variables/skill usage plus CHANGELOG; do not modify archived change artifacts. Budget: helper/validation 1h, templates/retry 1.5h, focused rendered/delivery tests 2h, docs 1h.

## Verification Plan

Render actual bundled templates with the real engine, then capture final delivery in focused context-assembler/orchestrator mocks. Table-drive both agent roots, pooled/per-spawn literal ids/staging, and every path above. Assert literal absolute root, a correctly quoted full executable argument wherever a recipe appears, pointer-only payload flags, no unresolved `${HOME}`, `$HOME`, `{{ skillsDir }}` or missing-root output, and unchanged web-chat no-skill posture. Cover missing/empty/relative root and configured mounted-template omission before connector.prompt is called. Keep the existing staging-literal and retry rejection-diagnostic assertions; test a root containing spaces and shell metacharacters without launching an agent, provider or shell recipe.

## Implementation handoff (for the following `thread-per-spawn-omp-recovery-context` writer)

That change applies second because both writers edit `src/core/session-orchestrator.ts`. What this
change touched there (re-anchor by name, not line):

- the existing `trustedSkillsDir()` root resolution (behavior unchanged) and the NEW private
  `renderClassifiedSkillPrompt(env, templatePath, variables, boundary)` (validate → render → assert);
- `buildSelfResearchRetryMessage(skillsRoot, rejections)` — gained the selected-root parameter; its
  call site passes `this.trustedSkillsDir()`;
- `sendRetryPrompt(...)` — now asserts the built retry guidance carries `retryCtx.skillsDir` before
  `connector.prompt`;
- the channel-memory-maintenance inline render and `buildSpontaneousPromptFromTemplate`,
  `buildSelfResearchPrompt`, `buildMemoryMaintenancePrompt`, `buildReminderPrompt` and
  `generateConversationSummary` now route through `renderClassifiedSkillPrompt` instead of calling
  `renderTemplate` directly.

NO change was made to `promptWithIdleTimeoutHandling`, `runSharedPoolSession`, `retryPromptContext`,
`recoveryOwnershipFromRegistry`, `recoveryPostRestoreHook`, the recovery-abort classification, or any
spawn/recovery shape — the recovery writer layers its per-spawn recovery context on top without
reworking these.

Delivered matrix — every final delivered type reaches a classified boundary:

| Delivery path | Boundary | Root asserted |
| --- | --- | --- |
| Normal reply, lurk-originated reply | `ContextAssembler.renderFullPrompt` | literal presence before delivery |
| Initial/assembled context | `ContextAssembler.assembleContext` | required-root validation before render |
| Spontaneous context | `ContextAssembler.assembleSpontaneousContext` | required-root validation before render |
| Spontaneous post | `buildSpontaneousPromptFromTemplate` | literal presence before delivery |
| Self research | `buildSelfResearchPrompt` | literal presence before delivery |
| User memory maintenance | `buildMemoryMaintenancePrompt` | literal presence before delivery |
| Channel memory maintenance | inline channel render | literal presence before delivery |
| Conversation summary | `generateConversationSummary` | literal presence before delivery (a failure is logged and no prompt is sent) |
| Scheduled reminder | `buildReminderPrompt` | literal presence before delivery |
| Missing-response retry | `getRetryPromptStrategy` (validates the mandatory context) + `sendRetryPrompt` (asserts) | literal presence before delivery |
| Self-research correction retry | `buildSelfResearchRetryMessage` | literal presence before delivery |
| Dashboard web-chat | `dashboard/server.ts` web-chat render | unclassified — unchanged prohibition, no recipe |
