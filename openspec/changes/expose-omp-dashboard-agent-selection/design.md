# Design

## Context

The existing selector has only `opencode`. `chat.js` reads its value and includes `agentType` in the connect request. The authenticated endpoint already validates the shared `opencode | omp` domain and uses the configured default only when the field is absent.

## Goals / Non-Goals

**Goals:** Expose both supported explicit choices through the existing chat surface.

**Non-Goals:** Change initial selection, add automatic per-message routing, redesign model controls, or launch a real provider for acceptance.

## Decisions

1. Add the `omp` option to the existing labelled select, retaining current default selection and keyboard semantics. Reuse the current value-forwarding logic; change JavaScript only if an actual hard-coded override exists. A second selector or backend API change is unnecessary.
2. Exercise the actual page through throwaway Chromium against a mocked authenticated connect/stream boundary. Select each option, connect, and observe the submitted `agentType`; do not use a permanent test that only searches HTML text or checks copied options. Preserve rejection of unsupported types and absent-field backend fallback.
3. Update current dashboard usage documentation and changelog without new configuration or deployment instructions.

## Risks / Trade-offs

- [OMP is visible but the request still carries OpenCode] → Observe outgoing request bodies from both actual UI selections.
- [A smoke accidentally starts an agent] → Mock only the authenticated connection/SSE boundary and assert no real agent launch; report browser evidence separately from runtime evidence.

## Migration Plan

No data/config migration. Apply independently after the archived API baseline; listed C7 for single-writer ordering. Whole-change revert restores the prior option set. Budget: markup/forwarding 0.5h, browser smoke 0.75h, focused contract adjustment 0.25h, docs 0.5h, total 2.0h.
