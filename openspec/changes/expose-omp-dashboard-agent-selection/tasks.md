# Tasks

Archived dashboard API support; independent, listed last for single-writer ordering (C7). Run build/format/lint/affected tests once after all implementation edits, not between tasks. Automated acceptance is deterministic source/API-shaped smoke only; native runtime, providers, platforms, and containers remain user-owned.

## 1. Expose and forward the existing supported choice

- [x] 1.1 Add OMP to the existing labelled agent selector while retaining OpenCode and current initial selection; reuse current forwarding and change JavaScript only if necessary. Verify each selected value reaches the current authenticated request body without changing model or lifecycle controls.
  <!-- Landed (commit 434fc31): one line — `<option value="omp">OMP</option>` after the unchanged first `opencode` option in the labelled Agent Protocol select (`src/dashboard/public/index.html`), so the initial selection stays OpenCode. JS UNCHANGED: `chatConnect()` already reads `chat-agent-type`.value verbatim into the authenticated `POST /api/chat/connect` body (`body: JSON.stringify({ agentType, model })`) with NO hard-coded override anywhere in `src/dashboard/public/` (grep-verified); model entry, disable-on-connect, disconnect, and reset paths untouched. Each selected value reaching the request body is verified by the task 2.1 real-page smoke below. -->
- [x] 1.2 Update dashboard usage docs and changelog and adjust existing consumer-visible contract coverage only where behavior changes. Verify unsupported API types still reject and omitted type retains configured-default behavior; do not add source/option-copy tests.
  <!-- Landed (commit 946ed1c): README `ACP Agent Integration` gains the dashboard-selection usage note (selector offers both types, submits the selection; configured default applies only to omitted request fields); CHANGELOG Unreleased/Added gains the row-C7 entry. Coverage: ONE new API-shaped test (`tests/dashboard/server.test.ts`) for the omitted-type configured-default scenario — `defaultAgentType: "omp"` config + request without `agentType` passes validation and proceeds to connection establishment (500, not 400). Unsupported-type 400 and supported-omp 500 tests already exist and are untouched; no source-text or option-copy test added. -->

## 2. Actual dashboard smoke

- [x] 2.1 After all edits, launch the actual dashboard page in throwaway Chromium with a mocked authenticated connect/SSE boundary, select and connect once with each agent, and inspect request bodies. Verify omp/opencode are forwarded as selected with no real agent/provider launch; close the throwaway browser and report visual/API evidence separately.
  <!-- Run (throwaway mock server + agent-browser Chromium, executed then deleted — never committed, deno.lock restored): the REAL `src/dashboard/public/index.html` + REAL `js/chat.js` served over a mock that answers ONLY /api/auth/status, /api/config/models, /api/chat/connect (record body, return `chatSessionId`), /api/chat/stream (one canned SSE `message`), /api/chat/disconnect — no AgentConnector exists anywhere in the harness, so no agent/provider launch is possible. API evidence (recorded request bodies, in order): `{"agentType":"opencode","model":"mock/model-a"}` then `{"agentType":"omp","model":"mock/model-a"}` — each selection forwarded verbatim, no override. Visual evidence (separate): page snapshot shows the labelled selector with options OpenCode (initially selected) + OMP; after selecting OMP and connecting, the live status reads `Connected (omp/mock/model-a)` with the mock SSE reply rendered and the model field and Establish/Sever lifecycle working (connect disabled the select, disconnect + Initialize New Session re-enabled it); the throwaway browser was closed afterwards. -->

## Workflow follow-up

- Archive and sync after implementation/review gates; leave historical archives unchanged.
- Apply successors in the correction index order; rebuild/recut owned outputs for each affected successor.
